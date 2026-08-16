import { eq } from "drizzle-orm";
import { db, tables } from "@/db";
import { env } from "@/lib/env";
import {
  accessTokenFor,
  downloadDropboxFile,
  downloadGdriveFile,
  listDropboxFolder,
  listGdriveFolder,
  type Provider,
} from "@/lib/cloud-imports";
import { galleryArtworks } from "@/lib/galleries";
import { enqueue, QUEUES } from "@/lib/queue";
import { storage } from "@/lib/storage";
import { pieceCapFor, type Tier } from "@/lib/tiers";

/**
 * One resumable page of a Drive/Dropbox folder import. Each chunk lists
 * one provider page, copies its images through the single ingest
 * pipeline, persists the cursor, and re-enqueues itself — so a long
 * import survives bounded cron drains and crashes lose at most a page.
 */

export interface ImportChunkJobData {
  importRunId: string;
}

export async function runImportChunkJob(data: ImportChunkJobData): Promise<void> {
  const [run] = await db()
    .select()
    .from(tables.importRuns)
    .where(eq(tables.importRuns.id, data.importRunId))
    .limit(1);
  if (!run || run.status !== "running") return;

  const [gallery] = await db()
    .select()
    .from(tables.galleries)
    .where(eq(tables.galleries.id, run.galleryId))
    .limit(1);
  if (!gallery) {
    await failRun(run.id, "gallery no longer exists");
    return;
  }

  try {
    const provider = run.provider as Provider;
    const token = await accessTokenFor(gallery.creatorId, provider);
    const page =
      provider === "gdrive"
        ? await listGdriveFolder(token, run.folderRef, run.cursor)
        : await listDropboxFolder(token, run.folderRef, run.cursor);

    const cap = pieceCapFor(gallery.tier as Tier);
    let count = (await galleryArtworks(gallery.id)).length;
    let processed = run.processedFiles;
    let capped = false;

    for (const file of page.files) {
      if (count >= cap) {
        capped = true;
        break;
      }
      const [artwork] = await db()
        .insert(tables.artworks)
        .values({
          galleryId: gallery.id,
          title: file.name.replace(/\.[a-z0-9]+$/i, ""),
          sortOrder: count,
          sourceType: provider,
          sourceRef: file.id,
          ingestStatus: "pending",
        })
        .returning();

      const bytes =
        provider === "gdrive"
          ? await downloadGdriveFile(token, file.id)
          : await downloadDropboxFile(token, file.id);

      const key = `${gallery.id}/${artwork.id}/original`;
      await storage().put(env().STORAGE_ORIGINALS_BUCKET, key, bytes);
      await db()
        .update(tables.artworks)
        .set({ originalKey: key })
        .where(eq(tables.artworks.id, artwork.id));
      await enqueue(QUEUES.ingest, { artworkId: artwork.id });

      count += 1;
      processed += 1;
    }

    const done = capped || !page.nextCursor;
    await db()
      .update(tables.importRuns)
      .set({
        cursor: page.nextCursor,
        processedFiles: processed,
        status: done ? "done" : "running",
        error: capped
          ? `stopped at the ${cap}-piece tier cap; remaining files were not imported`
          : null,
        updatedAt: new Date(),
      })
      .where(eq(tables.importRuns.id, run.id));

    if (!done) {
      await enqueue(QUEUES.importChunk, { importRunId: run.id });
    }
  } catch (err) {
    await failRun(run.id, err instanceof Error ? err.message : String(err));
    throw err;
  }
}

async function failRun(id: string, message: string): Promise<void> {
  await db()
    .update(tables.importRuns)
    .set({ status: "failed", error: message.slice(0, 500), updatedAt: new Date() })
    .where(eq(tables.importRuns.id, id));
}
