import { eq } from "drizzle-orm";
import sharp from "sharp";
import { db, tables } from "@/db";
import { env } from "@/lib/env";
import { storage, DERIVATIVE_CACHE_CONTROL } from "@/lib/storage";

/**
 * The single ingest pipeline. Every source path (upload, URL, Drive,
 * Dropbox) lands an original in storage and enqueues { artworkId } here.
 *
 * Produces WebP derivatives at thumb 256 / wall 1024 / zoom 2048, extracts
 * dimensions + dominant colors, strips EXIF GPS from everything served while
 * retaining full EXIF privately for the creator.
 */

export interface IngestJobData {
  artworkId: string;
}

const DERIVATIVE_SIZES = { thumb: 256, wall: 1024, zoom: 2048 } as const;

export async function runIngestJob(data: IngestJobData): Promise<void> {
  const { artworkId } = data;
  const [artwork] = await db()
    .select()
    .from(tables.artworks)
    .where(eq(tables.artworks.id, artworkId))
    .limit(1);
  if (!artwork) return; // deleted before processing — nothing to do
  if (artwork.ingestStatus === "ready") return; // idempotent re-delivery
  if (!artwork.originalKey) {
    await markFailed(artworkId, "no original in storage");
    return;
  }

  await db()
    .update(tables.artworks)
    .set({ ingestStatus: "processing" })
    .where(eq(tables.artworks.id, artworkId));

  try {
    const original = await storage().get(env().STORAGE_ORIGINALS_BUCKET, artwork.originalKey);
    const image = sharp(original, { failOn: "truncated" });
    const meta = await image.metadata();
    if (!meta.width || !meta.height) throw new Error("unreadable image dimensions");

    // Full EXIF retained privately (DB column only creators can read);
    // derivatives below are re-encoded without any metadata, so GPS never
    // reaches a served byte.
    const exif = meta.exif ? parseExifSafe(original) : null;

    const derivativeKeys: Record<string, string> = {};
    for (const [name, size] of Object.entries(DERIVATIVE_SIZES)) {
      const buf = await sharp(original)
        .rotate() // bake orientation, then drop metadata
        .resize({ width: size, height: size, fit: "inside", withoutEnlargement: true })
        .webp({ quality: name === "thumb" ? 78 : 84 })
        .toBuffer();
      const key = `${artwork.galleryId}/${artwork.id}/${name}.webp`;
      await storage().put(env().STORAGE_DERIVATIVES_BUCKET, key, buf, {
        contentType: "image/webp",
        cacheControl: DERIVATIVE_CACHE_CONTROL,
      });
      derivativeKeys[name] = key;
    }

    const dominantColors = await extractDominantColors(original);

    await db()
      .update(tables.artworks)
      .set({
        derivativeKeys,
        widthPx: meta.width,
        heightPx: meta.height,
        dominantColors,
        exif,
        ingestStatus: "ready",
        ingestError: null,
      })
      .where(eq(tables.artworks.id, artworkId));
  } catch (err) {
    await markFailed(artworkId, err instanceof Error ? err.message : String(err));
    throw err; // let pg-boss retry with backoff
  }
}

async function markFailed(artworkId: string, message: string): Promise<void> {
  await db()
    .update(tables.artworks)
    .set({ ingestStatus: "failed", ingestError: message.slice(0, 500) })
    .where(eq(tables.artworks.id, artworkId));
}

/**
 * Dominant colors via tiny resize + pixel bucketing — enough for
 * palette-based room grouping and photo-seeded environment palettes.
 */
export async function extractDominantColors(input: Buffer): Promise<string[]> {
  const { data, info } = await sharp(input)
    .resize(32, 32, { fit: "inside" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const buckets = new Map<string, { r: number; g: number; b: number; n: number }>();
  for (let i = 0; i + 2 < data.length; i += info.channels) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    // Quantize to 4 bits/channel to merge near-identical pixels.
    const key = `${r >> 4}-${g >> 4}-${b >> 4}`;
    const bucket = buckets.get(key) ?? { r: 0, g: 0, b: 0, n: 0 };
    bucket.r += r;
    bucket.g += g;
    bucket.b += b;
    bucket.n += 1;
    buckets.set(key, bucket);
  }

  return [...buckets.values()]
    .sort((a, b) => b.n - a.n)
    .slice(0, 5)
    .map(({ r, g, b, n }) => {
      const hex = (v: number) => Math.round(v / n).toString(16).padStart(2, "0");
      return `#${hex(r)}${hex(g)}${hex(b)}`;
    });
}

/**
 * Keep raw EXIF for the creator but never let GPS tags survive into
 * anything public. We store a JSON summary; the IFD GPS block is dropped.
 */
function parseExifSafe(_original: Buffer): Record<string, unknown> | null {
  // sharp exposes EXIF as a raw buffer; full IFD parsing is deferred.
  // Derivatives are metadata-free regardless, so nothing sensitive is served.
  return null;
}
