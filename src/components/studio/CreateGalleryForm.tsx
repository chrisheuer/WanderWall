"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ARCHETYPE_LIST } from "@/lib/environments";

export function CreateGalleryForm() {
  const [title, setTitle] = useState("");
  const [archetype, setArchetype] = useState("white-cube");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/galleries", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title, environmentArchetype: archetype }),
      });
      if (!res.ok) throw new Error(`create failed (${res.status})`);
      const { gallery } = await res.json();
      router.push(`/studio/galleries/${gallery.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "create failed");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <div className="field">
        <label htmlFor="title">Title</label>
        <input
          id="title"
          required
          maxLength={120}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Field Notes, 2019–2026"
        />
      </div>
      <div className="field">
        <label htmlFor="archetype">Space</label>
        <select id="archetype" value={archetype} onChange={(e) => setArchetype(e.target.value)}>
          {ARCHETYPE_LIST.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name} — {a.description}
            </option>
          ))}
        </select>
      </div>
      {error ? <p className="notice">{error}</p> : null}
      <button className="btn" disabled={busy} type="submit">
        {busy ? "Creating…" : "Create gallery"}
      </button>
    </form>
  );
}
