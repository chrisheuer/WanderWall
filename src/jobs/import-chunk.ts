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
    const existing = await galleryArtworks(gallery.id);
    let count = existing.length;
    let nextSortOrder = existing.reduce((max, a) => Math.max(max, a.sortOrder + 1), 0);
    let processed = run.processedFiles;
    let capped = false;
    const skipped: string[] = [];

    for (const file of page.files) {
      if (count >= cap) {
        capped = true;
        break;
      }

      // Claim the file first. The unique (gallery_id, source_ref) index
      // makes this the dedup point: a redelivered chunk — pg-boss is
      // at-least-once — returns no row here and skips the file instead of
      // importing it a second time.
      const [artwork] = await db()
        .insert(tables.artworks)
        .values({
          galleryId: gallery.id,
          title: file.name.replace(/\.[a-z0-9]+$/i, ""),
          // Advances per row claimed, not per successful download, so a
          // file that fails to fetch does not leave two pieces sharing a
          // position.
          sortOrder: nextSortOrder++,
          sourceType: provider,
          sourceRef: file.id,
          ingestStatus: "pending",
        })
        .onConflictDoNothing()
        .returning();
      if (!artwork) continue; // already imported

      // One unreadable file must not abort the run. Mark it failed, keep
      // going, and let the creator see which files did not come across.
      try {
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
      } catch (fileErr) {
        skipped.push(file.name);
        await db()
          .update(tables.artworks)
          .set({
            ingestStatus: "failed",
            ingestError: (fileErr instanceof Error ? fileErr.message : String(fileErr)).slice(
              0,
              500,
            ),
          })
          .where(eq(tables.artworks.id, artwork.id));
      }
      processed += 1;
    }

    const done = capped || !page.nextCursor;
    const notes: string[] = [];
    if (capped) notes.push(`stopped at the ${cap}-piece tier cap; remaining files were skipped`);
    if (skipped.length > 0) notes.push(`could not import: ${skipped.slice(0, 10).join(", ")}`);

    await db()
      .update(tables.importRuns)
      .set({
        cursor: page.nextCursor,
        processedFiles: processed,
        status: done ? "done" : "running",
        error: notes.length > 0 ? notes.join(" · ").slice(0, 500) : run.error,
        updatedAt: new Date(),
      })
      .where(eq(tables.importRuns.id, run.id));

    if (!done) {
      // Keyed so a duplicate delivery cannot start a second chain walking
      // the same cursor.
      await enqueue(
        QUEUES.importChunk,
        { importRunId: run.id },
        { singletonKey: `import:${run.id}:${page.nextCursor ?? "end"}` },
      );
    }
  } catch (err) {
    // Only listing/auth failures reach here now, and those are worth
    // retrying: leave the run resumable from its saved cursor rather than
    // marking it failed, which would make every retry a no-op.
    const message = err instanceof Error ? err.message : String(err);
    const permanent = /not connected|reconnect|401|403/i.test(message);
    if (permanent) {
      await failRun(run.id, message);
      return;
    }
    await db()
      .update(tables.importRuns)
      .set({ error: message.slice(0, 500), updatedAt: new Date() })
      .where(eq(tables.importRuns.id, run.id));
    throw err; // pg-boss retries with backoff, resuming from run.cursor
  }
}

async function failRun(id: string, message: string): Promise<void> {
  await db()
    .update(tables.importRuns)
    .set({ status: "failed", error: message.slice(0, 500), updatedAt: new Date() })
    .where(eq(tables.importRuns.id, id));
}
