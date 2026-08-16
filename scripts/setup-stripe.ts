import Stripe from "stripe";
import { PRICING } from "@/lib/tiers";

/**
 * Create Stripe Products/Prices for the commerce model. Idempotent via
 * lookup keys. Prints the env vars to set. Run: npx tsx scripts/setup-stripe.ts
 */
async function main() {
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? "");

  async function ensurePrice(opts: {
    lookupKey: string;
    productName: string;
    unitAmount: number;
    recurring?: { interval: "month" | "year" };
  }): Promise<string> {
    const existing = await stripe.prices.list({
      lookup_keys: [opts.lookupKey],
      limit: 1,
    });
    if (existing.data[0]) return existing.data[0].id;
    const price = await stripe.prices.create({
      lookup_key: opts.lookupKey,
      currency: "usd",
      unit_amount: opts.unitAmount,
      recurring: opts.recurring,
      product_data: { name: opts.productName },
    });
    return price.id;
  }

  const creation = await ensurePrice({
    lookupKey: "wanderwall_creation",
    productName: "Gallery creation (one-time)",
    unitAmount: PRICING.creationOneTimeCents,
  });
  const sMonthly = await ensurePrice({
    lookupKey: "wanderwall_s_monthly",
    productName: "Hosting — Tier S (up to 50 pieces)",
    unitAmount: PRICING.S.monthlyCents,
    recurring: { interval: "month" },
  });
  const sAnnual = await ensurePrice({
    lookupKey: "wanderwall_s_annual_bundle",
    productName: "Hosting — Tier S annual (first year includes creation)",
    unitAmount: PRICING.S.annualBundleCents,
    recurring: { interval: "year" },
  });
  const lMonthly = await ensurePrice({
    lookupKey: "wanderwall_l_monthly",
    productName: "Hosting — Tier L (51–120 pieces)",
    unitAmount: PRICING.L.monthlyCents,
    recurring: { interval: "month" },
  });
  const lAnnual = await ensurePrice({
    lookupKey: "wanderwall_l_annual_bundle",
    productName: "Hosting — Tier L annual (first year includes creation)",
    unitAmount: PRICING.L.annualBundleCents,
    recurring: { interval: "year" },
  });
  const download = await ensurePrice({
    lookupKey: "wanderwall_download",
    productName: "Download gallery (one-time, 3-day edit window)",
    unitAmount: PRICING.downloadOneTimeCents,
  });

  console.log(`STRIPE_PRICE_CREATION=${creation}`);
  console.log(`STRIPE_PRICE_S_MONTHLY=${sMonthly}`);
  console.log(`STRIPE_PRICE_S_ANNUAL_BUNDLE=${sAnnual}`);
  console.log(`STRIPE_PRICE_L_MONTHLY=${lMonthly}`);
  console.log(`STRIPE_PRICE_L_ANNUAL_BUNDLE=${lAnnual}`);
  console.log(`STRIPE_PRICE_DOWNLOAD=${download}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
