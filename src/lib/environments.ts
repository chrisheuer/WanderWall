/**
 * Environment archetypes: abstracted names, no real museum names or logos.
 * Each archetype = geometry kit + material palette + compatible lighting
 * rigs + door/corridor connectors so rooms chain procedurally.
 */

export interface ArchetypePalette {
  wall: string;
  accentWall: string;
  floor: string;
  ceiling: string;
  trim: string;
  ambient: string;
}

export interface ArchetypeDef {
  id: string;
  name: string;
  description: string;
  palette: ArchetypePalette;
  floorMaterial: "oak" | "terrazzo" | "concrete" | "stone" | "brick" | "gravel" | "walnut";
  /** Compatible lighting rigs (ids from lighting.ts). */
  lightingRigs: string[];
  defaultLightingRig: string;
  /** Room geometry defaults. */
  defaultFootprintM2: number;
  defaultCeilingM: number;
  /** Whether the archetype reads as outdoor (courtyards). */
  outdoor: boolean;
  /** Supports dense salon hangs (floor-to-ceiling). */
  salonCapable: boolean;
  /** Connector style between rooms. */
  connector: "doorway" | "arch" | "corridor" | "colonnade";
  /** Keywords for "describe your space" mapping. */
  keywords: string[];
}

export const ARCHETYPES: Record<string, ArchetypeDef> = {
  "white-cube": {
    id: "white-cube",
    name: "White Cube",
    description: "The contemporary default: white walls, pale oak floor, even light.",
    palette: {
      wall: "#f5f4f0",
      accentWall: "#e9e7e1",
      floor: "#d9cdb8",
      ceiling: "#fafaf8",
      trim: "#ffffff",
      ambient: "#fdfdfb",
    },
    floorMaterial: "oak",
    lightingRigs: ["bright-daylight", "dramatic-spots", "soft-overcast"],
    defaultLightingRig: "bright-daylight",
    defaultFootprintM2: 64,
    defaultCeilingM: 4.2,
    outdoor: false,
    salonCapable: false,
    connector: "doorway",
    keywords: ["modern", "contemporary", "minimal", "clean", "white", "simple"],
  },
  "collectors-house": {
    id: "collectors-house",
    name: "Collector's House",
    description: "Intimate house-museum rooms: wood floors, domestic scale, salon-capable.",
    palette: {
      wall: "#e8ddc8",
      accentWall: "#a63d2f",
      floor: "#8a5a33",
      ceiling: "#f4efe4",
      trim: "#f0e9da",
      ambient: "#f7efdd",
    },
    floorMaterial: "walnut",
    lightingRigs: ["warm-evening", "soft-overcast", "dramatic-spots"],
    defaultLightingRig: "warm-evening",
    defaultFootprintM2: 36,
    defaultCeilingM: 3.2,
    outdoor: false,
    salonCapable: true,
    connector: "doorway",
    keywords: ["house", "home", "intimate", "cozy", "domestic", "victorian", "parlor"],
  },
  "palazzo-courtyard": {
    id: "palazzo-courtyard",
    name: "Palazzo Courtyard",
    description: "Rooms arranged around a planted central court with colonnades.",
    palette: {
      wall: "#e6d8bf",
      accentWall: "#c8a870",
      floor: "#cbb489",
      ceiling: "#efe6d2",
      trim: "#d9c8a6",
      ambient: "#f6ecd8",
    },
    floorMaterial: "stone",
    lightingRigs: ["bright-daylight", "warm-evening"],
    defaultLightingRig: "bright-daylight",
    defaultFootprintM2: 72,
    defaultCeilingM: 5,
    outdoor: false,
    salonCapable: false,
    connector: "colonnade",
    keywords: ["palazzo", "italian", "renaissance", "courtyard", "classical", "villa"],
  },
  "salon-walls": {
    id: "salon-walls",
    name: "Salon Walls",
    description: "Dense floor-to-ceiling hang on warm fabric walls.",
    palette: {
      wall: "#6d2f2a",
      accentWall: "#3f5741",
      floor: "#7a5a3a",
      ceiling: "#efe8d8",
      trim: "#caa85e",
      ambient: "#f3e5c9",
    },
    floorMaterial: "walnut",
    lightingRigs: ["warm-evening", "dramatic-spots"],
    defaultLightingRig: "warm-evening",
    defaultFootprintM2: 48,
    defaultCeilingM: 5.4,
    outdoor: false,
    salonCapable: true,
    connector: "arch",
    keywords: ["salon", "dense", "fabric", "warm", "classic", "paris", "academy"],
  },
  "midtown-modern": {
    id: "midtown-modern",
    name: "Midtown Modern",
    description:
      "Modern-museum feel: white walls, oak and terrazzo floors, a glass curtain wall onto a sculpture garden, lobby entry moment.",
    palette: {
      wall: "#f7f7f5",
      accentWall: "#dcdcd6",
      floor: "#cfc4ae",
      ceiling: "#fbfbfa",
      trim: "#b9b9b2",
      ambient: "#fcfcfa",
    },
    floorMaterial: "terrazzo",
    lightingRigs: ["bright-daylight", "soft-overcast", "dramatic-spots"],
    defaultLightingRig: "bright-daylight",
    defaultFootprintM2: 96,
    defaultCeilingM: 4.8,
    outdoor: false,
    salonCapable: false,
    connector: "corridor",
    keywords: ["museum", "modern", "nyc", "glass", "garden", "lobby", "midtown"],
  },
  "industrial-loft": {
    id: "industrial-loft",
    name: "Industrial Loft",
    description: "Brick, steel, and daylight monitors overhead.",
    palette: {
      wall: "#9c5a41",
      accentWall: "#6b6b68",
      floor: "#8e8e88",
      ceiling: "#5d5d59",
      trim: "#3c3c3a",
      ambient: "#efeae2",
    },
    floorMaterial: "concrete",
    lightingRigs: ["bright-daylight", "soft-overcast", "dramatic-spots"],
    defaultLightingRig: "soft-overcast",
    defaultFootprintM2: 110,
    defaultCeilingM: 6,
    outdoor: false,
    salonCapable: true,
    connector: "corridor",
    keywords: ["industrial", "loft", "brick", "warehouse", "steel", "raw", "brooklyn"],
  },
  "stone-hall": {
    id: "stone-hall",
    name: "Stone Hall",
    description: "Vaulted and dramatic — built for hero pieces.",
    palette: {
      wall: "#b3a58c",
      accentWall: "#8f8267",
      floor: "#a3927a",
      ceiling: "#948a75",
      trim: "#7c715c",
      ambient: "#e8dcC2",
    },
    floorMaterial: "stone",
    lightingRigs: ["dramatic-spots", "warm-evening"],
    defaultLightingRig: "dramatic-spots",
    defaultFootprintM2: 84,
    defaultCeilingM: 8,
    outdoor: false,
    salonCapable: false,
    connector: "arch",
    keywords: ["stone", "vault", "cathedral", "dramatic", "medieval", "hall", "castle"],
  },
  "night-garden": {
    id: "night-garden",
    name: "Night Garden",
    description:
      "An outdoor sculpture court after dark — standalone, or a transition between wings.",
    palette: {
      wall: "#233327",
      accentWall: "#31473a",
      floor: "#4a4a42",
      ceiling: "#0d1420",
      trim: "#5d7261",
      ambient: "#1a2436",
    },
    floorMaterial: "gravel",
    lightingRigs: ["warm-evening", "dramatic-spots"],
    defaultLightingRig: "warm-evening",
    defaultFootprintM2: 90,
    defaultCeilingM: 12,
    outdoor: true,
    salonCapable: false,
    connector: "colonnade",
    keywords: ["garden", "night", "outdoor", "sculpture", "court", "dark", "plants"],
  },
};

export const ARCHETYPE_LIST = Object.values(ARCHETYPES).map((a, i) => ({ ...a, sortOrder: i }));

/** "Describe your space" → closest archetype by keyword overlap. */
export function mapDescriptionToArchetype(description: string): ArchetypeDef {
  const words = description.toLowerCase().split(/[^a-z]+/).filter(Boolean);
  let best: ArchetypeDef = ARCHETYPES["white-cube"];
  let bestScore = 0;
  for (const def of Object.values(ARCHETYPES)) {
    let score = 0;
    for (const w of words) {
      if (def.keywords.includes(w)) score += 2;
      if (def.name.toLowerCase().includes(w)) score += 1;
    }
    if (score > bestScore) {
      best = def;
      bestScore = score;
    }
  }
  return best;
}
