"use client";

import { useState } from "react";
import { PRICING } from "@/lib/tiers";

function usd(cents: number): string {
  return `$${(cents / 100).toFixed(2).replace(/\.00$/, "")}`;
}

export function PlanPicker({
  galleryId,
  needsL,
  currentTier,
}: {
  galleryId: string;
  needsL: boolean;
  currentTier?: string;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function checkout(plan: string) {
    setBusy(plan);
    setError(null);
    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ galleryId, plan }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof body.error === "string" ? body.error : "checkout failed");
      window.location.href = body.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "checkout failed");
      setBusy(null);
    }
  }

  const tiers = [
    !needsL && {
      key: "S",
      title: `Tier S — up to 50 pieces`,
      monthly: {
        plan: "s-monthly",
        label: `${usd(PRICING.creationOneTimeCents)} creation + ${usd(PRICING.S.monthlyCents)}/month`,
      },
      annual: {
        plan: "s-annual",
        label: `${usd(PRICING.S.annualBundleCents)}/year — first year includes creation`,
      },
    },
    {
      key: "L",
      title: `Tier L — 51 to 120 pieces`,
      monthly: {
        plan: "l-monthly",
        label: `${usd(PRICING.creationOneTimeCents)} creation + ${usd(PRICING.L.monthlyCents)}/month`,
      },
      annual: {
        plan: "l-annual",
        label: `${usd(PRICING.L.annualBundleCents)}/year — first year includes creation`,
      },
    },
  ].filter(Boolean) as Array<{
    key: string;
    title: string;
    monthly: { plan: string; label: string };
    annual: { plan: string; label: string };
  }>;

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {currentTier === "download" ? (
        <p className="notice">
          You bought this gallery as a download. Moving to hosting is priced separately — a
          monthly plan includes the one-time creation fee again, and an annual plan covers it in
          the first year. Your existing download and its export stay yours either way.
        </p>
      ) : null}
      {tiers.map((t) => (
        <div className="card" key={t.key}>
          <h3 style={{ marginTop: 0 }}>{t.title}</h3>
          <p className="muted small">
            Hosted at your link, with unlimited updates while hosting is active: add, remove,
            swap, rearrange, and restyle works any time within the cap — no extra charge.
          </p>
          <p>
            <button
              className="btn"
              disabled={busy !== null}
              onClick={() => checkout(t.annual.plan)}
            >
              {busy === t.annual.plan ? "Starting…" : t.annual.label}
            </button>{" "}
            <button
              className="btn btn-secondary"
              disabled={busy !== null}
              onClick={() => checkout(t.monthly.plan)}
            >
              {busy === t.monthly.plan ? "Starting…" : t.monthly.label}
            </button>
          </p>
        </div>
      ))}
      <div className="card">
        <h3 style={{ marginTop: 0 }}>Download only — {usd(PRICING.downloadOneTimeCents)}</h3>
        <p className="muted small">
          Creation tooling + a full static export you can host anywhere. Edit and re-export for 3
          days after purchase; after that the gallery is read-only here and your latest export
          stays downloadable forever. Upgrading to hosting later re-enables editing.
        </p>
        <button
          className="btn btn-secondary"
          disabled={busy !== null}
          onClick={() => checkout("download")}
        >
          {busy === "download" ? "Starting…" : "Buy download"}
        </button>
      </div>
      {error ? <p className="notice">{error}</p> : null}
    </div>
  );
}
