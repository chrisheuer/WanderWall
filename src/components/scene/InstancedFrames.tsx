"use client";

import { useEffect, useMemo } from "react";
import * as THREE from "three";
import type { LayoutRoom, PlacedArtwork } from "@/lib/layout";
import { FRAME_STYLES, type FrameStyleDef } from "@/lib/frames";

/**
 * All frame bars in the gallery drawn as one InstancedMesh per frame
 * style: a 120-piece gallery costs ~6 draw calls for frames instead of
 * ~480 meshes.
 */

interface BarInstance {
  position: THREE.Vector3;
  rotationY: number;
  scale: THREE.Vector3;
}

export function frameOuterSize(placed: PlacedArtwork, frame: FrameStyleDef) {
  const outerW = placed.width * (1 + frame.matte * 2) + frame.barWidth * 2;
  const outerH = placed.height * (1 + frame.matte * 2) + frame.barWidth * 2;
  return { outerW, outerH };
}

function barsFor(placed: PlacedArtwork, frame: FrameStyleDef): BarInstance[] {
  if (frame.barWidth === 0) return [];
  const { outerW, outerH } = frameOuterSize(placed, frame);
  const bw = frame.barWidth;
  const rot = new THREE.Matrix4().makeRotationY(placed.rotationY);
  const origin = new THREE.Vector3(...placed.position);

  const locals: Array<{ off: [number, number, number]; size: [number, number, number] }> = [
    { off: [0, outerH / 2 - bw / 2, frame.depth / 2], size: [outerW, bw, frame.depth] },
    { off: [0, -outerH / 2 + bw / 2, frame.depth / 2], size: [outerW, bw, frame.depth] },
    { off: [-outerW / 2 + bw / 2, 0, frame.depth / 2], size: [bw, outerH - bw * 2, frame.depth] },
    { off: [outerW / 2 - bw / 2, 0, frame.depth / 2], size: [bw, outerH - bw * 2, frame.depth] },
  ];

  return locals.map((l) => ({
    position: origin.clone().add(new THREE.Vector3(...l.off).applyMatrix4(rot)),
    rotationY: placed.rotationY,
    scale: new THREE.Vector3(...l.size),
  }));
}

export function InstancedFrames({ rooms }: { rooms: LayoutRoom[] }) {
  const groups = useMemo(() => {
    const byStyle = new Map<string, BarInstance[]>();
    for (const room of rooms) {
      for (const placed of room.artworks) {
        const styleId = placed.artwork.frameStyle;
        const frame = FRAME_STYLES[styleId] ?? FRAME_STYLES["thin-black-metal"];
        if (frame.barWidth === 0) continue;
        const list = byStyle.get(frame.id) ?? [];
        list.push(...barsFor(placed, frame));
        byStyle.set(frame.id, list);
      }
    }
    return [...byStyle.entries()];
  }, [rooms]);

  return (
    <>
      {groups.map(([styleId, bars]) => (
        <FrameStyleInstances key={styleId} style={FRAME_STYLES[styleId]} bars={bars} />
      ))}
    </>
  );
}

function FrameStyleInstances({ style, bars }: { style: FrameStyleDef; bars: BarInstance[] }) {
  const mesh = useMemo(() => {
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const material = new THREE.MeshStandardMaterial({
      color: style.color,
      metalness: style.metalness,
      roughness: style.roughness,
    });
    const instanced = new THREE.InstancedMesh(geometry, material, bars.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    bars.forEach((bar, i) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), bar.rotationY);
      m.compose(bar.position, q, bar.scale);
      instanced.setMatrixAt(i, m);
    });
    instanced.instanceMatrix.needsUpdate = true;
    return instanced;
  }, [style, bars]);

  // These are hand-built objects, so R3F will not dispose them for us —
  // without this, every room change orphans a geometry and a material.
  useEffect(() => {
    return () => {
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
      mesh.dispose();
    };
  }, [mesh]);

  return <primitive object={mesh} />;
}
