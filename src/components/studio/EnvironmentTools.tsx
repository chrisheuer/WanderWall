"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

/** "Describe your space" + "seed with a photo" environment helpers. */
export function EnvironmentTools({
  galleryId,
  seededSwatches,
}: {
  galleryId: string;
  seededSwatches: string[];
}) {
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  async function describe(e: React.FormEvent) {
    e.preventDefault();
    if (!description.trim()) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/galleries/${galleryId}/environment`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ description }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof body.error === "string" ? body.error : "failed");
      setMessage(`Mapped to “${body.archetype.name}”.`);
      router.refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "failed");
    } finally {
      setBusy(false);
    }
  }

  async function seedPhoto(file: File) {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/galleries/${galleryId}/environment`, {
        method: "POST",
        headers: { "content-type": file.type || "image/jpeg" },
        body: file,
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof body.error === "string" ? body.error : "failed");
      setMessage("Palette seeded from your photo.");
      router.refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "failed");
    } finally {
      setBusy(false);
    }
  }

  async function clearPalette() {
    setBusy(true);
    try {
      await fetch(`/api/galleries/${galleryId}/environment`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ clearPalette: true }),
      });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card" style={{ maxWidth: 640, marginTop: 16 }}>
      <form onSubmit={describe}>
        <div className="field">
          <label>Describe your space (maps to the closest archetype)</label>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              placeholder="a warm victorian parlor with dense walls"
              value={description}
              maxLength={500}
              onChange={(e) => setDescription(e.target.value)}
            />
            <button className="btn btn-secondary" disabled={busy} type="submit">
              Map it
            </button>
          </div>
        </div>
      </form>
      <div className="field" style={{ marginBottom: 0 }}>
        <label>Seed the palette from a reference photo</label>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <button
            className="btn btn-secondary"
            disabled={busy}
            onClick={() => fileRef.current?.click()}
          >
            Choose photo
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => e.target.files?.[0] && void seedPhoto(e.target.files[0])}
          />
          {seededSwatches.length > 0 ? (
            <>
              {seededSwatches.map((c) => (
                <span
                  key={c}
                  title={c}
                  style={{
                    width: 22,
                    height: 22,
                    background: c,
                    border: "1px solid var(--line)",
                    display: "inline-block",
                  }}
                />
              ))}
              <button className="btn btn-secondary small" disabled={busy} onClick={clearPalette}>
                Clear palette
              </button>
            </>
          ) : null}
        </div>
      </div>
      {message ? <p className="muted small" style={{ marginBottom: 0 }}>{message}</p> : null}
    </div>
  );
}
