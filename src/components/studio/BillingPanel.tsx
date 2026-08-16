"use client";

import { useState } from "react";
import { TIER_CAPS } from "@/lib/tiers";

/**
 * Billing status inside Studio: prominent one-click-cancel portal link,
 * tier upgrade with proration, and the path to Checkout when unpaid.
 */
export function BillingPanel({
  galleryId,
  tier,
  status,
  hostingActive,
  pieceCount,
  cancelAtPeriodEnd,
  currentPeriodEnd,
}: {
  galleryId: string;
  tier: string;
  status: string;
  hostingActive: boolean;
  pieceCount: number;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: string | null;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function openPortal() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/billing/portal", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ galleryId }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof body.error === "string" ? body.error : "portal failed");
      window.location.href = body.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "portal failed");
      setBusy(false);
    }
  }

  async function upgrade() {
    if (!window.confirm("Upgrade to Tier L? Your subscription is prorated — no new creation fee.")) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/billing/upgrade-tier", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ galleryId }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof body.error === "string" ? body.error : "upgrade failed");
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "upgrade failed");
      setBusy(false);
    }
  }

  return (
    <div className="card" style={{ maxWidth: 640 }}>
      {hostingActive ? (
        <>
          <p style={{ marginTop: 0 }}>
            Hosting is <strong>active</strong>
            {currentPeriodEnd ? (
              <span className="muted small">
                {" "}
                — {cancelAtPeriodEnd ? "ends" : "renews"} {currentPeriodEnd.slice(0, 10)}
              </span>
            ) : null}
            .
          </p>
          <p>
            <button className="btn btn-secondary" disabled={busy} onClick={openPortal}>
              Manage billing / cancel (one click)
            </button>{" "}
            {tier === "S" && pieceCount > TIER_CAPS.S ? (
              <button className="btn" disabled={busy} onClick={upgrade}>
                Upgrade to Tier L (prorated)
              </button>
            ) : null}
          </p>
          <p className="muted small" style={{ marginBottom: 0 }}>
            Cancelling keeps the gallery live to the end of the paid period, then freezes it —
            exportable or reactivatable, never deleted.
          </p>
        </>
      ) : (
        <>
          <p style={{ marginTop: 0 }}>
            {status === "frozen"
              ? "Hosting has ended — the public page is paused. Reactivate to bring it back, or export your gallery."
              : tier === "download"
                ? "Download gallery — no hosting. Upgrade to hosting to publish at a link and re-enable editing."
                : "No active hosting yet."}
          </p>
          <a className="btn" href={`/studio/galleries/${galleryId}/checkout`}>
            {status === "frozen" ? "Reactivate hosting" : "Choose a plan"}
          </a>
        </>
      )}
      {error ? <p className="notice">{error}</p> : null}
    </div>
  );
}
