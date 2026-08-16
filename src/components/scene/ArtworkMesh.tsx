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
  spotlightEnabled = true,
}: {
  placed: PlacedArtwork;
  residency: Residency;
  lightingRigId: string;
  spotlightEnabled?: boolean;
}) {
  const focusArtwork = useSceneStore((s) => s.focusArtwork);
  const texture = useArtworkTexture(placed.artwork.urls, residency);

  const frame = FRAME_STYLES[placed.artwork.frameStyle] ?? FRAME_STYLES["thin-black-metal"];
  const rig = LIGHTING_RIGS[lightingRigId] ?? LIGHTING_RIGS["bright-daylight"];

  const { width, height } = placed;
  const matte = frame.matte;
  const outerW = width * (1 + matte * 2) + frame.barWidth * 2;
  const outerH = height * (1 + matte * 2) + frame.barWidth * 2;

  // Frame bars are drawn by <InstancedFrames> (one draw call per style).
  return (
    <group
      position={placed.position}
      rotation-y={placed.rotationY}
      onClick={(e) => {
        e.stopPropagation();
        focusArtwork(placed.artwork.id);
      }}
    >
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
      {placed.artwork.spotlight && spotlightEnabled ? (
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
