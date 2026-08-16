/** Lighting rigs — baked/cheap: ambient + hemisphere + a few directionals. */

export interface LightingRigDef {
  id: string;
  name: string;
  description: string;
  ambientColor: string;
  ambientIntensity: number;
  hemisphereSky: string;
  hemisphereGround: string;
  hemisphereIntensity: number;
  keyColor: string;
  keyIntensity: number;
  /** Normalized key light direction. */
  keyDirection: [number, number, number];
  /** Extra per-artwork spot intensity when `spotlight` is toggled. */
  spotlightIntensity: number;
  spotlightColor: string;
}

export const LIGHTING_RIGS: Record<string, LightingRigDef> = {
  "bright-daylight": {
    id: "bright-daylight",
    name: "Bright daylight",
    description: "Even, cool-white museum daylight.",
    ambientColor: "#ffffff",
    ambientIntensity: 0.75,
    hemisphereSky: "#eef3ff",
    hemisphereGround: "#d8d2c4",
    hemisphereIntensity: 0.55,
    keyColor: "#fffdf5",
    keyIntensity: 1.1,
    keyDirection: [0.35, -1, 0.2],
    spotlightIntensity: 1.6,
    spotlightColor: "#fff8ea",
  },
  "warm-evening": {
    id: "warm-evening",
    name: "Warm evening",
    description: "Amber lamps, low sun, honeyed walls.",
    ambientColor: "#ffe8c4",
    ambientIntensity: 0.5,
    hemisphereSky: "#ffd9a0",
    hemisphereGround: "#5a4632",
    hemisphereIntensity: 0.45,
    keyColor: "#ffca7a",
    keyIntensity: 0.9,
    keyDirection: [-0.5, -0.8, 0.3],
    spotlightIntensity: 2.0,
    spotlightColor: "#ffdba0",
  },
  "dramatic-spots": {
    id: "dramatic-spots",
    name: "Dramatic spots",
    description: "Dark room, works picked out by focused pools of light.",
    ambientColor: "#20232a",
    ambientIntensity: 0.35,
    hemisphereSky: "#2c2f38",
    hemisphereGround: "#15151a",
    hemisphereIntensity: 0.25,
    keyColor: "#f5efe0",
    keyIntensity: 0.35,
    keyDirection: [0, -1, 0],
    spotlightIntensity: 3.2,
    spotlightColor: "#fdf3da",
  },
  "soft-overcast": {
    id: "soft-overcast",
    name: "Soft overcast",
    description: "Shadowless north-light — photographs read true.",
    ambientColor: "#f2f4f5",
    ambientIntensity: 0.85,
    hemisphereSky: "#dfe6ea",
    hemisphereGround: "#c9c5bb",
    hemisphereIntensity: 0.6,
    keyColor: "#eef0f0",
    keyIntensity: 0.6,
    keyDirection: [0.1, -1, 0.1],
    spotlightIntensity: 1.2,
    spotlightColor: "#f4f4ee",
  },
};

export const LIGHTING_RIG_LIST = Object.values(LIGHTING_RIGS);
