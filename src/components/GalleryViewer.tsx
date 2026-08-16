"use client";

import { useEffect, useMemo, useState } from "react";
import { Canvas } from "@react-three/fiber";
import type { ArtworkView } from "@/lib/galleries";
import type { GalleryLayout, PlacedArtwork } from "@/lib/layout";
import { ArtworkGrid } from "@/components/ArtworkGrid";
import { ArtworkMesh } from "./scene/ArtworkMesh";
import { InstancedFrames } from "./scene/InstancedFrames";
import { InfoPanel } from "./scene/InfoPanel";
import { Joystick } from "./scene/Joystick";
import { Lighting } from "./scene/Lighting";
import { MiniMap } from "./scene/MiniMap";
import { PlayerControls } from "./scene/PlayerControls";
import { RoomMesh } from "./scene/RoomMesh";
import { useSceneStore } from "./scene/store";
import type { Residency } from "./scene/textures";

/**
 * The public gallery experience: walkable 3D scene with a hard-required
 * 2D list-view toggle that works without WebGL. EnvironmentProvider seam:
 * the scene renders entirely from the GalleryLayout config; a future
 * skybox/environment service plugs in behind FEATURE_AI_SKYBOX without
 * touching this component.
 */
export function GalleryViewer({
  layout,
  artworks,
  creatorName,
  initialFocusId,
  children,
}: {
  layout: GalleryLayout;
  artworks: ArtworkView[];
  creatorName: string;
  /** Deep link ?a=[id] — teleports the camera to that artwork. */
  initialFocusId?: string | null;
  /** Extra overlay content (donate button etc.). */
  children?: React.ReactNode;
}) {
  const [mode, setMode] = useState<"walk" | "list">("walk");
  const [webglOk, setWebglOk] = useState(true);
  const [isTouch, setIsTouch] = useState(false);

  const focusedArtworkId = useSceneStore((s) => s.focusedArtworkId);
  const activeRoomIndex = useSceneStore((s) => s.activeRoomIndex);
  const focusArtwork = useSceneStore((s) => s.focusArtwork);

  useEffect(() => {
    // WebGL2 detection: fall back to the fully functional list view.
    try {
      const canvas = document.createElement("canvas");
      const gl = canvas.getContext("webgl2");
      if (!gl) {
        setWebglOk(false);
        setMode("list");
      }
    } catch {
      setWebglOk(false);
      setMode("list");
    }
    setIsTouch(window.matchMedia("(pointer: coarse)").matches);
  }, []);

  const placedById = useMemo(() => {
    const map = new Map<string, PlacedArtwork>();
    for (const room of layout.rooms) {
      for (const placed of room.artworks) map.set(placed.artwork.id, placed);
    }
    return map;
  }, [layout]);

  // Deep link: focus (and thereby teleport to) the linked artwork.
  useEffect(() => {
    if (initialFocusId && placedById.has(initialFocusId)) {
      const placed = placedById.get(initialFocusId)!;
      useSceneStore.getState().setActiveRoom(placed.roomIndex);
      focusArtwork(initialFocusId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialFocusId]);

  const focusedPlaced = focusedArtworkId ? placedById.get(focusedArtworkId) : null;
  const activeRoom = layout.rooms[activeRoomIndex] ?? layout.rooms[0];

  const adjacency = useMemo(() => {
    const map = new Map<number, Set<number>>();
    for (const room of layout.rooms) {
      map.set(room.index, new Set(room.doors.map((d) => d.toRoomIndex)));
    }
    return map;
  }, [layout]);

  /**
   * Residency is enforced by mounting, not just by texture choice: only
   * the active room and the rooms reachable through its doors exist in the
   * scene graph. Everything beyond is unmounted, which releases its
   * texture pins and lets the LRU reclaim them. This is what keeps a
   * 120-piece gallery inside the mobile texture budget — rendering every
   * room would load every piece on first paint.
   */
  const residentRooms = useMemo(() => {
    const neighbors = adjacency.get(activeRoomIndex) ?? new Set<number>();
    return layout.rooms.filter(
      (room) => room.index === activeRoomIndex || neighbors.has(room.index),
    );
  }, [layout, adjacency, activeRoomIndex]);

  function residencyFor(placed: PlacedArtwork): Residency {
    if (focusedArtworkId === placed.artwork.id) return "focused";
    return placed.roomIndex === activeRoomIndex ? "active" : "adjacent";
  }

  if (mode === "list") {
    return (
      <div style={{ position: "relative", zIndex: 1, background: "var(--bg)" }}>
        <div style={{ display: "flex", justifyContent: "flex-end", padding: "8px 0" }}>
          {webglOk ? (
            <button className="btn btn-secondary" onClick={() => setMode("walk")}>
              Walk the gallery
            </button>
          ) : (
            <span className="muted small">3D view isn’t available on this device.</span>
          )}
        </div>
        <ArtworkGrid artworks={artworks} creatorName={creatorName} />
        {children}
      </div>
    );
  }

  return (
    <div
      style={{
        position: "relative",
        zIndex: 1,
        width: "100%",
        height: "min(78vh, 860px)",
        background: activeRoom?.archetype.outdoor ? "#0d1420" : "#e8e6e0",
        borderRadius: 4,
        overflow: "hidden",
        touchAction: "none",
      }}
    >
      <Canvas
        // WebGL2 via three defaults; renderer choices deliberately leave
        // room for @react-three/xr later.
        camera={{ fov: 68, near: 0.1, far: 120 }}
        dpr={isTouch ? [1, 1.5] : [1, 2]}
        gl={{ antialias: true, powerPreference: "high-performance" }}
        shadows={false}
      >
        <Lighting rigId={activeRoom.lightingRig} outdoor={activeRoom.archetype.outdoor} />
        {residentRooms.map((room) => (
          <RoomMesh key={room.index} room={room} />
        ))}
        <InstancedFrames rooms={residentRooms} />
        {residentRooms.map((room) =>
          room.artworks.map((placed) => (
            <ArtworkMesh
              key={placed.artwork.id}
              placed={placed}
              residency={residencyFor(placed)}
              lightingRigId={activeRoom.lightingRig}
              // Spotlights are real lights; keeping them off in adjacent
              // rooms stops far rooms from lighting an empty scene.
              spotlightEnabled={room.index === activeRoomIndex}
            />
          )),
        )}
        <PlayerControls layout={layout} placedById={placedById} />
      </Canvas>

      {/* Overlays */}
      <div
        style={{
          position: "absolute",
          top: 10,
          right: 10,
          display: "flex",
          gap: 8,
        }}
      >
        <button
          className="btn btn-secondary"
          style={{ background: "rgba(255,255,255,0.85)" }}
          onClick={() => setMode("list")}
        >
          List view
        </button>
      </div>
      {activeRoom?.chapterLabel || activeRoom?.name ? (
        <div
          style={{
            position: "absolute",
            top: 10,
            left: 12,
            color: "#fff",
            textShadow: "0 1px 3px rgba(0,0,0,0.6)",
            fontFamily: "Georgia, serif",
            fontSize: 14,
          }}
        >
          {activeRoom.chapterLabel ?? activeRoom.name}
        </div>
      ) : null}
      {focusedPlaced ? <InfoPanel placed={focusedPlaced} creatorName={creatorName} /> : null}
      <MiniMap layout={layout} />
      {isTouch ? <Joystick /> : null}
      {!isTouch && !focusedPlaced ? (
        <div
          style={{
            position: "absolute",
            bottom: 10,
            left: "50%",
            transform: "translateX(-50%)",
            color: "rgba(255,255,255,0.85)",
            textShadow: "0 1px 3px rgba(0,0,0,0.6)",
            fontSize: 12,
            fontFamily: "Georgia, serif",
            pointerEvents: "none",
          }}
        >
          WASD to walk · drag to look · click a work to view · click the floor to move
        </div>
      ) : null}
      {children}
    </div>
  );
}
