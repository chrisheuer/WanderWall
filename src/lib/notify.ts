import { db, tables } from "@/db";
import { enqueue, QUEUES } from "@/lib/queue";

/**
 * Enqueue a notification at most once per dedupe key, ever.
 *
 * Stripe redelivers webhooks and the daily sweep re-evaluates the same
 * subscriptions, so "send once" has to be recorded durably — a pg-boss
 * singleton key only dedups while the job is still queued. The log row is
 * claimed first: if the insert conflicts, someone already sent it.
 */
export async function enqueueOnce(
  dedupeKey: string,
  queue: typeof QUEUES.sendEmail | typeof QUEUES.billingEmail,
  data: object,
): Promise<boolean> {
  const claimed = await db()
    .insert(tables.notificationLog)
    .values({ dedupeKey })
    .onConflictDoNothing({ target: tables.notificationLog.dedupeKey })
    .returning({ id: tables.notificationLog.id });

  if (claimed.length === 0) return false; // already sent
  await enqueue(queue, data);
  return true;
}
