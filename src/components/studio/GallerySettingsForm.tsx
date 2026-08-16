"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ARCHETYPE_LIST } from "@/lib/environments";
import { FRAME_STYLE_LIST } from "@/lib/frames";
import { LIGHTING_RIG_LIST } from "@/lib/lighting";
import { LICENSES } from "@/lib/licenses";

interface GalleryFields {
  id: string;
  title: string;
  statement: string;
  environmentArchetype: string;
  hangDensity: string;
  frameStyleDefault: string;
  lightingDefault: string;
  licenseDefault: string;
}

export function GallerySettingsForm({ gallery }: { gallery: GalleryFields }) {
  const [form, setForm] = useState(gallery);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  function set<K extends keyof GalleryFields>(key: K, value: GalleryFields[K]) {
    setForm((f) => ({ ...f, [key]: value }));
    setSaved(false);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/galleries/${gallery.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: form.title,
          statement: form.statement,
          environmentArchetype: form.environmentArchetype,
          hangDensity: form.hangDensity,
          frameStyleDefault: form.frameStyleDefault,
          lightingDefault: form.lightingDefault,
          licenseDefault: form.licenseDefault,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof body.error === "string" ? body.error : "save failed");
      }
      setSaved(true);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "save failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="card" style={{ maxWidth: 640 }}>
      <div className="field">
        <label>Title</label>
        <input
          value={form.title}
          maxLength={120}
          required
          onChange={(e) => set("title", e.target.value)}
        />
      </div>
      <div className="field">
        <label>Statement</label>
        <textarea
          rows={3}
          value={form.statement}
          maxLength={4000}
          onChange={(e) => set("statement", e.target.value)}
          placeholder="What is this body of work about?"
        />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div className="field">
          <label>Space</label>
          <select
            value={form.environmentArchetype}
            onChange={(e) => set("environmentArchetype", e.target.value)}
          >
            {ARCHETYPE_LIST.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Hang density</label>
          <select value={form.hangDensity} onChange={(e) => set("hangDensity", e.target.value)}>
            <option value="salon">Intimate salon hang</option>
            <option value="standard">Standard</option>
            <option value="airy">Airy museum spacing</option>
          </select>
        </div>
        <div className="field">
          <label>Default frame</label>
          <select
            value={form.frameStyleDefault}
            onChange={(e) => set("frameStyleDefault", e.target.value)}
          >
            {FRAME_STYLE_LIST.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Lighting</label>
          <select
            value={form.lightingDefault}
            onChange={(e) => set("lightingDefault", e.target.value)}
          >
            {LIGHTING_RIG_LIST.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="field">
        <label>Default license (applies unless a work overrides it)</label>
        <select value={form.licenseDefault} onChange={(e) => set("licenseDefault", e.target.value)}>
          {Object.values(LICENSES).map((l) => (
            <option key={l.id} value={l.id}>
              {l.label}
            </option>
          ))}
        </select>
        <p className="muted small" style={{ marginBottom: 0 }}>
          Creative Commons is opt-in. It signals how others may use your work — it is not
          copy-protection, and we don’t do fake “protection” theater.
        </p>
      </div>
      {error ? <p className="notice">{error}</p> : null}
      <button className="btn" disabled={busy} type="submit">
        {busy ? "Saving…" : saved ? "Saved ✓" : "Save settings"}
      </button>
    </form>
  );
}
