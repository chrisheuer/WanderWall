import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db, tables } from "@/db";
import { currentCreator } from "@/lib/auth";
import { env } from "@/lib/env";
import {
  EditLockedError,
  assertEditable,
  galleryByIdForCreator,
} from "@/lib/galleries";
import { storage } from "@/lib/storage";

const patchSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  caption: z.string().max(2000).optional(),
  roomId: z.string().uuid().nullable().optional(),
  sortOrder: z.number().int().min(0).optional(),
  frameStyleOverride: z.string().max(60).nullable().optional(),
  licenseOverride: z
    .enum([
      "all-rights-reserved",
      "cc-by",
      "cc-by-sa",
      "cc-by-nc",
      "cc-by-nc-sa",
      "cc-by-nd",
      "cc-by-nc-nd",
      "cc0",
    ])
    .nullable()
    .optional(),
  spotlight: z.boolean().optional(),
  hero: z.boolean().optional(),
  tags: z.array(z.string().max(40)).max(20).optional(),
});

async function loadOwned(id: string) {
  const creator = await currentCreator();
  if (!creator) return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  const [artwork] = await db()
    .select()
    .from(tables.artworks)
    .where(eq(tables.artworks.id, id))
    .limit(1);
  if (!artwork) return { error: NextResponse.json({ error: "not found" }, { status: 404 }) };
  const gallery = await galleryByIdForCreator(artwork.galleryId, creator.id);
  if (!gallery) return { error: NextResponse.json({ error: "not found" }, { status: 404 }) };
  return { artwork, gallery };
}

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const loaded = await loadOwned(id);
  if ("error" in loaded) return loaded.error;
  const { artwork, gallery } = loaded;

  const body = patchSchema.safeParse(await request.json().catch(() => ({})));
  if (!body.success) {
    return NextResponse.json({ error: body.error.flatten() }, { status: 400 });
  }

  try {
    assertEditable(gallery);
  } catch (err) {
    if (err instanceof EditLockedError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    throw err;
  }

  const [updated] = await db()
    .update(tables.artworks)
    .set(body.data)
    .where(eq(tables.artworks.id, artwork.id))
    .returning();

  return NextResponse.json({ artwork: updated });
}

export async function DELETE(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const loaded = await loadOwned(id);
  if ("error" in loaded) return loaded.error;
  const { artwork, gallery } = loaded;

  try {
    assertEditable(gallery);
  } catch (err) {
    if (err instanceof EditLockedError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    throw err;
  }

  await db().delete(tables.artworks).where(eq(tables.artworks.id, artwork.id));

  // Best-effort storage cleanup; rows are the source of truth.
  const keys = Object.values(artwork.derivativeKeys ?? {});
  if (keys.length > 0) {
    await storage().delete(env().STORAGE_DERIVATIVES_BUCKET, keys).catch(() => {});
  }
  if (artwork.originalKey) {
    await storage().delete(env().STORAGE_ORIGINALS_BUCKET, [artwork.originalKey]).catch(() => {});
  }

  return NextResponse.json({ ok: true });
}
