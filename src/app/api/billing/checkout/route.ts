import { and, eq, isNull, lt, or } from "drizzle-orm";
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
   * Only one open Checkout session per gallery. Without this, two tabs
   * would each find creation unpaid — the webhook recording it has not
   * fired for either — and both would charge the one-time creation fee.
   *
   * The claim is taken atomically before Stripe is called: a conditional
   * UPDATE that only succeeds if no live claim exists. A plain read then
   * write leaves a window where both requests see "nothing pending" and
   * both mint a session.
   */
  const claimToken = `claiming:${crypto.randomUUID()}`;
  const claimed = await db()
    .update(tables.galleries)
    .set({
      pendingCheckoutSessionId: claimToken,
      pendingCheckoutExpiresAt: new Date(Date.now() + 5 * 60 * 1000),
    })
    .where(
      and(
        eq(tables.galleries.id, gallery.id),
        or(
          isNull(tables.galleries.pendingCheckoutSessionId),
          lt(tables.galleries.pendingCheckoutExpiresAt, new Date()),
        ),
      ),
    )
    .returning({ id: tables.galleries.id });

  if (claimed.length === 0) {
    // Someone else holds the claim. Reuse their session if it is ready.
    const [current] = await db()
      .select({ pending: tables.galleries.pendingCheckoutSessionId })
      .from(tables.galleries)
      .where(eq(tables.galleries.id, gallery.id));
    const pending = current?.pending;
    if (pending && !pending.startsWith("claiming:")) {
      const existing = await retrieveCheckoutSession(pending);
      if (existing?.status === "open" && existing.url) {
        return NextResponse.json({ url: existing.url, reused: true });
      }
    }
    return NextResponse.json(
      { error: "a checkout for this gallery is already being prepared — try again in a moment" },
      { status: 409 },
    );
  }

  try {
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
  } catch (err) {
    // Release the claim so the creator can retry immediately.
    await db()
      .update(tables.galleries)
      .set({ pendingCheckoutSessionId: null, pendingCheckoutExpiresAt: null })
      .where(
        and(
          eq(tables.galleries.id, gallery.id),
          eq(tables.galleries.pendingCheckoutSessionId, claimToken),
        ),
      )
      .catch(() => {});
    throw err;
  }
}
