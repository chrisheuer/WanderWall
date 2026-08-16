"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/** Paste image URLs — the server fetches and stores copies (no hotlinking). */
export function UrlImport({ galleryId }: { galleryId: string }) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const urls = value
      .split(/\s+/)
      .map((s) => s.trim())
      .filter((s) => /^https?:\/\//i.test(s));
    if (urls.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/galleries/${galleryId}/artworks/url`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ urls: urls.slice(0, 20) }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof body.error === "string" ? body.error : "URL import failed");
      }
      if (body.skipped > 0) {
        setError(
          `${body.skipped} URL${body.skipped === 1 ? " was" : "s were"} already in this gallery and ${body.skipped === 1 ? "was" : "were"} skipped.`,
        );
      }
      setValue("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "URL import failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} style={{ marginTop: 16 }}>
      <div className="field">
        <label htmlFor="urls">Or paste image URLs (one per line)</label>
        <textarea
          id="urls"
          rows={3}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={"https://example.com/photo-1.jpg\nhttps://example.com/photo-2.jpg"}
        />
      </div>
      <button className="btn btn-secondary" disabled={busy} type="submit">
        {busy ? "Fetching…" : "Fetch and add"}
      </button>
      {error ? <p className="notice" style={{ marginTop: 12 }}>{error}</p> : null}
    </form>
  );
}
