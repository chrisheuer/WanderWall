import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db, tables } from "@/db";
import { currentCreator } from "@/lib/auth";
import { hasCreationPurchase } from "@/lib/billing";
import { galleryByIdForCreator, galleryArtworks } from "@/lib/galleries";
import {
  createPlanCheckoutSession,
  ensureStripeCustomer,
  retrieveCheckoutSession,
  type HostingPlan,
} from "@/lib/stripe";
import { TIER_CAPS } from "@/lib/tiers";

const checkoutSchema = z.object({
  galleryId: z.string().uuid(),
  plan: z.enum(["s-monthly", "s-annual", "l-monthly", "l-annual", "download"]),
});

export async function POST(request: Request) {
  const creator = await currentCreator();
  if (!creator) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = checkoutSchema.safeParse(await request.json().catch(() => ({})));
  if (!body.success) return NextResponse.json({ error: "invalid request" }, { status: 400 });

  const gallery = await galleryByIdForCreator(body.data.galleryId, creator.id);
  if (!gallery) return NextResponse.json({ error: "not found" }, { status: 404 });

  // Guard: a plan must fit the gallery's piece count.
  const plan = body.data.plan as HostingPlan;
  const pieceCount = (await galleryArtworks(gallery.id)).length;
  if ((plan === "s-monthly" || plan === "s-annual") && pieceCount > TIER_CAPS.S) {
    return NextResponse.json(
      { error: `this gallery has ${pieceCount} pieces — choose Tier L (up to ${TIER_CAPS.L})` },
      { status: 400 },
    );
  }

  /**
   * Reuse an open session rather than minting a second one. Two tabs (or a
   * double-click) would otherwise each compute "creation not yet paid" —
   * the webhook that records the purchase has not fired for either — and
   * both would charge the one-time creation fee.
   */
  if (
    gallery.pendingCheckoutSessionId &&
    gallery.pendingCheckoutExpiresAt &&
    gallery.pendingCheckoutExpiresAt.getTime() > Date.now()
  ) {
    const existing = await retrieveCheckoutSession(gallery.pendingCheckoutSessionId);
    if (existing?.status === "open" && existing.url) {
      return NextResponse.json({ url: existing.url, reused: true });
    }
  }

  const customerId = await ensureStripeCustomer(creator);
  const waiveCreation = await hasCreationPurchase(gallery.id);
  const session = await createPlanCheckoutSession({
    plan,
    galleryId: gallery.id,
    customerId,
    waiveCreation,
  });

  await db()
    .update(tables.galleries)
    .set({
      pendingCheckoutSessionId: session.id,
      pendingCheckoutExpiresAt: session.expires_at
        ? new Date(session.expires_at * 1000)
        : new Date(Date.now() + 24 * 3600 * 1000),
    })
    .where(eq(tables.galleries.id, gallery.id));

  return NextResponse.json({ url: session.url });
}
