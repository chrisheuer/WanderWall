import { enqueue, QUEUES } from "@/lib/queue";
import type { SendEmailJobData } from "./send-email";

/**
 * Scheduled billing email — renewal reminders (30/7 days before annual
 * renewal, driven by Stripe `invoice.upcoming` webhooks) and dunning after
 * failed renewals. Delivery is delegated to the send-email queue so retry
 * semantics stay in one place.
 */

export interface BillingEmailJobData {
  kind: "renewal-reminder" | "dunning" | "frozen-notice";
  to: string;
  galleryTitle: string;
  renewsAt?: string; // ISO date for reminders
  amountCents?: number;
  manageUrl: string;
}

export async function runBillingEmailJob(data: BillingEmailJobData): Promise<void> {
  const subjectByKind: Record<BillingEmailJobData["kind"], string> = {
    "renewal-reminder": `Your gallery "${data.galleryTitle}" renews soon`,
    dunning: `Payment issue for "${data.galleryTitle}"`,
    "frozen-notice": `"${data.galleryTitle}" hosting has been paused`,
  };
  const templateByKind: Record<BillingEmailJobData["kind"], SendEmailJobData["template"]> = {
    "renewal-reminder": "RenewalReminderEmail",
    dunning: "DunningEmail",
    "frozen-notice": "FrozenNoticeEmail",
  };

  await enqueue(QUEUES.sendEmail, {
    to: data.to,
    subject: subjectByKind[data.kind],
    template: templateByKind[data.kind],
    props: {
      galleryTitle: data.galleryTitle,
      renewsAt: data.renewsAt,
      amountCents: data.amountCents,
      manageUrl: data.manageUrl,
    },
  } satisfies SendEmailJobData);
}
