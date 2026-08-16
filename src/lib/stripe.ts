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
