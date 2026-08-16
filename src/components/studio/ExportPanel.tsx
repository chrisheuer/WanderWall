"use client";

import { useState } from "react";

/** Build + download static exports; set the export donate link. */
export function ExportPanel({
  galleryId,
  lastExportAt,
  exportDonationUrl,
}: {
  galleryId: string;
  lastExportAt: string | null;
  exportDonationUrl: string | null;
}) {
  const [busy, setBusy] = useState(false);
  const [queued, setQueued] = useState(false);
  const [donateUrl, setDonateUrl] = useState(exportDonationUrl ?? "");
  const [error, setError] = useState<string | null>(null);

  async function build() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/galleries/${galleryId}/export`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (res.status === 402) {
        window.location.href = `/studio/galleries/${galleryId}/checkout`;
        return;
      }
      if (!res.ok) throw new Error(typeof body.error === "string" ? body.error : "export failed");
      setQueued(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "export failed");
    } finally {
      setBusy(false);
    }
  }

  async function saveDonateUrl() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/galleries/${galleryId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ exportDonationUrl: donateUrl || null }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(typeof body.error === "string" ? body.error : "save failed");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "save failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card" style={{ maxWidth: 640 }}>
      <p style={{ marginTop: 0 }}>
        Export a fully static build of this gallery — 3D navigation, the 2D list fallback,
        captions, and license badges — as a zip that runs on any static host. It’s yours to keep.
      </p>
      <p>
        <button className="btn" disabled={busy} onClick={build}>
          {busy ? "Queuing…" : queued ? "Building — we’ll email you the link" : "Build export"}
        </button>{" "}
        {lastExportAt ? (
          <a className="btn btn-secondary" href={`/api/galleries/${galleryId}/export/download`}>
            Download latest ({lastExportAt.slice(0, 10)})
          </a>
        ) : null}
      </p>
      <div className="field">
        <label>Donate button in exports (optional Stripe Payment Link)</label>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            placeholder="https://buy.stripe.com/…"
            value={donateUrl}
            onChange={(e) => setDonateUrl(e.target.value)}
          />
          <button className="btn btn-secondary" disabled={busy} onClick={saveDonateUrl}>
            Save
          </button>
        </div>
        <p className="muted small" style={{ marginBottom: 0 }}>
          If empty, exports simply omit the donate button.
        </p>
      </div>
      {error ? <p className="notice">{error}</p> : null}
    </div>
  );
}
