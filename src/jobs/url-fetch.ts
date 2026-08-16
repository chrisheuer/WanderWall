import { eq } from "drizzle-orm";
import { db, tables } from "@/db";
import { env } from "@/lib/env";
import { storage } from "@/lib/storage";
import { enqueue, QUEUES } from "@/lib/queue";
import { BlockedUrlError, safeFetchImage, unwrapBlocked } from "@/lib/safe-fetch";

/**
 * Server-side copy of a pasted URL — we store a copy, never hotlink.
 * On success the artwork enters the single ingest pipeline.
 *
 * All SSRF protection (address validation, per-redirect revalidation,
 * connect-time pinning) and the streaming byte cap live in safe-fetch.
 */

export interface UrlFetchJobData {
  artworkId: string;
  url: string;
}

const MAX_BYTES = 40 * 1024 * 1024; // matches the 40MB/file upload cap
const ALLOWED_CONTENT_TYPES = /^image\/(jpeg|png|webp|avif|gif|tiff)/i;

export async function runUrlFetchJob(data: UrlFetchJobData): Promise<void> {
  const { artworkId, url } = data;

  const [artwork] = await db()
    .select()
    .from(tables.artworks)
    .where(eq(tables.artworks.id, artworkId))
    .limit(1);
  if (!artwork) return; // deleted before processing
  if (artwork.originalKey) return; // idempotent re-delivery

  let fetched;
  try {
    fetched = await safeFetchImage(url, {
      maxBytes: MAX_BYTES,
      allowedContentType: ALLOWED_CONTENT_TYPES,
    });
  } catch (err) {
    const unwrapped = unwrapBlocked(err);
    // A refused URL is the creator's problem to fix, not a transient
    // fault — record it and don't burn retries.
    if (unwrapped instanceof BlockedUrlError) {
      await db()
        .update(tables.artworks)
        .set({ ingestStatus: "failed", ingestError: unwrapped.message.slice(0, 500) })
        .where(eq(tables.artworks.id, artworkId));
      return;
    }
    // Genuinely transient: retry, but leave the reason visible so a piece
    // that never succeeds does not sit there explaining nothing.
    await db()
      .update(tables.artworks)
      .set({
        ingestError: `fetch failed, retrying: ${
          err instanceof Error ? err.message : String(err)
        }`.slice(0, 500),
      })
      .where(eq(tables.artworks.id, artworkId));
    throw err;
  }

  const key = `${artwork.galleryId}/${artwork.id}/original`;
  await storage().put(env().STORAGE_ORIGINALS_BUCKET, key, fetched.body, {
    contentType: fetched.contentType,
  });
  await db()
    .update(tables.artworks)
    .set({ originalKey: key })
    .where(eq(tables.artworks.id, artworkId));

  await enqueue(QUEUES.ingest, { artworkId });
}
