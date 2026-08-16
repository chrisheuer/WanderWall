"use client";

import { LIGHTING_RIGS } from "@/lib/lighting";

/**
 * The active room's rig lights the scene. Baked/cheap: ambient +
 * hemisphere + one directional, no real-time shadows on mobile.
 */
export function Lighting({ rigId, outdoor }: { rigId: string; outdoor: boolean }) {
  const rig = LIGHTING_RIGS[rigId] ?? LIGHTING_RIGS["bright-daylight"];
  return (
    <>
      <ambientLight color={rig.ambientColor} intensity={rig.ambientIntensity} />
      <hemisphereLight
        color={rig.hemisphereSky}
        groundColor={rig.hemisphereGround}
        intensity={rig.hemisphereIntensity}
      />
      <directionalLight
        color={rig.keyColor}
        intensity={rig.keyIntensity}
        position={[-rig.keyDirection[0] * 10, -rig.keyDirection[1] * 10, -rig.keyDirection[2] * 10]}
        castShadow={false}
      />
      {outdoor ? <fog attach="fog" args={["#101826", 8, 60]} /> : null}
    </>
  );
}
