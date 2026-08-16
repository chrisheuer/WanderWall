import { NextResponse } from "next/server";
import { z } from "zod";
import { currentCreator } from "@/lib/auth";
import { latestSubscription } from "@/lib/billing";
import { galleryByIdForCreator } from "@/lib/galleries";
import { upgradeSubscriptionTier } from "@/lib/stripe";

/**
 * Crossing the 50-piece boundary: Stripe subscription update with
 * proration — never a new creation fee. The webhook mirrors the tier.
 */
export async function POST(request: Request) {
  const creator = await currentCreator();
  if (!creator) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = z
    .object({ galleryId: z.string().uuid() })
    .safeParse(await request.json().catch(() => ({})));
  if (!body.success) return NextResponse.json({ error: "invalid request" }, { status: 400 });

  const gallery = await galleryByIdForCreator(body.data.galleryId, creator.id);
  if (!gallery) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (gallery.tier !== "S") {
    return NextResponse.json({ error: "only Tier S galleries upgrade to L" }, { status: 400 });
  }

  const sub = await latestSubscription(gallery.id);
  if (!sub || !["active", "trialing", "past_due"].includes(sub.status)) {
    return NextResponse.json(
      { error: "no active hosting subscription to upgrade" },
      { status: 400 },
    );
  }

  await upgradeSubscriptionTier(
    sub.stripeSubscriptionId,
    sub.interval === "year" ? "year" : "month",
  );
  return NextResponse.json({ ok: true });
}
