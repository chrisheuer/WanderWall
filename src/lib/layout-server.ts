import { eq } from "drizzle-orm";
import { db, tables } from "@/db";
import {
  galleryArtworks,
  galleryRooms,
  toArtworkView,
  type ArtworkView,
  type Gallery,
} from "@/lib/galleries";
import { buildLayout, roomsToConfig, type GalleryLayout } from "@/lib/layout";
import type { HangDensity } from "@/lib/layout";

/** Assemble the serializable layout + views for a gallery (SSR side). */
export async function loadGalleryWorld(gallery: Gallery): Promise<{
  layout: GalleryLayout;
  artworks: ArtworkView[];
  creatorName: string;
}> {
  const [creator] = await db()
    .select()
    .from(tables.creators)
    .where(eq(tables.creators.id, gallery.creatorId))
    .limit(1);

  const rows = await galleryArtworks(gallery.id);
  const ready = rows.filter((a) => a.ingestStatus === "ready");
  const artworks = ready.map((a) => toArtworkView(a, gallery));
  const dbRooms = await galleryRooms(gallery.id);

  const layout = buildLayout({
    archetypeId: gallery.environmentArchetype,
    hangDensity: gallery.hangDensity as HangDensity,
    lightingDefault: gallery.lightingDefault,
    environmentParams: (gallery.environmentParams ?? {}) as Record<string, unknown>,
    rooms: roomsToConfig(dbRooms, artworks),
    artworks,
  });

  return {
    layout,
    artworks,
    creatorName: creator?.displayName || creator?.email || "the artist",
  };
}
