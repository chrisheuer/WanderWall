"use client";

import { useState } from "react";

/**
 * Persistent donate affordance. Opens a Stripe Checkout session with
 * preset + custom amounts and an optional donor name/message.
 */
export function DonateButton({
  gallerySlug,
  galleryTitle,
}: {
  gallerySlug: string;
  galleryTitle: string;
}) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState<number>(1000);
  const [custom, setCustom] = useState("");
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function donate() {
    setBusy(true);
    setError(null);
    try {
      const cents = custom ? Math.round(parseFloat(custom) * 100) : amount;
      if (!Number.isFinite(cents) || cents < 100) {
        throw new Error("Minimum donation is $1.");
      }
      const res = await fetch("/api/donate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          gallerySlug,
          amountCents: cents,
          donorName: name || undefined,
          donorMessage: message || undefined,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof body.error === "string" ? body.error : "Donation failed to start.");
      }
      window.location.href = body.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Donation failed to start.");
      setBusy(false);
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        style={{
          position: "absolute",
          bottom: 12,
          right: 244,
          background: "#8a4b2d",
          color: "#fff",
          border: "none",
          padding: "8px 16px",
          borderRadius: 3,
          fontFamily: "Georgia, serif",
          fontSize: 13,
          zIndex: 5,
        }}
      >
        ♥ Support the artist
      </button>
      {open ? (
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "rgba(15,15,13,0.55)",
            display: "grid",
            placeItems: "center",
            zIndex: 10,
          }}
          onClick={() => !busy && setOpen(false)}
        >
          <div
            style={{
              background: "#fff",
              padding: 24,
              maxWidth: 380,
              width: "92%",
              borderRadius: 4,
              fontFamily: "Georgia, serif",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ marginTop: 0 }}>Support {galleryTitle}</h3>
            <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
              {[500, 1000, 2500].map((c) => (
                <button
                  key={c}
                  onClick={() => {
                    setAmount(c);
                    setCustom("");
                  }}
                  className="btn btn-secondary"
                  style={{
                    flex: 1,
                    background: amount === c && !custom ? "#1c1b18" : "transparent",
                    color: amount === c && !custom ? "#fff" : "#1c1b18",
                  }}
                >
                  ${c / 100}
                </button>
              ))}
            </div>
            <div className="field">
              <label>Custom amount (USD)</label>
              <input
                inputMode="decimal"
                placeholder="15"
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
              />
            </div>
            <div className="field">
              <label>Your name (optional)</label>
              <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
            </div>
            <div className="field">
              <label>Message (optional)</label>
              <textarea
                rows={2}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                maxLength={280}
              />
            </div>
            {error ? <p className="notice">{error}</p> : null}
            <button className="btn" style={{ width: "100%" }} disabled={busy} onClick={donate}>
              {busy ? "Starting checkout…" : "Donate"}
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
