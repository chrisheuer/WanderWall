import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db, tables } from "@/db";
import { currentCreator } from "@/lib/auth";
import {
  EditLockedError,
  PieceCapError,
  assertEditable,
  assertWithinPieceCap,
  galleryByIdForCreator,
} from "@/lib/galleries";

const patchSchema = z.object({
  title: z.string().min(1).max(120).optional(),
  statement: z.string().max(4000).optional(),
  environmentArchetype: z.string().max(60).optional(),
  hangDensity: z.enum(["salon", "standard", "airy"]).optional(),
  frameStyleDefault: z.string().max(60).optional(),
  lightingDefault: z.string().max(60).optional(),
  licenseDefault: z
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
    .optional(),
  exportDonationUrl: z.string().url().max(500).nullable().optional(),
});

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const creator = await currentCreator();
  if (!creator) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const gallery = await galleryByIdForCreator(id, creator.id);
  if (!gallery) return NextResponse.json({ error: "not found" }, { status: 404 });

  const body = patchSchema.safeParse(await request.json().catch(() => ({})));
  if (!body.success) {
    return NextResponse.json({ error: body.error.flatten() }, { status: 400 });
  }

  try {
    assertEditable(gallery);
    // Save-while-published re-checks the cap (e.g. tier was downgraded).
    if (gallery.status === "published" || gallery.status === "unlisted") {
      await assertWithinPieceCap(gallery);
    }
  } catch (err) {
    if (err instanceof EditLockedError || err instanceof PieceCapError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    throw err;
  }

  const [updated] = await db()
    .update(tables.galleries)
    .set({ ...body.data, updatedAt: new Date() })
    .where(eq(tables.galleries.id, gallery.id))
    .returning();

  return NextResponse.json({ gallery: updated });
}

export async function DELETE(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const creator = await currentCreator();
  if (!creator) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const gallery = await galleryByIdForCreator(id, creator.id);
  if (!gallery) return NextResponse.json({ error: "not found" }, { status: 404 });

  // Draft-only deletion; live galleries must be cancelled first so the
  // "never silently deleted" promise holds.
  if (gallery.status !== "draft") {
    return NextResponse.json(
      { error: "only draft galleries can be deleted" },
      { status: 403 },
    );
  }

  await db().delete(tables.galleries).where(eq(tables.galleries.id, gallery.id));
  return NextResponse.json({ ok: true });
}
