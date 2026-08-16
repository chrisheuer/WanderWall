import PgBoss from "pg-boss";
import { env } from "@/lib/env";

/**
 * DB-backed job queue on the same Supabase Postgres. Producers (API routes)
 * call enqueue(); consumers run in the worker (src/worker) or the
 * cron-triggered drain route (/api/queue/drain).
 */

export const QUEUES = {
  ingest: "ingest", // one artwork: fetch/original → derivatives
  urlFetch: "url-fetch", // server-side copy of a pasted URL
  importChunk: "import-chunk", // one resumable page of a Drive/Dropbox folder
  exportBuild: "export-build", // static zip build
  billingEmail: "billing-email", // scheduled renewal reminders / dunning
  sendEmail: "send-email", // generic Resend dispatch
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

let boss: PgBoss | null = null;
let started: Promise<PgBoss> | null = null;

export function getBoss(): Promise<PgBoss> {
  if (!started) {
    boss = new PgBoss({
      connectionString: env().DATABASE_URL,
      max: 2,
      // Retry with backoff; ingest jobs are idempotent by artwork id.
      retryLimit: 4,
      retryDelay: 30,
      retryBackoff: true,
    });
    boss.on("error", (err) => console.error("[pg-boss]", err));
    started = boss.start();
  }
  return started;
}

export async function enqueue<T extends object>(
  queue: QueueName,
  data: T,
  options?: PgBoss.SendOptions,
): Promise<string | null> {
  const b = await getBoss();
  await b.createQueue(queue).catch(() => {});
  return b.send(queue, data, options ?? {});
}

export async function stopBoss(): Promise<void> {
  if (boss) {
    await boss.stop({ graceful: true });
    boss = null;
    started = null;
  }
}
