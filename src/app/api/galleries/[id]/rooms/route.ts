import { asc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db, tables } from "@/db";
import { currentCreator } from "@/lib/auth";
import {
  EditLockedError,
  assertEditable,
  galleryArtworks,
  galleryByIdForCreator,
  toArtworkView,
} from "@/lib/galleries";
import { autoSegment, type HangDensity } from "@/lib/layout";

/**
 * Room management. POST regenerates rooms — default chapters by upload
 * order, or regrouped by dominant color or tag — and persists the result
 * as room rows + artwork assignments the creator can then hand-tune.
 */

const regenSchema = z.object({
  groupBy: z.enum(["order", "color", "tag"]).default("order"),
});

export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const creator = await currentCreator();
  if (!creator) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const gallery = await galleryByIdForCreator(id, creator.id);
  if (!gallery) return NextResponse.json({ error: "not found" }, { status: 404 });

  const rooms = await db()
    .select()
    .from(tables.rooms)
    .where(eq(tables.rooms.galleryId, gallery.id))
    .orderBy(asc(tables.rooms.sortOrder));
  return NextResponse.json({ rooms });
}

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const creator = await currentCreator();
  if (!creator) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const gallery = await galleryByIdForCreator(id, creator.id);
  if (!gallery) return NextResponse.json({ error: "not found" }, { status: 404 });

  const body = regenSchema.safeParse(await request.json().catch(() => ({})));
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

  const rows = (await galleryArtworks(gallery.id)).filter((a) => a.ingestStatus === "ready");
  let views = rows.map((a) => toArtworkView(a, gallery));

  if (body.data.groupBy === "color") {
    views = [...views].sort((a, b) => hue(a.dominantColors[0]) - hue(b.dominantColors[0]));
  } else if (body.data.groupBy === "tag") {
    const tagOf = (id: string) => {
      const row = rows.find((r) => r.id === id);
      return row?.tags?.[0] ?? "￿"; // untagged sorts last
    };
    views = [...views].sort((a, b) => tagOf(a.id).localeCompare(tagOf(b.id)));
  }

  const configs = autoSegment({
    archetypeId: gallery.environmentArchetype,
    hangDensity: gallery.hangDensity as HangDensity,
    lightingDefault: gallery.lightingDefault,
    environmentParams: {},
    rooms: [],
    artworks: views,
  });

  // Replace existing rooms wholesale (artworks.room_id nulls via FK).
  await db().delete(tables.rooms).where(eq(tables.rooms.galleryId, gallery.id));

  let chapterIndex = 0;
  for (let i = 0; i < configs.length; i++) {
    const cfg = configs[i];
    const [room] = await db()
      .insert(tables.rooms)
      .values({
        galleryId: gallery.id,
        sortOrder: i,
        archetype: cfg.archetype,
        footprintM2: cfg.footprintM2,
        ceilingM: cfg.ceilingM,
        wallColor: cfg.wallColor ?? undefined,
        floorMaterial: cfg.floorMaterial ?? undefined,
        lightingRig: cfg.lightingRig ?? undefined,
        name: cfg.name,
        chapterLabel:
          cfg.kind === "room" && body.data.groupBy === "tag"
            ? firstTagOf(rows, cfg.artworkIds)
            : cfg.chapterLabel,
        kind: cfg.kind,
      })
      .returning();
    if (cfg.kind === "room") chapterIndex += 1;

    for (let j = 0; j < cfg.artworkIds.length; j++) {
      await db()
        .update(tables.artworks)
        .set({ roomId: room.id, sortOrder: j })
        .where(eq(tables.artworks.id, cfg.artworkIds[j]));
    }
  }
  void chapterIndex;

  const rooms = await db()
    .select()
    .from(tables.rooms)
    .where(eq(tables.rooms.galleryId, gallery.id))
    .orderBy(asc(tables.rooms.sortOrder));
  return NextResponse.json({ rooms }, { status: 201 });
}

function hue(hex: string | undefined): number {
  if (!hex) return 361;
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return 361;
  const n = parseInt(m[1], 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return 360; // grays hang together at the end
  const d = max - min;
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}

function firstTagOf(
  rows: Array<{ id: string; tags: string[] | null }>,
  artworkIds: string[],
): string | null {
  for (const id of artworkIds) {
    const row = rows.find((r) => r.id === id);
    if (row?.tags?.[0]) return row.tags[0];
  }
  return null;
}
