"use client";

import { useEffect, useMemo } from "react";
import * as THREE from "three";
import type { LayoutRoom, WallSide } from "@/lib/layout";
import { useSceneStore } from "./store";

/**
 * Room geometry from config: floor, ceiling, and walls with door openings.
 * Walls with doors are built from three boxes (left, right, lintel).
 */

const WALL_T = 0.15;

const FLOOR_COLORS: Record<string, string> = {
  oak: "#cdb48c",
  walnut: "#7a5a3a",
  terrazzo: "#d5cfc2",
  concrete: "#9d9d97",
  stone: "#b3a68d",
  brick: "#9c5a41",
  gravel: "#8b857a",
};

export function RoomMesh({
  room,
  roomNames,
}: {
  room: LayoutRoom;
  /** Index -> name, so a lintel can announce where the door leads. */
  roomNames?: Map<number, string>;
}) {
  const requestTeleport = useSceneStore((s) => s.requestTeleport);
  const destinationName = (index: number) => roomNames?.get(index) ?? "";
  const floorColor = FLOOR_COLORS[room.floorMaterial] ?? "#cdb48c";
  const [cx, cz] = room.center;
  const halfW = room.width / 2;
  const halfD = room.depth / 2;

  const wallDefs = useMemo(() => {
    const sides: Array<{
      side: WallSide;
      length: number;
      position: [number, number, number];
      rotationY: number;
    }> = [
      { side: "north", length: room.width, position: [cx, 0, cz - halfD], rotationY: 0 },
      { side: "south", length: room.width, position: [cx, 0, cz + halfD], rotationY: Math.PI },
      { side: "west", length: room.depth, position: [cx - halfW, 0, cz], rotationY: Math.PI / 2 },
      { side: "east", length: room.depth, position: [cx + halfW, 0, cz], rotationY: -Math.PI / 2 },
    ];
    return sides.map((s) => ({
      ...s,
      doors: room.doors.filter((d) => d.side === s.side),
    }));
  }, [room, cx, cz, halfW, halfD]);

  return (
    <group>
      {/* Floor */}
      <mesh
        rotation-x={-Math.PI / 2}
        position={[cx, 0, cz]}
        receiveShadow
        onClick={(e) => {
          e.stopPropagation();
          useSceneStore.getState().setMoveTarget([e.point.x, e.point.z]);
        }}
      >
        <planeGeometry args={[room.width, room.depth]} />
        <meshStandardMaterial color={floorColor} roughness={0.9} metalness={0.02} />
      </mesh>

      {/* Ceiling (skip for outdoor archetypes — night sky handled by rig) */}
      {!room.archetype.outdoor ? (
        <mesh rotation-x={Math.PI / 2} position={[cx, room.ceiling, cz]}>
          <planeGeometry args={[room.width, room.depth]} />
          <meshStandardMaterial color={room.archetype.palette.ceiling} roughness={1} />
        </mesh>
      ) : null}

      {/* Walls */}
      {wallDefs.map((wall) => (
        <group
          key={wall.side}
          position={wall.position}
          rotation-y={wall.rotationY}
        >
          {wall.doors.length === 0 ? (
            <mesh position={[0, room.ceiling / 2, 0]} receiveShadow>
              <boxGeometry args={[wall.length, room.ceiling, WALL_T]} />
              <meshStandardMaterial color={room.wallColor} roughness={0.95} />
            </mesh>
          ) : (
            wall.doors.map((door, i) => {
              const doorLeft = door.offset - door.width / 2;
              const doorRight = door.offset + door.width / 2;
              const leftLen = doorLeft + wall.length / 2;
              const rightLen = wall.length / 2 - doorRight;
              const lintelH = room.ceiling - door.height;
              return (
                <group key={i}>
                  {leftLen > 0.01 ? (
                    <mesh position={[-wall.length / 2 + leftLen / 2, room.ceiling / 2, 0]} receiveShadow>
                      <boxGeometry args={[leftLen, room.ceiling, WALL_T]} />
                      <meshStandardMaterial color={room.wallColor} roughness={0.95} />
                    </mesh>
                  ) : null}
                  {rightLen > 0.01 ? (
                    <mesh position={[wall.length / 2 - rightLen / 2, room.ceiling / 2, 0]} receiveShadow>
                      <boxGeometry args={[rightLen, room.ceiling, WALL_T]} />
                      <meshStandardMaterial color={room.wallColor} roughness={0.95} />
                    </mesh>
                  ) : null}
                  {lintelH > 0.01 ? (
                    <mesh position={[door.offset, door.height + lintelH / 2, 0]}>
                      <boxGeometry args={[door.width, lintelH, WALL_T]} />
                      <meshStandardMaterial color={room.wallColor} roughness={0.95} />
                    </mesh>
                  ) : null}
                  {/* Wayfinding: the destination room's name over the door */}
                  <DoorLintelLabel
                    label={destinationName(door.toRoomIndex)}
                    position={[door.offset, door.height + 0.22, 0.09]}
                  />
                  <mesh
                    position={[door.offset, door.height / 2, 0]}
                    onClick={(e) => {
                      e.stopPropagation();
                      // Teleport through: land just inside the far side.
                      const dir = new THREE.Vector3(0, 0, 1)
                        .applyAxisAngle(new THREE.Vector3(0, 1, 0), wall.rotationY);
                      const world = new THREE.Vector3(door.offset, 0, 0)
                        .applyAxisAngle(new THREE.Vector3(0, 1, 0), wall.rotationY)
                        .add(new THREE.Vector3(wall.position[0], 0, wall.position[2]));
                      const through = world.add(dir.multiplyScalar(-1.2));
                      requestTeleport([through.x, through.z]);
                    }}
                  >
                    <planeGeometry args={[door.width, door.height]} />
                    <meshBasicMaterial transparent opacity={0} depthWrite={false} />
                  </mesh>
                </group>
              );
            })
          )}
        </group>
      ))}
    </group>
  );
}

/**
 * Room name lettered onto the lintel. Drawn to a canvas texture rather
 * than an SDF text mesh: one small texture per doorway costs far less
 * than a glyph atlas, and the label never needs to animate.
 */
function DoorLintelLabel({
  label,
  position,
}: {
  label: string;
  position: [number, number, number];
}) {
  const texture = useMemo(() => {
    if (!label || typeof document === "undefined") return null;
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 128;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#4a463c";
    ctx.font = "500 64px Georgia, 'Times New Roman', serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label.toUpperCase(), canvas.width / 2, canvas.height / 2, canvas.width - 24);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return tex;
  }, [label]);

  useEffect(() => {
    return () => texture?.dispose();
  }, [texture]);

  if (!texture) return null;
  return (
    <mesh position={position}>
      <planeGeometry args={[1.4, 0.35]} />
      <meshBasicMaterial map={texture} transparent depthWrite={false} />
    </mesh>
  );
}
