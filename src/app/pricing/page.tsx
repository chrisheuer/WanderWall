import type { Metadata } from "next";
import Link from "next/link";
import { PRICING, TIER_CAPS } from "@/lib/tiers";

export const metadata: Metadata = { title: "Pricing" };

function usd(cents: number): string {
  return `$${(cents / 100).toFixed(2).replace(/\.00$/, "")}`;
}

export default function PricingPage() {
  return (
    <main className="container" style={{ padding: "56px 24px", maxWidth: 860 }}>
      <h1 style={{ marginTop: 0 }}>Pricing</h1>
      <p className="muted" style={{ maxWidth: 620 }}>
        One creation fee, honest hosting, and an exit that’s always open. Promotion codes work on
        everything.
      </p>

      <div style={{ display: "grid", gap: 20, gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", marginTop: 28 }}>
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Tier S</h2>
          <p className="muted small">Up to {TIER_CAPS.S} pieces</p>
          <p style={{ fontSize: 22, margin: "8px 0" }}>
            {usd(PRICING.S.monthlyCents)}/month
            <span className="muted small"> + {usd(PRICING.creationOneTimeCents)} one-time creation</span>
          </p>
          <p>
            or <strong>{usd(PRICING.S.annualBundleCents)}/year</strong>
            <span className="muted small"> — first year includes creation</span>
          </p>
        </div>
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Tier L</h2>
          <p className="muted small">51 to {TIER_CAPS.L} pieces</p>
          <p style={{ fontSize: 22, margin: "8px 0" }}>
            {usd(PRICING.L.monthlyCents)}/month
            <span className="muted small"> + {usd(PRICING.creationOneTimeCents)} one-time creation</span>
          </p>
          <p>
            or <strong>{usd(PRICING.L.annualBundleCents)}/year</strong>
            <span className="muted small"> — first year includes creation</span>
          </p>
        </div>
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Download only</h2>
          <p className="muted small">No hosting — the gallery is yours as files</p>
          <p style={{ fontSize: 22, margin: "8px 0" }}>{usd(PRICING.downloadOneTimeCents)} once</p>
          <p className="muted small">
            Full creation tooling + a static export that runs on any host. Edit and re-export for
            3 days after purchase; your latest export stays downloadable forever.
          </p>
        </div>
      </div>

      <section style={{ marginTop: 40, maxWidth: 680 }}>
        <h2>Updates are included</h2>
        <p>
          While your gallery is on active monthly or annual hosting, you can add, remove, swap,
          rearrange, and restyle works at any time within your tier’s piece cap —{" "}
          <strong>at no additional charge</strong>. Growing past {TIER_CAPS.S} pieces upgrades
          your subscription to Tier L with prorated billing; you never pay creation twice.
        </p>
        <h2>Honest renewals, easy exit</h2>
        <ul style={{ lineHeight: 1.7 }}>
          <li>We email you 30 and 7 days before an annual renewal.</li>
          <li>Cancel in one click from the billing portal. No retention flows.</li>
          <li>
            After cancelling, your gallery stays live until the period you’ve paid for ends, then
            freezes — exportable or reactivatable, never silently deleted.
          </li>
          <li>Every hosted gallery can be exported as a static site you own outright.</li>
        </ul>
        <p>
          <Link href="/studio" className="btn">
            Start in the Studio
          </Link>
        </p>
      </section>
    </main>
  );
}
