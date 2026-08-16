"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Preview → publish, gated on payment. Publishing states the ownership
 * attestation; unlisted keeps the page noindexed and out of listings.
 */
export function PublishPanel({
  galleryId,
  gallerySlug,
  status,
  tier,
  attested,
}: {
  galleryId: string;
  gallerySlug: string;
  status: string;
  tier: string;
  attested: boolean;
}) {
  const [attest, setAttest] = useState(attested);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function setMode(mode: "published" | "unlisted" | "draft") {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/galleries/${galleryId}/publish`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode, attestOwnership: attest }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.status === 402 && body.needsPayment) {
        // Payment first: hand off to Checkout, come back to publish.
        window.location.href = `/studio/galleries/${galleryId}/checkout`;
        return;
      }
      if (!res.ok) throw new Error(typeof body.error === "string" ? body.error : "publish failed");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "publish failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card" style={{ maxWidth: 640 }}>
      <p style={{ marginTop: 0 }}>
        <a href={`/g/${gallerySlug}`} className="btn btn-secondary">
          Preview gallery
        </a>{" "}
        <span className="muted small">Drafts are visible only to you.</span>
      </p>

      {tier === "download" ? (
        <p className="notice">
          This is a download gallery — it isn’t hosted here. Build and download your export from
          the Export section; upgrading to hosting makes publishing available.
        </p>
      ) : (
        <>
          {!attested ? (
            <label className="small" style={{ display: "block", margin: "12px 0" }}>
              <input
                type="checkbox"
                checked={attest}
                onChange={(e) => setAttest(e.target.checked)}
              />{" "}
              I confirm I own these works or hold the rights to publish them.
            </label>
          ) : null}
          {error ? <p className="notice">{error}</p> : null}
          <p style={{ marginBottom: 0 }}>
            {status === "published" || status === "unlisted" ? (
              <>
                <button className="btn btn-secondary" disabled={busy} onClick={() => setMode("draft")}>
                  Unpublish
                </button>{" "}
                {status === "published" ? (
                  <button className="btn btn-secondary" disabled={busy} onClick={() => setMode("unlisted")}>
                    Make unlisted
                  </button>
                ) : (
                  <button className="btn btn-secondary" disabled={busy} onClick={() => setMode("published")}>
                    Make public
                  </button>
                )}
              </>
            ) : (
              <>
                <button className="btn" disabled={busy} onClick={() => setMode("published")}>
                  {busy ? "Publishing…" : "Publish"}
                </button>{" "}
                <button className="btn btn-secondary" disabled={busy} onClick={() => setMode("unlisted")}>
                  Publish unlisted
                </button>
              </>
            )}
          </p>
          <p className="muted small" style={{ marginBottom: 0 }}>
            Unlisted galleries are reachable by link only: noindexed and excluded from listings.
            While hosting is active you can add, remove, swap, rearrange, and restyle works at any
            time within your tier’s cap — at no additional charge.
          </p>
        </>
      )}
    </div>
  );
}
