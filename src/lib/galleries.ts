import { and, asc, eq } from "drizzle-orm";
import { db, tables } from "@/db";
import { env } from "@/lib/env";
import { storage } from "@/lib/storage";
import { editWindowOpen, pieceCapFor, TIER_CAPS } from "@/lib/tiers";

export type Gallery = typeof tables.galleries.$inferSelect;
export type Artwork = typeof tables.artworks.$inferSelect;
export type Room = typeof tables.rooms.$inferSelect;

export async function galleryBySlug(slug: string): Promise<Gallery | null> {
  const [g] = await db()
    .select()
    .from(tables.galleries)
    .where(eq(tables.galleries.slug, slug))
    .limit(1);
  return g ?? null;
}

export async function galleryByIdForCreator(
  galleryId: string,
  creatorId: string,
): Promise<Gallery | null> {
  const [g] = await db()
    .select()
    .from(tables.galleries)
    .where(
      and(eq(tables.galleries.id, galleryId), eq(tables.galleries.creatorId, creatorId)),
    )
    .limit(1);
  return g ?? null;
}

export async function galleryArtworks(galleryId: string): Promise<Artwork[]> {
  return db()
    .select()
    .from(tables.artworks)
    .where(eq(tables.artworks.galleryId, galleryId))
    .orderBy(asc(tables.artworks.sortOrder), asc(tables.artworks.createdAt));
}

export async function galleryRooms(galleryId: string): Promise<Room[]> {
  return db()
    .select()
    .from(tables.rooms)
    .where(eq(tables.rooms.galleryId, galleryId))
    .orderBy(asc(tables.rooms.sortOrder));
}

/**
 * Central edit gate. Download-tier galleries are editable only inside the
 * 3-day window; a readonly/frozen gallery is never editable until upgraded
 * or reactivated.
 */
export function assertEditable(gallery: Gallery): void {
  if (gallery.status === "readonly") {
    throw new EditLockedError(
      "This gallery is read-only. Upgrade to hosting to re-enable editing.",
    );
  }
  if (gallery.status === "frozen") {
    throw new EditLockedError(
      "This gallery is frozen. Reactivate hosting to edit it.",
    );
  }
  if (gallery.tier === "download" && !editWindowOpen(gallery.editWindowExpiresAt)) {
    throw new EditLockedError(
      "The 3-day edit window for this download gallery has closed. Upgrade to hosting to keep editing.",
    );
  }
}

export class EditLockedError extends Error {}

/** Enforce the tier piece cap at publish and at save-while-published. */
export async function assertWithinPieceCap(gallery: Gallery, adding = 0): Promise<number> {
  const works = await galleryArtworks(gallery.id);
  const count = works.length + adding;
  const cap = pieceCapFor(gallery.tier);
  if (count > cap) {
    // Tier S outgrowing its cap is a normal, resolvable situation — it
    // means "upgrade", not "no". Flagging it distinctly is what lets the
    // caller offer the prorated upgrade instead of dead-ending the
    // creator at a wall with nothing to click.
    const upgradable = gallery.tier === "S" && count <= TIER_CAPS.L;
    throw new PieceCapError(
      upgradable
        ? `Tier S holds up to ${cap} pieces and this would make ${count}. ` +
          `Upgrading to Tier L (up to ${TIER_CAPS.L}) is prorated — you never pay the creation fee twice.`
        : `This gallery holds up to ${cap} pieces (you would have ${count}). ` +
          `${TIER_CAPS.L} pieces is the maximum gallery size.`,
      upgradable,
    );
  }
  return count;
}

export class PieceCapError extends Error {
  /** True when a prorated Tier L upgrade would resolve this. */
  readonly upgradable: boolean;

  constructor(message: string, upgradable = false) {
    super(message);
    this.upgradable = upgradable;
  }
}

/** Public URL for a derivative key (public bucket, immutable cache). */
export function derivativeUrl(key: string | undefined): string | null {
  if (!key) return null;
  return storage().publicUrl(env().STORAGE_DERIVATIVES_BUCKET, key);
}

export interface ArtworkView {
  id: string;
  title: string;
  caption: string;
  widthPx: number | null;
  heightPx: number | null;
  dominantColors: string[];
  license: string | null;
  spotlight: boolean;
  hero: boolean;
  roomId: string | null;
  sortOrder: number;
  frameStyle: string;
  urls: { thumb: string | null; wall: string | null; zoom: string | null };
}

/** Serializable artwork projection for scene + grid + export. */
export function toArtworkView(a: Artwork, gallery: Gallery): ArtworkView {
  const d = a.derivativeKeys ?? {};
  return {
    id: a.id,
    title: a.title,
    caption: a.caption,
    widthPx: a.widthPx,
    heightPx: a.heightPx,
    dominantColors: a.dominantColors ?? [],
    license: a.licenseOverride ?? gallery.licenseDefault,
    spotlight: a.spotlight,
    hero: a.hero,
    roomId: a.roomId,
    sortOrder: a.sortOrder,
    frameStyle: a.frameStyleOverride ?? gallery.frameStyleDefault,
    urls: {
      thumb: derivativeUrl(d.thumb),
      wall: derivativeUrl(d.wall),
      zoom: derivativeUrl(d.zoom),
    },
  };
}
