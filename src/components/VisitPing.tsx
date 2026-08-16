"use client";

import { useEffect } from "react";

/** First-party analytics beacon: one visit ping + duration on leave. */
export function VisitPing({ gallerySlug }: { gallerySlug: string }) {
  useEffect(() => {
    const startedAt = Date.now();
    let visitId: string | null = null;

    void fetch("/api/visits", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ gallerySlug }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => {
        visitId = body?.visitId ?? null;
      })
      .catch(() => {});

    const onLeave = () => {
      if (!visitId) return;
      const durationSeconds = Math.round((Date.now() - startedAt) / 1000);
      navigator.sendBeacon(
        "/api/visits/duration",
        new Blob([JSON.stringify({ visitId, durationSeconds })], { type: "application/json" }),
      );
    };
    window.addEventListener("pagehide", onLeave);
    return () => window.removeEventListener("pagehide", onLeave);
  }, [gallerySlug]);

  return null;
}
