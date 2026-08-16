"use client";

import { useMemo } from "react";
import type { GalleryLayout } from "@/lib/layout";
import { useSceneStore } from "./store";

/** Wayfinding overlay: room plan with names; click a room to teleport. */
export function MiniMap({ layout }: { layout: GalleryLayout }) {
  const activeRoomIndex = useSceneStore((s) => s.activeRoomIndex);
  const requestTeleport = useSceneStore((s) => s.requestTeleport);

  const bounds = useMemo(() => {
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const r of layout.rooms) {
      minX = Math.min(minX, r.center[0] - r.width / 2);
      maxX = Math.max(maxX, r.center[0] + r.width / 2);
      minZ = Math.min(minZ, r.center[1] - r.depth / 2);
      maxZ = Math.max(maxZ, r.center[1] + r.depth / 2);
    }
    return { minX, maxX, minZ, maxZ };
  }, [layout]);

  const pad = 1;
  const vbW = bounds.maxX - bounds.minX + pad * 2;
  const vbH = bounds.maxZ - bounds.minZ + pad * 2;

  return (
    <div
      style={{
        position: "absolute",
        right: 12,
        bottom: 12,
        width: Math.min(220, Math.max(140, vbW * 6)),
        background: "rgba(20,20,18,0.72)",
        border: "1px solid rgba(255,255,255,0.2)",
        borderRadius: 4,
        padding: 6,
      }}
      aria-label="Gallery map"
    >
      <svg
        viewBox={`${bounds.minX - pad} ${bounds.minZ - pad} ${vbW} ${vbH}`}
        style={{ display: "block", width: "100%" }}
      >
        {layout.rooms.map((room) => (
          <g key={room.index}>
            <rect
              x={room.center[0] - room.width / 2}
              y={room.center[1] - room.depth / 2}
              width={room.width}
              height={room.depth}
              fill={room.index === activeRoomIndex ? "rgba(250,244,225,0.85)" : "rgba(255,255,255,0.18)"}
              stroke="rgba(255,255,255,0.6)"
              strokeWidth={0.12}
              style={{ cursor: "pointer" }}
              onClick={() => requestTeleport([room.center[0], room.center[1]])}
            />
            <text
              x={room.center[0]}
              y={room.center[1]}
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize={Math.min(1.1, room.width / 7)}
              fill={room.index === activeRoomIndex ? "#1c1b18" : "#efeee8"}
              style={{ pointerEvents: "none", fontFamily: "Georgia, serif" }}
            >
              {room.name}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}
