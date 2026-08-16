"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ARCHETYPE_LIST } from "@/lib/environments";
import { LIGHTING_RIG_LIST } from "@/lib/lighting";

export interface RoomRow {
  id: string;
  name: string | null;
  chapterLabel: string | null;
  archetype: string;
  lightingRig: string;
  kind: string;
  sortOrder: number;
  pieceCount: number;
}

/**
 * The 2D room list: regenerate chapters (upload order / dominant color /
 * tag), rename rooms, tweak archetype and lighting per room. Moving works
 * between rooms happens in the works manager's room selector.
 */
export function RoomManagerPanel({
  galleryId,
  rooms,
  editable,
}: {
  galleryId: string;
  rooms: RoomRow[];
  editable: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function regenerate(groupBy: "order" | "color" | "tag") {
    if (
      rooms.length > 0 &&
      !window.confirm("Regenerate rooms? Current room assignments will be replaced.")
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/galleries/${galleryId}/rooms`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ groupBy }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof body.error === "string" ? body.error : "failed");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "room regeneration failed");
    } finally {
      setBusy(false);
    }
  }

  async function patchRoom(id: string, data: Record<string, unknown>) {
    setBusy(true);
    try {
      const res = await fetch(`/api/rooms/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("room update failed");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "room update failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      {editable ? (
        <p style={{ marginTop: 0 }}>
          <button className="btn btn-secondary" disabled={busy} onClick={() => regenerate("order")}>
            Chapters by upload order
          </button>{" "}
          <button className="btn btn-secondary" disabled={busy} onClick={() => regenerate("color")}>
            Regroup by dominant color
          </button>{" "}
          <button className="btn btn-secondary" disabled={busy} onClick={() => regenerate("tag")}>
            Regroup by tag
          </button>
        </p>
      ) : null}
      {error ? <p className="notice">{error}</p> : null}
      {rooms.length === 0 ? (
        <p className="muted small" style={{ marginBottom: 0 }}>
          No saved rooms — the gallery auto-arranges. Generate chapters to hand-tune the flow;
          galleries over 14 pieces segment automatically either way.
        </p>
      ) : (
        <table className="plain">
          <thead>
            <tr>
              <th>Room</th>
              <th>Kind</th>
              <th>Pieces</th>
              <th>Space</th>
              <th>Lighting</th>
            </tr>
          </thead>
          <tbody>
            {rooms.map((room) => (
              <tr key={room.id}>
                <td>
                  {editable ? (
                    <input
                      defaultValue={room.name ?? ""}
                      placeholder="Room name"
                      style={{ width: 140 }}
                      onBlur={(e) => {
                        if (e.target.value !== (room.name ?? "")) {
                          void patchRoom(room.id, { name: e.target.value || null });
                        }
                      }}
                    />
                  ) : (
                    room.name
                  )}
                </td>
                <td>{room.kind}</td>
                <td>{room.pieceCount}</td>
                <td>
                  {editable ? (
                    <select
                      defaultValue={room.archetype}
                      onChange={(e) => void patchRoom(room.id, { archetype: e.target.value })}
                    >
                      {ARCHETYPE_LIST.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    room.archetype
                  )}
                </td>
                <td>
                  {editable ? (
                    <select
                      defaultValue={room.lightingRig}
                      onChange={(e) => void patchRoom(room.id, { lightingRig: e.target.value })}
                    >
                      {LIGHTING_RIG_LIST.map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    room.lightingRig
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
