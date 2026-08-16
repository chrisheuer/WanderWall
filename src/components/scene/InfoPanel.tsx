"use client";

import type { PlacedArtwork } from "@/lib/layout";
import { LICENSES, type License } from "@/lib/licenses";
import { useSceneStore } from "./store";

/** Focused-artwork overlay: title, caption, license — and a way back. */
export function InfoPanel({
  placed,
  creatorName,
}: {
  placed: PlacedArtwork;
  creatorName: string;
}) {
  const focusArtwork = useSceneStore((s) => s.focusArtwork);
  const a = placed.artwork;
  const license = LICENSES[(a.license ?? "all-rights-reserved") as License];

  return (
    <div
      style={{
        position: "absolute",
        left: 12,
        bottom: 12,
        maxWidth: 340,
        background: "rgba(20,20,18,0.82)",
        color: "#f2f1ec",
        padding: "14px 16px",
        borderRadius: 4,
        fontFamily: "Georgia, serif",
      }}
      role="dialog"
      aria-label={`About ${a.title}`}
    >
      <strong style={{ fontSize: 16 }}>{a.title}</strong>
      {a.caption ? (
        <p style={{ margin: "6px 0 0", fontSize: 13, color: "#cfcec6" }}>{a.caption}</p>
      ) : null}
      <p style={{ margin: "8px 0 0", fontSize: 12 }}>
        {license.deedUrl ? (
          <a
            href={license.deedUrl}
            target="_blank"
            rel="license noopener noreferrer"
            style={{ color: "#e8d9ae" }}
          >
            {license.badge}
          </a>
        ) : (
          <span>© {creatorName}</span>
        )}
      </p>
      <button
        onClick={() => focusArtwork(null)}
        style={{
          marginTop: 10,
          background: "transparent",
          color: "#f2f1ec",
          border: "1px solid rgba(255,255,255,0.4)",
          padding: "4px 12px",
          borderRadius: 2,
          fontSize: 12,
        }}
      >
        Back to walking (Esc)
      </button>
    </div>
  );
}
