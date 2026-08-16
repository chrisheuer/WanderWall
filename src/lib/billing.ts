import { and, desc, eq, inArray } from "drizzle-orm";
import { db, tables } from "@/db";
import type { Gallery } from "@/lib/galleries";

/**
 * Payment state questions, answered from the Stripe-mirrored tables
 * (webhook-driven). Publishing is gated here; Checkout lives in the
 * payments module.
 */

/** Hosting is active while Stripe still considers the subscription live. */
export async function hostingActive(galleryId: string): Promise<boolean> {
  const subs = await db()
    .select()
    .from(tables.subscriptions)
    .where(
      and(
        eq(tables.subscriptions.galleryId, galleryId),
        inArray(tables.subscriptions.status, ["active", "trialing", "past_due"]),
      ),
    )
    .limit(1);
  return subs.length > 0;
}

export async function hasCreationPurchase(galleryId: string): Promise<boolean> {
  const rows = await db()
    .select()
    .from(tables.purchases)
    .where(
      and(
        eq(tables.purchases.galleryId, galleryId),
        inArray(tables.purchases.kind, ["creation", "annual_bundle"]),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

export async function hasDownloadPurchase(galleryId: string): Promise<boolean> {
  const rows = await db()
    .select()
    .from(tables.purchases)
    .where(
      and(eq(tables.purchases.galleryId, galleryId), eq(tables.purchases.kind, "download")),
    )
    .limit(1);
  return rows.length > 0;
}

export type PublishGate =
  | { allowed: true }
  | { allowed: false; reason: "needs-payment" | "download-tier" };

/**
 * Hosted publishing requires creation payment + active hosting (the annual
 * bundle covers both). Download-tier galleries never publish — their
 * deliverable is the export.
 */
export async function publishGate(gallery: Gallery): Promise<PublishGate> {
  if (gallery.tier === "download") return { allowed: false, reason: "download-tier" };
  const [paidCreation, hosting] = await Promise.all([
    hasCreationPurchase(gallery.id),
    hostingActive(gallery.id),
  ]);
  if (paidCreation && hosting) return { allowed: true };
  return { allowed: false, reason: "needs-payment" };
}

export async function latestSubscription(galleryId: string) {
  const [sub] = await db()
    .select()
    .from(tables.subscriptions)
    .where(eq(tables.subscriptions.galleryId, galleryId))
    .orderBy(desc(tables.subscriptions.updatedAt))
    .limit(1);
  return sub ?? null;
}
