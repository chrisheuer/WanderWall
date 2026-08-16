import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db, tables } from "@/db";
import { currentCreator } from "@/lib/auth";
import { mapDescriptionToArchetype } from "@/lib/environments";
import {
  EditLockedError,
  assertEditable,
  galleryByIdForCreator,
} from "@/lib/galleries";
import { extractDominantColors } from "@/jobs/ingest";

/**
 * Environment tools:
 *  - JSON {description} → "describe your space": map text onto the
 *    closest archetype and store it.
 *  - image/* body → "seed with a photo": extract a palette from the
 *    reference image for walls / ambient / accents.
 */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const creator = await currentCreator();
  if (!creator) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const gallery = await galleryByIdForCreator(id, creator.id);
  if (!gallery) return NextResponse.json({ error: "not found" }, { status: 404 });

  try {
    assertEditable(gallery);
  } catch (err) {
    if (err instanceof EditLockedError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    throw err;
  }

  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.startsWith("image/")) {
    const bytes = Buffer.from(await request.arrayBuffer());
    if (bytes.byteLength > 8 * 1024 * 1024) {
      return NextResponse.json({ error: "reference image over 8MB" }, { status: 413 });
    }
    const colors = await extractDominantColors(bytes);
    if (colors.length === 0) {
      return NextResponse.json({ error: "couldn't read a palette from that image" }, { status: 400 });
    }
    const seededPalette = {
      wall: colors[0],
      ambient: colors[1] ?? colors[0],
      accent: colors[2] ?? colors[colors.length - 1],
      swatches: colors,
    };
    const params = {
      ...((gallery.environmentParams ?? {}) as Record<string, unknown>),
      seededPalette,
    };
    await db()
      .update(tables.galleries)
      .set({ environmentParams: params, updatedAt: new Date() })
      .where(eq(tables.galleries.id, gallery.id));
    return NextResponse.json({ seededPalette });
  }

  const body = z
    .object({
      description: z.string().max(500).optional(),
      clearPalette: z.boolean().optional(),
    })
    .safeParse(await request.json().catch(() => ({})));
  if (!body.success) return NextResponse.json({ error: "invalid request" }, { status: 400 });

  if (body.data.clearPalette) {
    const params = { ...((gallery.environmentParams ?? {}) as Record<string, unknown>) };
    delete params.seededPalette;
    await db()
      .update(tables.galleries)
      .set({ environmentParams: params, updatedAt: new Date() })
      .where(eq(tables.galleries.id, gallery.id));
    return NextResponse.json({ cleared: true });
  }

  if (!body.data.description) {
    return NextResponse.json({ error: "describe your space or send a photo" }, { status: 400 });
  }
  const archetype = mapDescriptionToArchetype(body.data.description);
  await db()
    .update(tables.galleries)
    .set({ environmentArchetype: archetype.id, updatedAt: new Date() })
    .where(eq(tables.galleries.id, gallery.id));
  return NextResponse.json({ archetype: { id: archetype.id, name: archetype.name } });
}
