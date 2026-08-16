import type { ArtworkView, Room } from "@/lib/galleries";
import { ARCHETYPES, type ArchetypeDef } from "@/lib/environments";
import { ROOM_SEGMENT_THRESHOLD } from "@/lib/tiers";

/**
 * The layout engine: pure functions from gallery config + artworks to a
 * serializable world description. The live scene, the mini-map, and the
 * static export all consume the same GalleryLayout — no scene is ever
 * hardcoded.
 */

export type HangDensity = "salon" | "standard" | "airy";

/** Linear wall meters consumed per piece, by hang density. */
const METERS_PER_PIECE: Record<HangDensity, number> = {
  salon: 1.3,
  standard: 2.2,
  airy: 3.4,
};

/** Salon hangs stack a second row, doubling wall capacity. */
const SALON_ROWS = 2;

const EYE_HEIGHT = 1.6;
const DOOR_WIDTH = 1.8;
const DOOR_HEIGHT = 2.6;
const WALL_MARGIN = 0.9; // keep art away from corners/doors

export type WallSide = "north" | "south" | "west" | "east";

export interface PlacedArtwork {
  artwork: ArtworkView;
  roomIndex: number;
  wall: WallSide;
  /** World-space center of the canvas. */
  position: [number, number, number];
  /** Rotation around Y so the face points into the room. */
  rotationY: number;
  /** Canvas size in meters. */
  width: number;
  height: number;
}

export interface DoorSpec {
  side: WallSide;
  /** Offset along the wall from its center, meters. */
  offset: number;
  width: number;
  height: number;
  toRoomIndex: number;
}

export interface LayoutRoom {
  index: number;
  id: string | null; // DB room id when persisted
  kind: "room" | "corridor" | "courtyard";
  name: string;
  chapterLabel: string | null;
  archetype: ArchetypeDef;
  wallColor: string;
  floorMaterial: string;
  lightingRig: string;
  center: [number, number]; // x, z
  width: number; // along X
  depth: number; // along Z
  ceiling: number;
  doors: DoorSpec[];
  artworks: PlacedArtwork[];
}

export interface WallSegment {
  /** 2D endpoints (x1,z1)-(x2,z2) for collision. */
  a: [number, number];
  b: [number, number];
}

export interface GalleryLayout {
  rooms: LayoutRoom[];
  spawn: { position: [number, number, number]; rotationY: number };
  walls: WallSegment[];
  totalPieces: number;
}

export interface RoomConfigInput {
  id: string | null;
  archetype: string;
  footprintM2: number;
  ceilingM: number;
  wallColor: string | null;
  floorMaterial: string | null;
  lightingRig: string | null;
  name: string | null;
  chapterLabel: string | null;
  kind: string;
  artworkIds: string[]; // explicit membership, in order
}

export interface LayoutInput {
  archetypeId: string;
  hangDensity: HangDensity;
  lightingDefault: string;
  environmentParams: Record<string, unknown>;
  rooms: RoomConfigInput[]; // may be empty → auto-segment
  artworks: ArtworkView[];
}

// ---------------------------------------------------------------------------
// Room capacity + auto-segmentation
// ---------------------------------------------------------------------------

function roomDims(footprintM2: number): { width: number; depth: number } {
  // 4:3-ish footprint; corridors override separately.
  const width = Math.sqrt(footprintM2 * (4 / 3));
  return { width, depth: footprintM2 / width };
}

function usableWallMeters(width: number, depth: number, doorCount: number): number {
  const perimeter = 2 * (width + depth);
  return perimeter - doorCount * (DOOR_WIDTH + 2 * WALL_MARGIN) - 4 * WALL_MARGIN;
}

function roomCapacity(
  archetype: ArchetypeDef,
  footprintM2: number,
  density: HangDensity,
  doorCount: number,
): number {
  const { width, depth } = roomDims(footprintM2);
  const meters = usableWallMeters(width, depth, doorCount);
  const rows = density === "salon" && archetype.salonCapable ? SALON_ROWS : 1;
  return Math.max(1, Math.floor((meters / METERS_PER_PIECE[density]) * rows));
}

/**
 * Auto-curation default: chapters by upload order. Heroes get their own
 * wall (consuming extra capacity); galleries at or under the threshold
 * stay a single room.
 */
export function autoSegment(input: LayoutInput): RoomConfigInput[] {
  const archetype = ARCHETYPES[input.archetypeId] ?? ARCHETYPES["white-cube"];
  const works = input.artworks;

  if (works.length <= ROOM_SEGMENT_THRESHOLD) {
    return [defaultRoom(archetype, input, works.map((w) => w.id), null)];
  }

  const capacity = roomCapacity(archetype, archetype.defaultFootprintM2, input.hangDensity, 2);
  const chunks: ArtworkView[][] = [];
  let current: ArtworkView[] = [];
  let used = 0;
  for (const w of works) {
    // A hero piece costs a whole wall (~1/4 of room capacity, min 3 slots).
    const cost = w.hero ? Math.max(3, Math.ceil(capacity / 4)) : 1;
    if (used + cost > capacity && current.length > 0) {
      chunks.push(current);
      current = [];
      used = 0;
    }
    current.push(w);
    used += cost;
  }
  if (current.length > 0) chunks.push(current);

  const rooms: RoomConfigInput[] = [];
  chunks.forEach((chunk, i) => {
    rooms.push(
      defaultRoom(archetype, input, chunk.map((w) => w.id), `Room ${toRoman(i + 1)}`),
    );
    // Between-wings pacing: insert a transition after every second room.
    const isLast = i === chunks.length - 1;
    if (!isLast && (i + 1) % 2 === 0) {
      rooms.push({
        id: null,
        archetype: archetype.outdoor ? archetype.id : transitionArchetype(archetype),
        footprintM2: 30,
        ceilingM: archetype.defaultCeilingM,
        wallColor: null,
        floorMaterial: null,
        lightingRig: null,
        name: null,
        chapterLabel: null,
        kind: (i + 1) % 4 === 0 ? "courtyard" : "corridor",
        artworkIds: [],
      });
    }
  });
  return rooms;
}

function transitionArchetype(main: ArchetypeDef): string {
  // Courtyard archetype insertable between wings; corridors reuse the host kit.
  return main.connector === "colonnade" ? "night-garden" : main.id;
}

function defaultRoom(
  archetype: ArchetypeDef,
  input: LayoutInput,
  artworkIds: string[],
  name: string | null,
): RoomConfigInput {
  return {
    id: null,
    archetype: archetype.id,
    footprintM2: archetype.defaultFootprintM2,
    ceilingM: archetype.defaultCeilingM,
    wallColor: null,
    floorMaterial: null,
    lightingRig: input.lightingDefault || archetype.defaultLightingRig,
    name,
    chapterLabel: null,
    kind: "room",
    artworkIds,
  };
}

function toRoman(n: number): string {
  const table: Array<[number, string]> = [
    [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"],
  ];
  let out = "";
  let v = n;
  for (const [value, sym] of table) {
    while (v >= value) {
      out += sym;
      v -= value;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// World building
// ---------------------------------------------------------------------------

const ROOM_GAP = 0.4; // shared-wall thickness between chained rooms

export function buildLayout(input: LayoutInput): GalleryLayout {
  const roomConfigs =
    input.rooms.length > 0 && input.rooms.some((r) => r.artworkIds.length > 0)
      ? input.rooms
      : autoSegment(input);

  const byId = new Map(input.artworks.map((a) => [a.id, a]));
  const rooms: LayoutRoom[] = [];
  let cursorX = 0;

  // "Seed with a photo": a reference-image palette overrides the archetype
  // wall color unless the room sets one explicitly.
  const seeded = (input.environmentParams?.seededPalette ?? null) as {
    wall?: string;
  } | null;

  roomConfigs.forEach((cfg, index) => {
    const archetype = ARCHETYPES[cfg.archetype] ?? ARCHETYPES["white-cube"];
    let width: number;
    let depth: number;
    if (cfg.kind === "corridor") {
      width = 7;
      depth = 3.2;
    } else {
      const dims = roomDims(cfg.footprintM2 || archetype.defaultFootprintM2);
      width = dims.width;
      depth = dims.depth;
    }
    const center: [number, number] = [cursorX + width / 2, 0];
    cursorX += width + ROOM_GAP;

    const doors: DoorSpec[] = [];
    if (index > 0) {
      doors.push({ side: "west", offset: 0, width: DOOR_WIDTH, height: DOOR_HEIGHT, toRoomIndex: index - 1 });
    }
    if (index < roomConfigs.length - 1) {
      doors.push({ side: "east", offset: 0, width: DOOR_WIDTH, height: DOOR_HEIGHT, toRoomIndex: index + 1 });
    }

    rooms.push({
      index,
      id: cfg.id,
      kind: (cfg.kind as LayoutRoom["kind"]) || "room",
      name: cfg.name ?? (cfg.kind === "corridor" ? "Passage" : cfg.kind === "courtyard" ? "Courtyard" : `Room ${toRoman(index + 1)}`),
      chapterLabel: cfg.chapterLabel,
      archetype,
      wallColor: cfg.wallColor ?? seeded?.wall ?? archetype.palette.wall,
      floorMaterial: cfg.floorMaterial ?? archetype.floorMaterial,
      lightingRig: cfg.lightingRig ?? archetype.defaultLightingRig,
      center,
      width,
      depth,
      ceiling: cfg.ceilingM || archetype.defaultCeilingM,
      doors,
      artworks: [],
    });
  });

  // Hang artworks room by room.
  roomConfigs.forEach((cfg, index) => {
    const room = rooms[index];
    const works = cfg.artworkIds
      .map((id) => byId.get(id))
      .filter((a): a is ArtworkView => Boolean(a));
    room.artworks = hangRoom(room, works, input.hangDensity);
  });

  const walls = collisionWalls(rooms);
  const first = rooms[0];
  return {
    rooms,
    spawn: {
      position: [first.center[0], EYE_HEIGHT, first.center[1] + first.depth / 2 - 1.4],
      rotationY: Math.PI, // face into the room (toward -Z wall)
    },
    walls,
    totalPieces: input.artworks.length,
  };
}

// ---------------------------------------------------------------------------
// Hanging
// ---------------------------------------------------------------------------

interface WallRun {
  side: WallSide;
  /** Usable run length in meters. */
  length: number;
  /** Door spans along this wall (offsets from center). */
  doors: DoorSpec[];
}

function wallRuns(room: LayoutRoom): WallRun[] {
  const runs: WallRun[] = [
    { side: "north", length: room.width, doors: [] },
    { side: "east", length: room.depth, doors: [] },
    { side: "south", length: room.width, doors: [] },
    { side: "west", length: room.depth, doors: [] },
  ];
  for (const door of room.doors) {
    const run = runs.find((r) => r.side === door.side);
    if (run) run.doors.push(door);
  }
  return runs;
}

function artworkSize(a: ArtworkView, hero: boolean): { w: number; h: number } {
  const aspect = a.widthPx && a.heightPx ? a.widthPx / a.heightPx : 4 / 3;
  const longest = hero ? 2.2 : 1.15;
  if (aspect >= 1) {
    return { w: longest, h: longest / aspect };
  }
  return { w: longest * aspect, h: longest };
}

/** Distribute works across the room's walls, skipping door spans. */
function hangRoom(
  room: LayoutRoom,
  works: ArtworkView[],
  density: HangDensity,
): PlacedArtwork[] {
  if (works.length === 0) return [];
  const placed: PlacedArtwork[] = [];
  const runs = wallRuns(room);
  const salon = density === "salon" && room.archetype.salonCapable;

  // Heroes first: each takes a full wall (prefer walls without doors).
  const heroes = works.filter((w) => w.hero);
  const rest = works.filter((w) => !w.hero);
  const heroWalls = new Set<WallSide>();
  for (const hero of heroes) {
    const run = runs.find((r) => r.doors.length === 0 && !heroWalls.has(r.side)) ?? runs[0];
    heroWalls.add(run.side);
    const size = artworkSize(hero, true);
    placed.push(placeOnWall(room, run.side, 0, EYE_HEIGHT + 0.15, hero, size));
  }

  // Distribute the rest around remaining walls proportionally to length.
  const available = runs.filter((r) => !heroWalls.has(r.side));
  const totalLen = available.reduce((s, r) => s + r.length, 0) || 1;
  let cursor = 0;
  const counts = available.map((r, i) =>
    i === available.length - 1
      ? rest.length - cursor
      : Math.min(rest.length - cursor, Math.round((r.length / totalLen) * rest.length)),
  );
  counts.forEach((c, i) => {
    if (c > 0) cursor += c;
  });

  let workIdx = 0;
  available.forEach((run, i) => {
    const count = Math.max(0, counts[i] ?? 0);
    const group = rest.slice(workIdx, workIdx + count);
    workIdx += count;
    if (group.length === 0) return;

    const rows = salon && group.length > 3 ? 2 : 1;
    const perRow = Math.ceil(group.length / rows);
    group.forEach((work, j) => {
      const row = Math.floor(j / perRow);
      const col = j % perRow;
      const size = artworkSize(work, false);
      const y = rows === 2 ? (row === 0 ? EYE_HEIGHT + 0.75 : EYE_HEIGHT - 0.35) : EYE_HEIGHT;
      const slot = slotOffset(run, col, perRow);
      placed.push(placeOnWall(room, run.side, slot, y, work, size));
    });
  });

  return placed;
}

/** Even slots along a wall, avoiding door spans and margins. */
function slotOffset(run: WallRun, index: number, count: number): number {
  const usable = run.length - 2 * WALL_MARGIN;
  const step = usable / (count + 1);
  let offset = -usable / 2 + step * (index + 1);
  // Nudge out of any door span.
  for (const door of run.doors) {
    const half = door.width / 2 + 0.5;
    if (Math.abs(offset - door.offset) < half) {
      offset = door.offset + (offset >= door.offset ? half : -half);
    }
  }
  return offset;
}

function placeOnWall(
  room: LayoutRoom,
  side: WallSide,
  offset: number,
  y: number,
  artwork: ArtworkView,
  size: { w: number; h: number },
): PlacedArtwork {
  const [cx, cz] = room.center;
  const halfW = room.width / 2;
  const halfD = room.depth / 2;
  const d = 0.001; // pull off the wall; frame depth handles the rest
  let position: [number, number, number];
  let rotationY: number;
  switch (side) {
    case "north": // wall at z = cz - halfD, art faces +Z
      position = [cx + offset, y, cz - halfD + d];
      rotationY = 0;
      break;
    case "south": // wall at z = cz + halfD, art faces -Z
      position = [cx - offset, y, cz + halfD - d];
      rotationY = Math.PI;
      break;
    case "west": // wall at x = cx - halfW, art faces +X
      position = [cx - halfW + d, y, cz - offset];
      rotationY = Math.PI / 2;
      break;
    case "east": // wall at x = cx + halfW, art faces -X
      position = [cx + halfW - d, y, cz + offset];
      rotationY = -Math.PI / 2;
      break;
  }
  return {
    artwork,
    roomIndex: room.index,
    wall: side,
    position,
    rotationY,
    width: size.w,
    height: size.h,
  };
}

// ---------------------------------------------------------------------------
// Collision walls (2D segments with door gaps)
// ---------------------------------------------------------------------------

function collisionWalls(rooms: LayoutRoom[]): WallSegment[] {
  const segments: WallSegment[] = [];
  for (const room of rooms) {
    const [cx, cz] = room.center;
    const halfW = room.width / 2;
    const halfD = room.depth / 2;
    const sides: Array<{
      side: WallSide;
      a: [number, number];
      b: [number, number];
      axis: "x" | "z";
    }> = [
      { side: "north", a: [cx - halfW, cz - halfD], b: [cx + halfW, cz - halfD], axis: "x" },
      { side: "south", a: [cx - halfW, cz + halfD], b: [cx + halfW, cz + halfD], axis: "x" },
      { side: "west", a: [cx - halfW, cz - halfD], b: [cx - halfW, cz + halfD], axis: "z" },
      { side: "east", a: [cx + halfW, cz - halfD], b: [cx + halfW, cz + halfD], axis: "z" },
    ];
    for (const s of sides) {
      const doors = room.doors.filter((d) => d.side === s.side);
      if (doors.length === 0) {
        segments.push({ a: s.a, b: s.b });
        continue;
      }
      // Split the wall around each door span (doors are offset from center).
      const lineCenter = s.axis === "x" ? cx : cz;
      const spans = doors
        .map((d) => [lineCenter + d.offset - d.width / 2, lineCenter + d.offset + d.width / 2])
        .sort((p, q) => p[0] - q[0]);
      let start = s.axis === "x" ? s.a[0] : s.a[1];
      const end = s.axis === "x" ? s.b[0] : s.b[1];
      const fixed = s.axis === "x" ? s.a[1] : s.a[0];
      for (const [gapStart, gapEnd] of spans) {
        if (gapStart > start) {
          segments.push(
            s.axis === "x"
              ? { a: [start, fixed], b: [gapStart, fixed] }
              : { a: [fixed, start], b: [fixed, gapStart] },
          );
        }
        start = gapEnd;
      }
      if (end > start) {
        segments.push(
          s.axis === "x"
            ? { a: [start, fixed], b: [end, fixed] }
            : { a: [fixed, start], b: [fixed, end] },
        );
      }
    }
  }
  return segments;
}

// ---------------------------------------------------------------------------
// Helpers for consumers
// ---------------------------------------------------------------------------

export function roomAtPoint(layout: GalleryLayout, x: number, z: number): LayoutRoom | null {
  for (const room of layout.rooms) {
    const [cx, cz] = room.center;
    if (
      Math.abs(x - cx) <= room.width / 2 + 0.3 &&
      Math.abs(z - cz) <= room.depth / 2 + 0.3
    ) {
      return room;
    }
  }
  return null;
}

/** Standing point in front of an artwork (for focus mode / deep links). */
export function viewpointFor(placed: PlacedArtwork, distance = 2.2): {
  position: [number, number, number];
  lookAt: [number, number, number];
} {
  const [x, y, z] = placed.position;
  const dx = Math.sin(placed.rotationY) * distance;
  const dz = Math.cos(placed.rotationY) * distance;
  return { position: [x + dx, EYE_HEIGHT, z + dz], lookAt: [x, y, z] };
}

/** Convert DB rooms + artwork assignments into layout input rooms. */
export function roomsToConfig(
  dbRooms: Room[],
  artworks: ArtworkView[],
): RoomConfigInput[] {
  return dbRooms.map((r) => ({
    id: r.id,
    archetype: r.archetype,
    footprintM2: r.footprintM2,
    ceilingM: r.ceilingM,
    wallColor: r.wallColor,
    floorMaterial: r.floorMaterial,
    lightingRig: r.lightingRig,
    name: r.name,
    chapterLabel: r.chapterLabel,
    kind: r.kind,
    artworkIds: artworks
      .filter((a) => a.roomId === r.id)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((a) => a.id),
  }));
}
