"use client";

import { useState } from "react";

/** "Submit for featuring" on published galleries. */
export function FeatureSubmitButton({ galleryId }: { galleryId: string }) {
  const [note, setNote] = useState("");
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setState("busy");
    setError(null);
    try {
      const res = await fetch(`/api/galleries/${galleryId}/featured-submission`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ note }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof body.error === "string" ? body.error : "failed");
      setState("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed");
      setState("error");
    }
  }

  if (state === "done") {
    return <p className="notice">Submitted for featuring — we’ll email you the decision.</p>;
  }

  return (
    <div style={{ marginTop: 12 }}>
      {open ? (
        <div className="card">
          <div className="field">
            <label>A short note for the curators (optional)</label>
            <textarea
              rows={2}
              maxLength={600}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
          {error ? <p className="notice">{error}</p> : null}
          <button className="btn" disabled={state === "busy"} onClick={submit}>
            {state === "busy" ? "Submitting…" : "Submit for featuring"}
          </button>
        </div>
      ) : (
        <button className="btn btn-secondary" onClick={() => setOpen(true)}>
          Submit for featuring
        </button>
      )}
    </div>
  );
}
