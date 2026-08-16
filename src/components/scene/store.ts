"use client";

import { create } from "zustand";

/** Shared scene state: navigation, focus, residency. */
interface SceneState {
  activeRoomIndex: number;
  focusedArtworkId: string | null;
  /** Click-to-move / tap-to-walk target on the floor plane. */
  moveTarget: [number, number] | null;
  /** Teleport request (doorway or mini-map click). */
  teleportTo: [number, number] | null;
  /** Mobile joystick vector, -1..1 each axis. */
  joystick: [number, number];

  setActiveRoom(index: number): void;
  focusArtwork(id: string | null): void;
  setMoveTarget(target: [number, number] | null): void;
  requestTeleport(target: [number, number]): void;
  clearTeleport(): void;
  setJoystick(v: [number, number]): void;
}

export const useSceneStore = create<SceneState>((set) => ({
  activeRoomIndex: 0,
  focusedArtworkId: null,
  moveTarget: null,
  teleportTo: null,
  joystick: [0, 0],

  setActiveRoom: (index) => set({ activeRoomIndex: index }),
  focusArtwork: (id) => set({ focusedArtworkId: id, moveTarget: null }),
  setMoveTarget: (target) => set({ moveTarget: target }),
  requestTeleport: (target) => set({ teleportTo: target, moveTarget: null, focusedArtworkId: null }),
  clearTeleport: () => set({ teleportTo: null }),
  setJoystick: (v) => set({ joystick: v }),
}));
