"use client";

import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { GalleryLayout, PlacedArtwork } from "@/lib/layout";
import { roomAtPoint, viewpointFor } from "@/lib/layout";
import { useSceneStore } from "./store";

/**
 * First-person navigation: WASD/arrow keys + drag-look + click-to-move on
 * desktop; the same click/tap-to-walk path and a joystick vector on mobile.
 * Focus mode eases the camera to a viewpoint in front of an artwork.
 */

const EYE_HEIGHT = 1.6;
const WALK_SPEED = 3.2;
const PLAYER_RADIUS = 0.35;
const LOOK_SPEED = 0.0032;

export function PlayerControls({
  layout,
  placedById,
}: {
  layout: GalleryLayout;
  placedById: Map<string, PlacedArtwork>;
}) {
  const { camera, gl } = useThree();
  const keys = useRef<Record<string, boolean>>({});
  const yaw = useRef(layout.spawn.rotationY);
  const pitch = useRef(0);
  const dragging = useRef(false);
  const lastPointer = useRef<[number, number] | null>(null);
  const velocity = useMemo(() => new THREE.Vector3(), []);

  const focusedArtworkId = useSceneStore((s) => s.focusedArtworkId);

  // Spawn
  useEffect(() => {
    camera.position.set(...layout.spawn.position);
    yaw.current = layout.spawn.rotationY;
    camera.rotation.set(0, yaw.current, 0, "YXZ");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout]);

  // Keyboard
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      keys.current[e.code] = true;
      if (e.code === "Escape") useSceneStore.getState().focusArtwork(null);
    };
    const up = (e: KeyboardEvent) => {
      keys.current[e.code] = false;
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  // Drag-look (mouse + touch)
  useEffect(() => {
    const el = gl.domElement;
    const onDown = (e: PointerEvent) => {
      dragging.current = true;
      lastPointer.current = [e.clientX, e.clientY];
    };
    const onMove = (e: PointerEvent) => {
      if (!dragging.current || !lastPointer.current) return;
      const [lx, ly] = lastPointer.current;
      const dx = e.clientX - lx;
      const dy = e.clientY - ly;
      lastPointer.current = [e.clientX, e.clientY];
      // A real drag cancels pending click-to-move.
      if (Math.abs(dx) + Math.abs(dy) > 2) {
        yaw.current -= dx * LOOK_SPEED;
        pitch.current = THREE.MathUtils.clamp(pitch.current - dy * LOOK_SPEED, -1.2, 1.2);
      }
    };
    const onUp = () => {
      dragging.current = false;
      lastPointer.current = null;
    };
    el.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      el.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [gl]);

  useFrame((_, rawDelta) => {
    const delta = Math.min(rawDelta, 0.05);
    const state = useSceneStore.getState();

    // Teleport requests win.
    if (state.teleportTo) {
      camera.position.set(state.teleportTo[0], EYE_HEIGHT, state.teleportTo[1]);
      // Sync the active room immediately: residency, the lighting rig, and
      // the chapter label all key off it, and without this they stay on
      // the previous room until the visitor happens to take a step.
      const landed = roomAtPoint(layout, state.teleportTo[0], state.teleportTo[1]);
      if (landed && landed.index !== state.activeRoomIndex) {
        state.setActiveRoom(landed.index);
      }
      state.clearTeleport();
    }

    // Focus mode: ease toward the artwork viewpoint, look at the piece.
    const focused = focusedArtworkId ? placedById.get(focusedArtworkId) : null;
    if (focused) {
      const vp = viewpointFor(focused);
      const target = new THREE.Vector3(...vp.position);
      camera.position.lerp(target, 1 - Math.exp(-delta * 4));
      const look = new THREE.Vector3(...vp.lookAt);
      const m = new THREE.Matrix4().lookAt(camera.position, look, new THREE.Vector3(0, 1, 0));
      const q = new THREE.Quaternion().setFromRotationMatrix(m);
      camera.quaternion.slerp(q, 1 - Math.exp(-delta * 4));
      // Keep yaw/pitch in sync so leaving focus doesn't snap.
      const e = new THREE.Euler().setFromQuaternion(camera.quaternion, "YXZ");
      yaw.current = e.y;
      pitch.current = e.x;
      return;
    }

    camera.rotation.set(pitch.current, yaw.current, 0, "YXZ");

    // Input vector: keys + joystick.
    const input = new THREE.Vector2(0, 0);
    if (keys.current["KeyW"] || keys.current["ArrowUp"]) input.y += 1;
    if (keys.current["KeyS"] || keys.current["ArrowDown"]) input.y -= 1;
    if (keys.current["KeyA"] || keys.current["ArrowLeft"]) input.x -= 1;
    if (keys.current["KeyD"] || keys.current["ArrowRight"]) input.x += 1;
    input.x += state.joystick[0];
    input.y += state.joystick[1];
    if (input.lengthSq() > 1) input.normalize();

    const forward = new THREE.Vector3(-Math.sin(yaw.current), 0, -Math.cos(yaw.current));
    const right = new THREE.Vector3(-forward.z, 0, forward.x);
    velocity
      .copy(forward.multiplyScalar(input.y).add(right.multiplyScalar(input.x)))
      .multiplyScalar(WALK_SPEED);

    // Click-to-move: walk toward the target unless keys/joystick take over.
    if (state.moveTarget && input.lengthSq() < 0.01) {
      const to = new THREE.Vector3(
        state.moveTarget[0] - camera.position.x,
        0,
        state.moveTarget[1] - camera.position.z,
      );
      if (to.length() < 0.25) {
        state.setMoveTarget(null);
      } else {
        velocity.copy(to.normalize().multiplyScalar(WALK_SPEED));
      }
    } else if (input.lengthSq() >= 0.01 && state.moveTarget) {
      state.setMoveTarget(null);
    }

    if (velocity.lengthSq() > 0) {
      const next = camera.position.clone().addScaledVector(velocity, delta);
      const corrected = collide(next, layout);
      camera.position.set(corrected.x, EYE_HEIGHT, corrected.z);

      const room = roomAtPoint(layout, corrected.x, corrected.z);
      if (room && room.index !== state.activeRoomIndex) {
        state.setActiveRoom(room.index);
      }
    }
  });

  return null;
}

/** Circle-vs-segment pushback against the layout's collision walls. */
function collide(next: THREE.Vector3, layout: GalleryLayout): THREE.Vector3 {
  const p = new THREE.Vector2(next.x, next.z);
  for (let pass = 0; pass < 2; pass++) {
    for (const seg of layout.walls) {
      const a = new THREE.Vector2(seg.a[0], seg.a[1]);
      const b = new THREE.Vector2(seg.b[0], seg.b[1]);
      const ab = b.clone().sub(a);
      const t = THREE.MathUtils.clamp(p.clone().sub(a).dot(ab) / ab.lengthSq(), 0, 1);
      const closest = a.clone().addScaledVector(ab, t);
      const toP = p.clone().sub(closest);
      const dist = toP.length();
      if (dist < PLAYER_RADIUS && dist > 1e-6) {
        p.addScaledVector(toP.normalize(), PLAYER_RADIUS - dist);
      }
    }
  }
  return new THREE.Vector3(p.x, next.y, p.y);
}
