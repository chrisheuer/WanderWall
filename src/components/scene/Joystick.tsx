"use client";

import { useRef } from "react";
import { useSceneStore } from "./store";

/** Mobile thumbstick: drives the same movement vector as WASD. */
export function Joystick() {
  const baseRef = useRef<HTMLDivElement>(null);
  const active = useRef(false);

  function update(e: React.PointerEvent) {
    const base = baseRef.current;
    if (!base || !active.current) return;
    const rect = base.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = (e.clientX - cx) / (rect.width / 2);
    const dy = (e.clientY - cy) / (rect.height / 2);
    const len = Math.hypot(dx, dy);
    const nx = len > 1 ? dx / len : dx;
    const ny = len > 1 ? dy / len : dy;
    // Screen up = forward.
    useSceneStore.getState().setJoystick([nx, -ny]);
  }

  function stop() {
    active.current = false;
    useSceneStore.getState().setJoystick([0, 0]);
  }

  return (
    <div
      ref={baseRef}
      onPointerDown={(e) => {
        active.current = true;
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        update(e);
      }}
      onPointerMove={update}
      onPointerUp={stop}
      onPointerCancel={stop}
      style={{
        position: "absolute",
        left: 18,
        bottom: 18,
        width: 96,
        height: 96,
        borderRadius: "50%",
        border: "2px solid rgba(255,255,255,0.45)",
        background: "rgba(20,20,18,0.35)",
        touchAction: "none",
      }}
      aria-label="Movement joystick"
    />
  );
}
