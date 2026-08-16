import Stripe from "stripe";
import { env } from "@/lib/env";

/**
 * The single payments module. Single-tenant v1: everything settles to the
 * platform owner's Stripe account. Multi-tenant seam: when a creator has
 * `stripe_account_id`, donation sessions gain destination charges + an
 * application fee here — call sites do not change.
 */

let client: Stripe | null = null;

export function stripe(): Stripe {
  if (!client) {
    client = new Stripe(env().STRIPE_SECRET_KEY);
  }
  return client;
}

export function appUrl(path: string): string {
  return `${env().NEXT_PUBLIC_APP_URL}${path}`;
}

/** Donation checkout — preset or custom amount, optional name/message. */
export async function createDonationSession(opts: {
  gallerySlug: string;
  galleryId: string;
  galleryTitle: string;
  amountCents: number;
  donorName?: string;
  donorMessage?: string;
  creatorStripeAccountId?: string | null;
}): Promise<Stripe.Checkout.Session> {
  const params: Stripe.Checkout.SessionCreateParams = {
    mode: "payment",
    line_items: [
      {
        price_data: {
          currency: "usd",
          unit_amount: opts.amountCents,
          product_data: {
            name: `Support “${opts.galleryTitle}”`,
            description: "A donation to the artist.",
          },
        },
        quantity: 1,
      },
    ],
    metadata: {
      kind: "donation",
      galleryId: opts.galleryId,
      donorName: opts.donorName ?? "",
      donorMessage: opts.donorMessage ?? "",
    },
    // Promotion codes are enabled on every Checkout session, donations
    // included — a supporter with a code should be able to use it.
    allow_promotion_codes: true,
    success_url: appUrl(`/g/${opts.gallerySlug}?donated=1`),
    cancel_url: appUrl(`/g/${opts.gallerySlug}`),
    submit_type: "donate",
  };

  // Stripe Connect seam (dormant in v1): destination charge + platform fee.
  // if (opts.creatorStripeAccountId) {
  //   params.payment_intent_data = {
  //     transfer_data: { destination: opts.creatorStripeAccountId },
  //     application_fee_amount: Math.round(opts.amountCents * PLATFORM_FEE),
  //   };
  // }

  return stripe().checkout.sessions.create(params);
}

export type HostingPlan =
  | "s-monthly" // creation one-time + $8/mo
  | "s-annual" // $99/yr bundle, creation included
  | "l-monthly" // creation one-time + $10/mo
  | "l-annual" // $129/yr bundle, creation included
  | "download"; // $29.99 one-time, 3-day edit window

/** Ensure the creator has a Stripe customer; store the id. */
export async function ensureStripeCustomer(creator: {
  id: string;
  email: string;
  stripeCustomerId: string | null;
}): Promise<string> {
  if (creator.stripeCustomerId) return creator.stripeCustomerId;
  const customer = await stripe().customers.create({
    email: creator.email,
    metadata: { creatorId: creator.id },
  });
  const { db, tables } = await import("@/db");
  const { eq } = await import("drizzle-orm");
  await db()
    .update(tables.creators)
    .set({ stripeCustomerId: customer.id })
    .where(eq(tables.creators.id, creator.id));
  return customer.id;
}

/**
 * Hosting/creation/download Checkout. Promotion codes are enabled on every
 * session; auto-renewal terms and the download edit window are stated in
 * the session so nothing is buried.
 */
export async function createPlanCheckoutSession(opts: {
  plan: HostingPlan;
  galleryId: string;
  customerId: string;
  waiveCreation: boolean; // creation already purchased (e.g. tier change)
}): Promise<Stripe.Checkout.Session> {
  const e = env();
  const successUrl = appUrl(`/studio/galleries/${opts.galleryId}?checkout=success`);
  const cancelUrl = appUrl(`/studio/galleries/${opts.galleryId}/checkout`);

  const base: Pick<
    Stripe.Checkout.SessionCreateParams,
    "allow_promotion_codes" | "customer" | "success_url" | "cancel_url"
  > = {
    allow_promotion_codes: true,
    customer: opts.customerId,
    success_url: successUrl,
    cancel_url: cancelUrl,
  };

  if (opts.plan === "download") {
    return stripe().checkout.sessions.create({
      ...base,
      mode: "payment",
      line_items: [{ price: e.STRIPE_PRICE_DOWNLOAD, quantity: 1 }],
      metadata: { kind: "download", galleryId: opts.galleryId },
      custom_text: {
        submit: {
          message:
            "One-time purchase. You can edit and re-export for 3 days after purchase; after that the gallery becomes read-only and your latest export stays downloadable forever.",
        },
      },
    });
  }

  const monthly = opts.plan === "s-monthly" || opts.plan === "l-monthly";
  const tierS = opts.plan.startsWith("s-");
  const recurringPrice = monthly
    ? tierS
      ? e.STRIPE_PRICE_S_MONTHLY
      : e.STRIPE_PRICE_L_MONTHLY
    : tierS
      ? e.STRIPE_PRICE_S_ANNUAL_BUNDLE
      : e.STRIPE_PRICE_L_ANNUAL_BUNDLE;

  const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [
    { price: recurringPrice, quantity: 1 },
  ];
  // Monthly plans pay the one-time creation fee alongside the first cycle;
  // annual bundles include creation in year one.
  if (monthly && !opts.waiveCreation) {
    lineItems.push({ price: e.STRIPE_PRICE_CREATION, quantity: 1 });
  }

  return stripe().checkout.sessions.create({
    ...base,
    mode: "subscription",
    line_items: lineItems,
    subscription_data: {
      metadata: { galleryId: opts.galleryId, tier: tierS ? "S" : "L" },
    },
    metadata: {
      kind: monthly ? "hosting-monthly" : "hosting-annual",
      galleryId: opts.galleryId,
      tier: tierS ? "S" : "L",
      includesCreation: String(!monthly || !opts.waiveCreation),
    },
    custom_text: {
      submit: {
        message: monthly
          ? "Renews monthly until you cancel. Cancel any time with one click — your gallery stays live to the end of the period you've paid for, and you can always export it."
          : "Renews yearly until you cancel. We'll email you 30 and 7 days before renewal. Cancel any time with one click — your gallery stays live to the end of the period you've paid for.",
      },
    },
  });
}

/** Look up a Checkout session, tolerating one that Stripe has expired. */
export async function retrieveCheckoutSession(
  sessionId: string,
): Promise<Stripe.Checkout.Session | null> {
  try {
    return await stripe().checkout.sessions.retrieve(sessionId);
  } catch {
    return null;
  }
}

/** One-click cancel and payment management: Stripe Customer Portal. */
export async function createPortalSession(customerId: string, galleryId: string) {
  return stripe().billingPortal.sessions.create({
    customer: customerId,
    return_url: appUrl(`/studio/galleries/${galleryId}`),
  });
}

/**
 * Crossing the 50-piece boundary: subscription update with proration —
 * never a new creation fee.
 */
export async function upgradeSubscriptionTier(
  stripeSubscriptionId: string,
  interval: "month" | "year",
): Promise<Stripe.Subscription> {
  const e = env();
  const sub = await stripe().subscriptions.retrieve(stripeSubscriptionId);
  const item = sub.items.data[0];
  const newPrice = interval === "month" ? e.STRIPE_PRICE_L_MONTHLY : e.STRIPE_PRICE_L_ANNUAL_BUNDLE;
  return stripe().subscriptions.update(stripeSubscriptionId, {
    items: [{ id: item.id, price: newPrice }],
    proration_behavior: "create_prorations",
    metadata: { ...sub.metadata, tier: "L" },
  });
}
