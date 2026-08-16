import type PgBoss from "pg-boss";
import { QUEUES } from "@/lib/queue";
import { runIngestJob, type IngestJobData } from "./ingest";
import { runUrlFetchJob, type UrlFetchJobData } from "./url-fetch";
import { runImportChunkJob, type ImportChunkJobData } from "./import-chunk";
import { runExportBuildJob, type ExportBuildJobData } from "./export-build";
import { runBillingEmailJob, type BillingEmailJobData } from "./billing-email";
import { runSendEmailJob, type SendEmailJobData } from "./send-email";

type Handler = (data: never) => Promise<void>;

/** Every queue and its handler — shared by the worker and the drain route. */
export const JOB_HANDLERS: Record<string, Handler> = {
  [QUEUES.ingest]: (d: IngestJobData) => runIngestJob(d),
  [QUEUES.urlFetch]: (d: UrlFetchJobData) => runUrlFetchJob(d),
  [QUEUES.importChunk]: (d: ImportChunkJobData) => runImportChunkJob(d),
  [QUEUES.exportBuild]: (d: ExportBuildJobData) => runExportBuildJob(d),
  [QUEUES.billingEmail]: (d: BillingEmailJobData) => runBillingEmailJob(d),
  [QUEUES.sendEmail]: (d: SendEmailJobData) => runSendEmailJob(d),
};

/** Register long-running workers (dedicated worker process). */
export async function registerWorkers(boss: PgBoss): Promise<void> {
  for (const [queue, handler] of Object.entries(JOB_HANDLERS)) {
    await boss.createQueue(queue).catch(() => {});
    await boss.work(queue, { batchSize: 1 }, async ([job]) => {
      await handler(job.data as never);
    });
  }
}

/**
 * Drain mode for Vercel cron: fetch and run jobs for up to `budgetMs`,
 * then return — long imports chunk themselves into resumable jobs, so a
 * bounded drain always makes progress.
 */
export async function drainOnce(boss: PgBoss, budgetMs = 50_000): Promise<number> {
  const deadline = Date.now() + budgetMs;
  let processed = 0;
  let idlePasses = 0;
  while (Date.now() < deadline && idlePasses < 2) {
    let fetchedAny = false;
    for (const [queue, handler] of Object.entries(JOB_HANDLERS)) {
      if (Date.now() >= deadline) break;
      await boss.createQueue(queue).catch(() => {});
      const jobs = await boss.fetch(queue, { batchSize: 2 });
      if (!jobs || jobs.length === 0) continue;
      fetchedAny = true;
      for (const job of jobs) {
        try {
          await handler(job.data as never);
          await boss.complete(queue, job.id);
          processed += 1;
        } catch (err) {
          await boss.fail(queue, job.id, {
            message: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }
    idlePasses = fetchedAny ? 0 : idlePasses + 1;
  }
  return processed;
}
