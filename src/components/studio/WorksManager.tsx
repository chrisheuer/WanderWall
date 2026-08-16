"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FRAME_STYLE_LIST } from "@/lib/frames";
import { LICENSES } from "@/lib/licenses";

export interface WorkRow {
  id: string;
  title: string;
  caption: string;
  thumbUrl: string | null;
  ingestStatus: string;
  ingestError: string | null;
  roomId: string | null;
  sortOrder: number;
  frameStyleOverride: string | null;
  licenseOverride: string | null;
  spotlight: boolean;
  hero: boolean;
}

export interface RoomOption {
  id: string;
  label: string;
}

/**
 * The 2D works manager: reorder, retitle, caption, license and frame
 * overrides, spotlight/hero toggles, move between rooms, delete.
 */
export function WorksManager({
  works,
  rooms,
  editable,
}: {
  works: WorkRow[];
  rooms: RoomOption[];
  editable: boolean;
}) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  async function patch(id: string, data: Record<string, unknown>) {
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(`/api/artworks/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(data),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof body.error === "string" ? body.error : "update failed");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "update failed");
    } finally {
      setBusyId(null);
    }
  }

  async function remove(id: string, title: string) {
    if (!window.confirm(`Remove “${title}” from the gallery? The image is deleted from storage.`)) {
      return;
    }
    setBusyId(id);
    try {
      const res = await fetch(`/api/artworks/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("delete failed");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "delete failed");
    } finally {
      setBusyId(null);
    }
  }

  async function move(index: number, dir: -1 | 1) {
    const target = index + dir;
    if (target < 0 || target >= works.length) return;
    // Swap sort orders of the two neighbors.
    await patch(works[index].id, { sortOrder: target });
    await patch(works[target].id, { sortOrder: index });
  }

  if (works.length === 0) return <p className="muted">No works yet — add some above.</p>;

  return (
    <div>
      {error ? <p className="notice">{error}</p> : null}
      <table className="plain">
        <tbody>
          {works.map((w, i) => (
            <tr key={w.id} style={{ opacity: busyId === w.id ? 0.5 : 1 }}>
              <td style={{ width: 64 }}>
                {w.thumbUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={w.thumbUrl} alt="" style={{ width: 56, height: 56, objectFit: "cover" }} />
                ) : (
                  <span className="badge">{w.ingestStatus}</span>
                )}
              </td>
              <td>
                <strong>{w.title}</strong>
                {w.hero ? <span className="badge" style={{ marginLeft: 6 }}>hero</span> : null}
                {w.spotlight ? <span className="badge" style={{ marginLeft: 6 }}>spot</span> : null}
                {w.ingestStatus === "failed" ? (
                  <div className="small" style={{ color: "#8a2d2d" }}>{w.ingestError}</div>
                ) : null}
              </td>
              {editable ? (
                <td style={{ whiteSpace: "nowrap", textAlign: "right" }}>
                  <button className="btn btn-secondary small" onClick={() => move(i, -1)} disabled={i === 0}>
                    ↑
                  </button>{" "}
                  <button
                    className="btn btn-secondary small"
                    onClick={() => move(i, 1)}
                    disabled={i === works.length - 1}
                  >
                    ↓
                  </button>{" "}
                  <button
                    className="btn btn-secondary small"
                    onClick={() => setOpenId(openId === w.id ? null : w.id)}
                  >
                    {openId === w.id ? "Close" : "Edit"}
                  </button>{" "}
                  <button className="btn btn-danger small" onClick={() => remove(w.id, w.title)}>
                    Remove
                  </button>
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>

      {editable && openId ? (
        <WorkEditor
          key={openId}
          work={works.find((w) => w.id === openId)!}
          rooms={rooms}
          onSave={(data) => patch(openId, data)}
        />
      ) : null}
    </div>
  );
}

function WorkEditor({
  work,
  rooms,
  onSave,
}: {
  work: WorkRow;
  rooms: RoomOption[];
  onSave: (data: Record<string, unknown>) => Promise<void>;
}) {
  const [title, setTitle] = useState(work.title);
  const [caption, setCaption] = useState(work.caption);
  const [frame, setFrame] = useState(work.frameStyleOverride ?? "");
  const [license, setLicense] = useState(work.licenseOverride ?? "");
  const [roomId, setRoomId] = useState(work.roomId ?? "");
  const [spotlight, setSpotlight] = useState(work.spotlight);
  const [hero, setHero] = useState(work.hero);

  return (
    <div className="card" style={{ marginTop: 12 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div className="field">
          <label>Title</label>
          <input value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="field">
          <label>Room</label>
          <select value={roomId} onChange={(e) => setRoomId(e.target.value)}>
            <option value="">(auto)</option>
            {rooms.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="field">
        <label>Caption</label>
        <textarea rows={2} value={caption} maxLength={2000} onChange={(e) => setCaption(e.target.value)} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div className="field">
          <label>Frame override</label>
          <select value={frame} onChange={(e) => setFrame(e.target.value)}>
            <option value="">(gallery default)</option>
            {FRAME_STYLE_LIST.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>License override</label>
          <select value={license} onChange={(e) => setLicense(e.target.value)}>
            <option value="">(gallery default)</option>
            {Object.values(LICENSES).map((l) => (
              <option key={l.id} value={l.id}>
                {l.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      <label className="small" style={{ marginRight: 16 }}>
        <input type="checkbox" checked={spotlight} onChange={(e) => setSpotlight(e.target.checked)} />{" "}
        Spotlight this piece
      </label>
      <label className="small">
        <input type="checkbox" checked={hero} onChange={(e) => setHero(e.target.checked)} /> Hero
        (own wall)
      </label>
      <div style={{ marginTop: 12 }}>
        <button
          className="btn"
          onClick={() =>
            void onSave({
              title,
              caption,
              frameStyleOverride: frame || null,
              licenseOverride: license || null,
              roomId: roomId || null,
              spotlight,
              hero,
            })
          }
        >
          Save work
        </button>
      </div>
    </div>
  );
}
