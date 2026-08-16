import { eq } from "drizzle-orm";
import { db, tables } from "@/db";
import { env } from "@/lib/env";
import { storage } from "@/lib/storage";
import { enqueue, QUEUES } from "@/lib/queue";

/**
 * Server-side copy of a pasted URL — we store a copy, never hotlink.
 * On success the artwork enters the single ingest pipeline.
 */

export interface UrlFetchJobData {
  artworkId: string;
  url: string;
}

const MAX_BYTES = 40 * 1024 * 1024; // matches the 40MB/file upload cap
const ALLOWED_CONTENT_TYPES = /^image\/(jpeg|png|webp|avif|gif|tiff)/i;

export async function runUrlFetchJob(data: UrlFetchJobData): Promise<void> {
  const { artworkId, url } = data;

  const parsed = new URL(url); // throws on garbage
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("only http(s) URLs are supported");
  }
  assertNotPrivateHost(parsed.hostname);

  const res = await fetch(url, {
    redirect: "follow",
    signal: AbortSignal.timeout(30_000),
    headers: { "user-agent": "Wanderwall-Ingest/1.0 (+gallery image fetch)" },
  });
  if (!res.ok) throw new Error(`fetch failed: HTTP ${res.status}`);
  const contentType = res.headers.get("content-type") ?? "";
  if (!ALLOWED_CONTENT_TYPES.test(contentType)) {
    throw new Error(`not an image (content-type: ${contentType || "unknown"})`);
  }
  const body = Buffer.from(await res.arrayBuffer());
  if (body.byteLength > MAX_BYTES) throw new Error("image exceeds 40MB limit");

  const [artwork] = await db()
    .select()
    .from(tables.artworks)
    .where(eq(tables.artworks.id, artworkId))
    .limit(1);
  if (!artwork) return;

  const key = `${artwork.galleryId}/${artwork.id}/original`;
  await storage().put(env().STORAGE_ORIGINALS_BUCKET, key, body, {
    contentType,
  });
  await db()
    .update(tables.artworks)
    .set({ originalKey: key })
    .where(eq(tables.artworks.id, artworkId));

  await enqueue(QUEUES.ingest, { artworkId });
}

/** SSRF guard: refuse obvious private/loopback targets. */
function assertNotPrivateHost(hostname: string): void {
  const lower = hostname.toLowerCase();
  if (
    lower === "localhost" ||
    lower.endsWith(".local") ||
    lower.endsWith(".internal") ||
    /^127\./.test(lower) ||
    /^10\./.test(lower) ||
    /^192\.168\./.test(lower) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(lower) ||
    lower === "0.0.0.0" ||
    lower === "[::1]" ||
    lower === "169.254.169.254"
  ) {
    throw new Error("URL host is not allowed");
  }
}
