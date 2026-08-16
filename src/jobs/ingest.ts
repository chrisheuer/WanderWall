import { eq } from "drizzle-orm";
import exifReader from "exif-reader";
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
    const processed = await processImage(original);

    const derivativeKeys: Record<string, string> = {};
    for (const [name, buf] of Object.entries(processed.derivatives)) {
      const key = `${artwork.galleryId}/${artwork.id}/${name}.webp`;
      await storage().put(env().STORAGE_DERIVATIVES_BUCKET, key, buf, {
        contentType: "image/webp",
        cacheControl: DERIVATIVE_CACHE_CONTROL,
      });
      derivativeKeys[name] = key;
    }

    await db()
      .update(tables.artworks)
      .set({
        derivativeKeys,
        widthPx: processed.width,
        heightPx: processed.height,
        dominantColors: processed.dominantColors,
        exif: processed.exif,
        ingestStatus: "ready",
        ingestError: null,
      })
      .where(eq(tables.artworks.id, artworkId));
  } catch (err) {
    await markFailed(artworkId, err instanceof Error ? err.message : String(err));
    throw err; // let pg-boss retry with backoff
  }
}

export interface ProcessedImage {
  derivatives: Record<string, Buffer>;
  width: number;
  height: number;
  dominantColors: string[];
  exif: Record<string, unknown> | null;
}

/**
 * The whole image transform, free of storage and database so it can be
 * exercised directly (see scripts/check-ingest.ts). Derivatives are
 * re-encoded without a metadata directive, which is what guarantees no
 * EXIF — and therefore no GPS — survives into anything we serve.
 */
export async function processImage(original: Buffer): Promise<ProcessedImage> {
  const meta = await sharp(original, { failOn: "truncated" }).metadata();
  if (!meta.width || !meta.height) throw new Error("unreadable image dimensions");

  const derivatives: Record<string, Buffer> = {};
  for (const [name, size] of Object.entries(DERIVATIVE_SIZES)) {
    derivatives[name] = await sharp(original)
      .rotate() // bake orientation, then drop metadata
      .resize({ width: size, height: size, fit: "inside", withoutEnlargement: true })
      .webp({ quality: name === "thumb" ? 78 : 84 })
      .toBuffer();
  }

  return {
    derivatives,
    width: meta.width,
    height: meta.height,
    dominantColors: await extractDominantColors(original),
    // Full EXIF retained privately for the creator.
    exif: meta.exif ? parseExif(meta.exif) : null,
  };
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
 * Parse the raw EXIF block into JSON for the creator's private record —
 * camera, lens, exposure, and yes, GPS. This column is only ever read
 * behind the creator's own auth; nothing here is serialized into a public
 * page or an export.
 */
function parseExif(raw: Buffer): Record<string, unknown> | null {
  try {
    const parsed = exifReader(raw) as unknown as Record<string, unknown>;
    // Dates arrive as Date objects; JSON columns need plain values.
    return JSON.parse(
      JSON.stringify(parsed, (_key, value) =>
        value instanceof Date ? value.toISOString() : value,
      ),
    );
  } catch {
    // A malformed EXIF block is not a reason to fail an otherwise good
    // image — the picture matters more than its metadata.
    return null;
  }
}
