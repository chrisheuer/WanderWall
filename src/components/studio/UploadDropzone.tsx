"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";

const BUCKET = process.env.NEXT_PUBLIC_STORAGE_ORIGINALS_BUCKET ?? "originals";

/**
 * Drag-drop upload (≤40MB/file). Registers files with the API, uploads
 * directly to storage via signed URLs, then marks each complete to enter
 * the ingest pipeline.
 */
export function UploadDropzone({ galleryId }: { galleryId: string }) {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [needsUpgrade, setNeedsUpgrade] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  async function upgradeTier() {
    setBusy(true);
    try {
      const res = await fetch("/api/billing/upgrade-tier", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ galleryId }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof body.error === "string" ? body.error : "upgrade failed");
      }
      setNeedsUpgrade(false);
      setError(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "upgrade failed");
    } finally {
      setBusy(false);
    }
  }

  const handleFiles = useCallback(
    async (files: FileList | File[]) => {
      const list = [...files].filter((f) => f.type.startsWith("image/"));
      if (list.length === 0) return;
      const oversize = list.find((f) => f.size > 40 * 1024 * 1024);
      if (oversize) {
        setError(`"${oversize.name}" is over the 40MB per-file limit.`);
        return;
      }
      setBusy(true);
      setError(null);
      try {
        // Register in batches of 12 to keep request bodies small.
        for (let i = 0; i < list.length; i += 12) {
          const batch = list.slice(i, i + 12);
          const res = await fetch(`/api/galleries/${galleryId}/artworks`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              files: batch.map((f) => ({
                name: f.name,
                sizeBytes: f.size,
                contentType: f.type,
              })),
            }),
          });
          if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            if (body.needsTierUpgrade) setNeedsUpgrade(true);
            throw new Error(
              typeof body.error === "string" ? body.error : `upload registration failed (${res.status})`,
            );
          }
          const { uploads } = (await res.json()) as {
            uploads: Array<{ artworkId: string; uploadUrl: string; token: string; key: string }>;
          };
          const supabase = supabaseBrowser();
          for (let j = 0; j < batch.length; j++) {
            setProgress(`Uploading ${i + j + 1} of ${list.length}…`);
            // Use the SDK rather than hand-rolling the PUT: it sends the
            // multipart body the endpoint expects and sets x-upsert, so
            // retrying after a network blip that actually landed does not
            // fail with a duplicate-object error.
            const { error: uploadError } = await supabase.storage
              .from(BUCKET)
              .uploadToSignedUrl(uploads[j].key, uploads[j].token, batch[j], {
                contentType: batch[j].type,
                upsert: true,
              });
            if (uploadError) {
              throw new Error(`upload failed for ${batch[j].name}: ${uploadError.message}`);
            }
            await fetch(`/api/artworks/${uploads[j].artworkId}/complete`, { method: "POST" });
          }
        }
        setProgress("");
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "upload failed");
      } finally {
        setBusy(false);
      }
    },
    [galleryId, router],
  );

  return (
    <div>
      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          void handleFiles(e.dataTransfer.files);
        }}
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === "Enter" && inputRef.current?.click()}
        style={{
          border: "2px dashed var(--line)",
          padding: "40px 20px",
          textAlign: "center",
          cursor: "pointer",
          background: "var(--surface)",
        }}
      >
        {busy ? (
          <p className="muted">{progress || "Uploading…"}</p>
        ) : (
          <>
            <p style={{ margin: 0 }}>Drop images here, or click to choose</p>
            <p className="muted small">JPEG, PNG, WebP, TIFF — up to 40MB each</p>
            <p className="muted small">iCloud users: download your photos, then upload them here.</p>
          </>
        )}
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => e.target.files && void handleFiles(e.target.files)}
        />
      </div>
      {error ? (
        <div className="notice" style={{ marginTop: 12 }}>
          <p style={{ margin: 0 }}>{error}</p>
          {needsUpgrade ? (
            <p style={{ margin: "10px 0 0" }}>
              <button className="btn" disabled={busy} onClick={upgradeTier}>
                {busy ? "Upgrading…" : "Upgrade to Tier L (prorated)"}
              </button>
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
