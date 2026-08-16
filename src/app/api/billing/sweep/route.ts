import { and, eq, inArray, isNotNull, lt } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db, tables } from "@/db";
import { env } from "@/lib/env";
import { enqueue, QUEUES } from "@/lib/queue";
import { appUrl } from "@/lib/stripe";

export const maxDuration = 60;

/**
 * Daily billing sweep (Vercel cron):
 *  - renewal reminders 30 and 7 days before annual renewal (backstop for
 *    invoice.upcoming; singleton keys make the pair send exactly once)
 *  - freeze galleries whose subscription lapsed without a deletion event
 */
export async function GET(request: Request) {
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${env().CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let reminders = 0;
  let frozen = 0;
  const now = Date.now();

  const annuals = await db()
    .select({
      sub: tables.subscriptions,
      gallery: tables.galleries,
      creator: tables.creators,
    })
    .from(tables.subscriptions)
    .innerJoin(tables.galleries, eq(tables.subscriptions.galleryId, tables.galleries.id))
    .innerJoin(tables.creators, eq(tables.subscriptions.creatorId, tables.creators.id))
    .where(
      and(
        eq(tables.subscriptions.interval, "year"),
        inArray(tables.subscriptions.status, ["active", "trialing"]),
        eq(tables.subscriptions.cancelAtPeriodEnd, false),
        isNotNull(tables.subscriptions.currentPeriodEnd),
      ),
    );

  for (const row of annuals) {
    const end = row.sub.currentPeriodEnd!.getTime();
    const daysLeft = Math.floor((end - now) / 86_400_000);
    for (const target of [30, 7]) {
      if (daysLeft === target) {
        await enqueue(
          QUEUES.billingEmail,
          {
            kind: "renewal-reminder",
            to: row.creator.email,
            galleryTitle: row.gallery.title,
            renewsAt: row.sub.currentPeriodEnd!.toISOString().slice(0, 10),
            manageUrl: appUrl(`/studio/galleries/${row.gallery.id}`),
          },
          { singletonKey: `sweep:${row.sub.stripeSubscriptionId}:${end}:${target}` },
        );
        reminders += 1;
      }
    }
  }

  // Lapsed subscriptions → freeze (never delete).
  const lapsed = await db()
    .select({ sub: tables.subscriptions, gallery: tables.galleries, creator: tables.creators })
    .from(tables.subscriptions)
    .innerJoin(tables.galleries, eq(tables.subscriptions.galleryId, tables.galleries.id))
    .innerJoin(tables.creators, eq(tables.subscriptions.creatorId, tables.creators.id))
    .where(
      and(
        inArray(tables.subscriptions.status, ["canceled", "unpaid"]),
        isNotNull(tables.subscriptions.currentPeriodEnd),
        lt(tables.subscriptions.currentPeriodEnd, new Date()),
        inArray(tables.galleries.status, ["published", "unlisted"]),
      ),
    );

  for (const row of lapsed) {
    await db()
      .update(tables.galleries)
      .set({ status: "frozen", updatedAt: new Date() })
      .where(eq(tables.galleries.id, row.gallery.id));
    await enqueue(
      QUEUES.billingEmail,
      {
        kind: "frozen-notice",
        to: row.creator.email,
        galleryTitle: row.gallery.title,
        manageUrl: appUrl(`/studio/galleries/${row.gallery.id}`),
      },
      { singletonKey: `frozen:${row.sub.stripeSubscriptionId}` },
    );
    frozen += 1;
  }

  // Download-tier windows that closed → readonly (export stays available).
  const expired = await db()
    .select()
    .from(tables.galleries)
    .where(
      and(
        eq(tables.galleries.tier, "download"),
        isNotNull(tables.galleries.editWindowExpiresAt),
        lt(tables.galleries.editWindowExpiresAt, new Date()),
        inArray(tables.galleries.status, ["draft", "published", "unlisted"]),
      ),
    );
  for (const gallery of expired) {
    await db()
      .update(tables.galleries)
      .set({ status: "readonly", updatedAt: new Date() })
      .where(eq(tables.galleries.id, gallery.id));
  }

  return NextResponse.json({ reminders, frozen, readonly: expired.length });
}
