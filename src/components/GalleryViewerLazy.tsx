"use client";

import dynamic from "next/dynamic";
import type { ComponentProps } from "react";

/**
 * The scene bundle (three.js + R3F) streams after the SSR shell so the
 * public page's LCP is the shell + poster, not the renderer. The poster
 * is the gallery's first wall derivative.
 */

type ViewerProps = ComponentProps<
  typeof import("./GalleryViewer").GalleryViewer
>;

const GalleryViewer = dynamic(
  () => import("./GalleryViewer").then((m) => m.GalleryViewer),
  {
    ssr: false,
    loading: () => null,
  },
);

export function GalleryViewerLazy(props: ViewerProps & { posterUrl: string | null }) {
  const { posterUrl, ...viewerProps } = props;
  return (
    <div style={{ position: "relative" }}>
      <ScenePoster posterUrl={posterUrl} />
      <GalleryViewer {...viewerProps} />
    </div>
  );
}

function ScenePoster({ posterUrl }: { posterUrl: string | null }) {
  // Sits underneath; the viewer replaces it as soon as it mounts.
  return (
    <div
      aria-hidden
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 0,
        display: "grid",
        placeItems: "center",
        background: "#e8e6e0",
        borderRadius: 4,
        overflow: "hidden",
        minHeight: 320,
      }}
    >
      {posterUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={posterUrl}
          alt=""
          style={{ maxWidth: "70%", maxHeight: "70%", boxShadow: "0 8px 40px rgba(0,0,0,0.25)" }}
        />
      ) : (
        <span style={{ color: "#8a867c", fontFamily: "Georgia, serif" }}>Preparing gallery…</span>
      )}
    </div>
  );
}
