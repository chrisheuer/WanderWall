"use client";

import { useMemo } from "react";
import * as THREE from "three";
import type { PlacedArtwork } from "@/lib/layout";
import { FRAME_STYLES } from "@/lib/frames";
import { LIGHTING_RIGS } from "@/lib/lighting";
import { useSceneStore } from "./store";
import { useArtworkTexture, type Residency } from "./textures";

/**
 * A hung artwork: frame bars + matte + canvas plane, with an optional
 * per-piece spotlight over the room's ambient rig (no real-time shadows —
 * cheap by design, especially on mobile).
 */
export function ArtworkMesh({
  placed,
  residency,
  lightingRigId,
}: {
  placed: PlacedArtwork;
  residency: Residency;
  lightingRigId: string;
}) {
  const focusArtwork = useSceneStore((s) => s.focusArtwork);
  const focused = useSceneStore((s) => s.focusedArtworkId) === placed.artwork.id;
  const texture = useArtworkTexture(
    placed.artwork.urls,
    focused ? "focused" : residency,
  );

  const frame = FRAME_STYLES[placed.artwork.frameStyle] ?? FRAME_STYLES["thin-black-metal"];
  const rig = LIGHTING_RIGS[lightingRigId] ?? LIGHTING_RIGS["bright-daylight"];

  const { width, height } = placed;
  const matte = frame.matte;
  const outerW = width * (1 + matte * 2) + frame.barWidth * 2;
  const outerH = height * (1 + matte * 2) + frame.barWidth * 2;

  const bars = useMemo(() => {
    if (frame.barWidth === 0) return [];
    const bw = frame.barWidth;
    return [
      // top, bottom, left, right
      { pos: [0, outerH / 2 - bw / 2, 0] as const, size: [outerW, bw, frame.depth] as const },
      { pos: [0, -outerH / 2 + bw / 2, 0] as const, size: [outerW, bw, frame.depth] as const },
      { pos: [-outerW / 2 + bw / 2, 0, 0] as const, size: [bw, outerH - bw * 2, frame.depth] as const },
      { pos: [outerW / 2 - bw / 2, 0, 0] as const, size: [bw, outerH - bw * 2, frame.depth] as const },
    ];
  }, [frame.barWidth, frame.depth, outerW, outerH]);

  return (
    <group
      position={placed.position}
      rotation-y={placed.rotationY}
      onClick={(e) => {
        e.stopPropagation();
        focusArtwork(placed.artwork.id);
      }}
    >
      {/* Frame bars */}
      {bars.map((bar, i) => (
        <mesh key={i} position={[bar.pos[0], bar.pos[1], bar.pos[2] + frame.depth / 2]}>
          <boxGeometry args={[bar.size[0], bar.size[1], bar.size[2]]} />
          <meshStandardMaterial
            color={frame.color}
            metalness={frame.metalness}
            roughness={frame.roughness}
          />
        </mesh>
      ))}

      {/* Matte board */}
      {matte > 0 ? (
        <mesh position={[0, 0, frame.depth * 0.35]}>
          <planeGeometry args={[outerW - frame.barWidth * 2, outerH - frame.barWidth * 2]} />
          <meshStandardMaterial color={frame.matteColor} roughness={0.95} />
        </mesh>
      ) : null}

      {/* Canvas */}
      <mesh position={[0, 0, frame.depth * 0.5 + 0.002]}>
        <planeGeometry args={[width, height]} />
        {texture ? (
          <meshStandardMaterial map={texture} roughness={0.85} metalness={0} />
        ) : (
          <meshStandardMaterial
            color={placed.artwork.dominantColors[0] ?? "#d8d5cc"}
            roughness={0.95}
          />
        )}
      </mesh>

      {/* Per-piece spotlight toggle */}
      {placed.artwork.spotlight ? (
        <SpotFor
          width={outerW}
          height={outerH}
          color={rig.spotlightColor}
          intensity={rig.spotlightIntensity}
        />
      ) : null}
    </group>
  );
}

function SpotFor({
  width,
  height,
  color,
  intensity,
}: {
  width: number;
  height: number;
  color: string;
  intensity: number;
}) {
  // Local-space spot in front/above the artwork aimed at its center.
  const target = useMemo(() => {
    const t = new THREE.Object3D();
    t.position.set(0, 0, 0);
    return t;
  }, []);
  const radius = Math.max(width, height);
  return (
    <group>
      <primitive object={target} />
      <spotLight
        position={[0, height / 2 + 1.2, 1.4]}
        target={target}
        angle={Math.atan2(radius * 0.75, 1.8)}
        penumbra={0.55}
        intensity={intensity}
        color={color}
        distance={6}
        decay={1.4}
        castShadow={false}
      />
    </group>
  );
}
