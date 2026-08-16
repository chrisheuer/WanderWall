import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { db, tables } from "@/db";
import { env } from "@/lib/env";
import { QUEUES } from "@/lib/queue";
import { enqueueOnce } from "@/lib/notify";
import { stripe, appUrl } from "@/lib/stripe";
import { DOWNLOAD_EDIT_WINDOW_DAYS } from "@/lib/tiers";

/**
 * Stripe is the source of truth for money; these tables are a mirror,
 * written only here (webhook-driven). Handlers are idempotent — Stripe
 * retries deliveries.
 */

export async function POST(request: Request) {
  const payload = await request.text();
  const signature = request.headers.get("stripe-signature");
  if (!signature) return NextResponse.json({ error: "missing signature" }, { status: 400 });

  let event: Stripe.Event;
  try {
    event = stripe().webhooks.constructEvent(payload, signature, env().STRIPE_WEBHOOK_SECRET);
  } catch {
    return NextResponse.json({ error: "invalid signature" }, { status: 400 });
  }

  switch (event.type) {
    case "checkout.session.completed":
      await onCheckoutCompleted(event.data.object);
      break;
    case "customer.subscription.created":
    case "customer.subscription.updated":
      await onSubscriptionUpserted(event.data.object);
      break;
    case "customer.subscription.deleted":
      await onSubscriptionDeleted(event.data.object);
      break;
    case "invoice.upcoming":
      await onInvoiceUpcoming(event.data.object);
      break;
    case "invoice.payment_failed":
      await onPaymentFailed(event.data.object);
      break;
    default:
      break;
  }

  return NextResponse.json({ received: true });
}

async function galleryWithCreator(galleryId: string) {
  const [gallery] = await db()
    .select()
    .from(tables.galleries)
    .where(eq(tables.galleries.id, galleryId))
    .limit(1);
  if (!gallery) return null;
  const [creator] = await db()
    .select()
    .from(tables.creators)
    .where(eq(tables.creators.id, gallery.creatorId))
    .limit(1);
  return creator ? { gallery, creator } : null;
}

async function onCheckoutCompleted(session: Stripe.Checkout.Session) {
  const kind = session.metadata?.kind;
  const galleryId = session.metadata?.galleryId;
  if (!kind || !galleryId) return;

  // This session is spent; release the gallery's pending-checkout hold.
  if (kind !== "donation") {
    await db()
      .update(tables.galleries)
      .set({ pendingCheckoutSessionId: null, pendingCheckoutExpiresAt: null })
      .where(eq(tables.galleries.id, galleryId));
  }

  if (kind === "donation") {
    const found = await galleryWithCreator(galleryId);
    if (!found) return;
    await db()
      .insert(tables.donations)
      .values({
        galleryId,
        stripeCheckoutSessionId: session.id,
        amountCents: session.amount_total ?? 0,
        currency: session.currency ?? "usd",
        donorName: session.metadata?.donorName || null,
        donorMessage: session.metadata?.donorMessage || null,
      })
      .onConflictDoNothing();
    await enqueueOnce(`donation-receipt:${session.id}`, QUEUES.sendEmail, {
      to: found.creator.email,
      subject: `New donation for "${found.gallery.title}"`,
      template: "DonationReceiptEmail",
      props: {
        galleryTitle: found.gallery.title,
        amountCents: session.amount_total ?? 0,
        donorName: session.metadata?.donorName || undefined,
      },
    });
    return;
  }

  const found = await galleryWithCreator(galleryId);
  if (!found) return;
  const { gallery, creator } = found;

  if (kind === "download") {
    await db()
      .insert(tables.purchases)
      .values({
        creatorId: creator.id,
        galleryId,
        kind: "download",
        stripeCheckoutSessionId: session.id,
        stripePaymentIntentId:
          typeof session.payment_intent === "string" ? session.payment_intent : null,
        amountCents: session.amount_total ?? 0,
        currency: session.currency ?? "usd",
      })
      .onConflictDoNothing();
    // Anchor the window to the purchase, not to when this webhook happened
    // to be processed — a delayed redelivery would otherwise silently
    // extend the 3 days past what was sold.
    const purchasedAt = session.created ? session.created * 1000 : Date.now();
    const expires = new Date(purchasedAt + DOWNLOAD_EDIT_WINDOW_DAYS * 24 * 3600 * 1000);
    await db()
      .update(tables.galleries)
      .set({
        tier: "download",
        // Never shorten a window already granted (e.g. two deliveries).
        editWindowExpiresAt:
          gallery.editWindowExpiresAt && gallery.editWindowExpiresAt > expires
            ? gallery.editWindowExpiresAt
            : expires,
        updatedAt: new Date(),
      })
      .where(eq(tables.galleries.id, galleryId));
  } else if (kind === "hosting-monthly" || kind === "hosting-annual") {
    const tier = session.metadata?.tier === "L" ? "L" : "S";
    if (session.metadata?.includesCreation === "true") {
      await db()
        .insert(tables.purchases)
        .values({
          creatorId: creator.id,
          galleryId,
          kind: kind === "hosting-annual" ? "annual_bundle" : "creation",
          stripeCheckoutSessionId: session.id,
          amountCents: session.amount_total ?? 0,
          currency: session.currency ?? "usd",
        })
        .onConflictDoNothing();
    }
    // Hosting purchased: set tier; unfreeze / re-open editing. A gallery
    // upgrading from download loses its edit window (hosting has none).
    await db()
      .update(tables.galleries)
      .set({
        tier,
        editWindowExpiresAt: null,
        status:
          gallery.status === "frozen" || gallery.status === "readonly"
            ? "draft"
            : gallery.status,
        updatedAt: new Date(),
      })
      .where(eq(tables.galleries.id, galleryId));
  }

  await enqueueOnce(`purchase-receipt:${session.id}`, QUEUES.sendEmail, {
    to: creator.email,
    subject: "Your Wanderwall receipt",
    template: "PurchaseReceiptEmail",
    props: {
      description:
        kind === "download"
          ? `Download gallery — "${gallery.title}" (editable for ${DOWNLOAD_EDIT_WINDOW_DAYS} days)`
          : `Hosting for "${gallery.title}"`,
      amountCents: session.amount_total ?? 0,
      studioUrl: appUrl(`/studio/galleries/${gallery.id}`),
    },
  });
}

function subscriptionPeriodEnd(sub: Stripe.Subscription): Date | null {
  const item = sub.items.data[0];
  const ts =
    (item as unknown as { current_period_end?: number })?.current_period_end ??
    (sub as unknown as { current_period_end?: number }).current_period_end;
  return ts ? new Date(ts * 1000) : null;
}

async function onSubscriptionUpserted(sub: Stripe.Subscription) {
  const galleryId = sub.metadata?.galleryId;
  if (!galleryId) return;
  const found = await galleryWithCreator(galleryId);
  if (!found) return;

  const item = sub.items.data[0];
  const interval = item?.price.recurring?.interval === "year" ? "year" : "month";
  const status = (
    ["active", "past_due", "canceled", "incomplete", "trialing", "unpaid"] as const
  ).includes(sub.status as never)
    ? (sub.status as "active" | "past_due" | "canceled" | "incomplete" | "trialing" | "unpaid")
    : "incomplete";

  await db()
    .insert(tables.subscriptions)
    .values({
      creatorId: found.creator.id,
      galleryId,
      stripeSubscriptionId: sub.id,
      stripePriceId: item?.price.id ?? "",
      status,
      interval,
      currentPeriodEnd: subscriptionPeriodEnd(sub),
      cancelAtPeriodEnd: sub.cancel_at_period_end,
    })
    .onConflictDoUpdate({
      target: tables.subscriptions.stripeSubscriptionId,
      set: {
        stripePriceId: item?.price.id ?? "",
        status,
        interval,
        currentPeriodEnd: subscriptionPeriodEnd(sub),
        cancelAtPeriodEnd: sub.cancel_at_period_end,
        updatedAt: new Date(),
      },
    });

  // Tier changes made via subscription update (proration path).
  const tier = sub.metadata?.tier === "L" ? "L" : sub.metadata?.tier === "S" ? "S" : null;
  if (tier && found.gallery.tier !== tier && found.gallery.tier !== "download") {
    await db()
      .update(tables.galleries)
      .set({ tier, updatedAt: new Date() })
      .where(eq(tables.galleries.id, galleryId));
  }
}

/**
 * Cancellation honored pro-consumer: the gallery stayed live to period end
 * (Stripe fires deleted at that point for cancel_at_period_end), then
 * freezes — exportable or reactivatable, never silently deleted.
 */
async function onSubscriptionDeleted(sub: Stripe.Subscription) {
  const galleryId = sub.metadata?.galleryId;
  if (!galleryId) return;

  await db()
    .update(tables.subscriptions)
    .set({ status: "canceled", updatedAt: new Date() })
    .where(eq(tables.subscriptions.stripeSubscriptionId, sub.id));

  const found = await galleryWithCreator(galleryId);
  if (!found) return;

  // Only a gallery that was actually live needs freezing (and a notice).
  // A draft or download-tier gallery is already not public.
  if (found.gallery.status !== "published" && found.gallery.status !== "unlisted") return;

  await db()
    .update(tables.galleries)
    .set({ status: "frozen", updatedAt: new Date() })
    .where(eq(tables.galleries.id, galleryId));

  await enqueueOnce(`frozen:${sub.id}`, QUEUES.billingEmail, {
    kind: "frozen-notice",
    to: found.creator.email,
    galleryTitle: found.gallery.title,
    manageUrl: appUrl(`/studio/galleries/${galleryId}`),
  });
}

/**
 * Renewal reminders are an annual-plan courtesy: monthly subscribers do
 * not want twelve "your gallery renews soon" emails a year, and the spec
 * scopes reminders to annual renewals. The 30/7-day cadence itself comes
 * from the daily sweep, which can see exactly how far out the renewal is;
 * this handler is the near-renewal safety net, deduped against the sweep
 * by sharing its key space.
 */
async function onInvoiceUpcoming(invoice: Stripe.Invoice) {
  const subId = subscriptionIdOf(invoice);
  if (!subId) return;
  const [sub] = await db()
    .select()
    .from(tables.subscriptions)
    .where(eq(tables.subscriptions.stripeSubscriptionId, subId))
    .limit(1);
  if (!sub?.galleryId) return;
  if (sub.interval !== "year") return; // monthly plans get no reminder
  if (sub.cancelAtPeriodEnd) return; // nothing is going to renew

  const found = await galleryWithCreator(sub.galleryId);
  if (!found) return;

  const dueTs = invoice.next_payment_attempt ?? invoice.period_end;
  const renewsAt = dueTs ? new Date(dueTs * 1000) : null;
  const periodKey = renewsAt ? renewsAt.toISOString().slice(0, 10) : String(invoice.period_end);

  await enqueueOnce(`renewal:${subId}:${periodKey}:7`, QUEUES.billingEmail, {
    kind: "renewal-reminder",
    to: found.creator.email,
    galleryTitle: found.gallery.title,
    renewsAt: renewsAt ? renewsAt.toISOString().slice(0, 10) : undefined,
    amountCents: invoice.amount_due,
    manageUrl: appUrl(`/studio/galleries/${found.gallery.id}`),
  });
}

/**
 * `invoice.subscription` moved under `parent.subscription_details` in
 * Stripe's basil API. Read both so a future API bump does not silently
 * stop dunning and renewal notices.
 */
function subscriptionIdOf(invoice: Stripe.Invoice): string | null {
  const legacy = (invoice as unknown as { subscription?: unknown }).subscription;
  if (typeof legacy === "string") return legacy;
  if (legacy && typeof legacy === "object" && "id" in legacy) {
    return String((legacy as { id: unknown }).id);
  }
  const modern = (
    invoice as unknown as {
      parent?: { subscription_details?: { subscription?: unknown } };
    }
  ).parent?.subscription_details?.subscription;
  if (typeof modern === "string") return modern;
  if (modern && typeof modern === "object" && "id" in modern) {
    return String((modern as { id: unknown }).id);
  }
  return null;
}

/** Failed renewals: Stripe smart retries run; we tell the creator plainly. */
async function onPaymentFailed(invoice: Stripe.Invoice) {
  const subId = subscriptionIdOf(invoice);
  if (!subId) return;
  const [sub] = await db()
    .select()
    .from(tables.subscriptions)
    .where(eq(tables.subscriptions.stripeSubscriptionId, subId))
    .limit(1);
  if (!sub?.galleryId) return;
  const found = await galleryWithCreator(sub.galleryId);
  if (!found) return;

  // One dunning notice per failed invoice, not one per smart retry.
  await enqueueOnce(`dunning:${subId}:${invoice.id}`, QUEUES.billingEmail, {
    kind: "dunning",
    to: found.creator.email,
    galleryTitle: found.gallery.title,
    manageUrl: appUrl(`/studio/galleries/${found.gallery.id}`),
  });
}
