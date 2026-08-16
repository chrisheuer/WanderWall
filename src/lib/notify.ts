import { eq } from "drizzle-orm";
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

  try {
    await enqueue(queue, data);
  } catch (err) {
    // Release the claim so a webhook redelivery or the next sweep can try
    // again. Holding it would make the failure permanent — the caller
    // would be told "already sent" forever for a mail that never went.
    await db()
      .delete(tables.notificationLog)
      .where(eq(tables.notificationLog.id, claimed[0].id))
      .catch(() => {});
    throw err;
  }
  return true;
}
