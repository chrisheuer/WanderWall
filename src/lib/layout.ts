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

/** Smallest gap between neighbouring canvases. */
const MIN_GAP = 0.18;
/** Below this a piece is too small to read; add a row instead of shrinking. */
const COMFORTABLE_WIDTH = 0.75;
/** Top of the strip used when a wall is already occupied at eye level. */
const LOW_BAND_TOP = 0.95;

function artworkSize(
  a: ArtworkView,
  hero: boolean,
  maxWidth = Infinity,
  maxHeight = Infinity,
): { w: number; h: number } {
  const aspect = a.widthPx && a.heightPx ? a.widthPx / a.heightPx : 4 / 3;
  const longest = hero ? 2.2 : 1.15;
  const baseW = aspect >= 1 ? longest : longest * aspect;
  const baseH = aspect >= 1 ? longest / aspect : longest;
  // Shrink to fit the slot it was given. Never enlarge, and never exceed
  // the budget — a piece wider than its slot is a piece overlapping its
  // neighbour.
  const scale = Math.min(1, maxWidth / baseW, maxHeight / baseH);
  return { w: baseW * scale, h: baseH * scale };
}

interface FreeSpan {
  start: number;
  end: number;
}

/**
 * The stretches of a wall that can actually hold art: the run minus corner
 * margins and minus every door span. Carving doors out up front is what
 * lets slots be evenly spaced — the previous approach nudged a piece off
 * a door and straight into its neighbour.
 */
/** Remove [blockStart, blockEnd] from a set of spans. */
function carve(spans: FreeSpan[], blockStart: number, blockEnd: number): FreeSpan[] {
  const next: FreeSpan[] = [];
  for (const span of spans) {
    if (blockEnd <= span.start || blockStart >= span.end) {
      next.push(span);
      continue;
    }
    if (blockStart > span.start) next.push({ start: span.start, end: blockStart });
    if (blockEnd < span.end) next.push({ start: blockEnd, end: span.end });
  }
  return next;
}

function freeSpans(
  run: WallRun,
  relaxed = false,
  occupied: FreeSpan[] = [],
): FreeSpan[] {
  const margin = relaxed ? 0.35 : WALL_MARGIN;
  const doorPad = relaxed ? 0.15 : 0.4;
  const minSpan = relaxed ? 0.3 : 0.5;
  const half = run.length / 2;
  let spans: FreeSpan[] = [{ start: -half + margin, end: half - margin }];
  for (const door of run.doors) {
    spans = carve(
      spans,
      door.offset - door.width / 2 - doorPad,
      door.offset + door.width / 2 + doorPad,
    );
  }
  // Space already taken by a hero on this wall. Without this, a gallery
  // with a hero on every wall hangs the remaining pieces straight through
  // them.
  for (const taken of occupied) {
    spans = carve(spans, taken.start, taken.end);
  }
  return spans.filter((s) => s.end - s.start >= minSpan);
}

function spanLength(spans: FreeSpan[]): number {
  return spans.reduce((sum, s) => sum + (s.end - s.start), 0);
}

/** Split `count` items across parts proportionally, summing exactly. */
function apportion(weights: number[], count: number): number[] {
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  const exact = weights.map((w) => (w / total) * count);
  const alloc = exact.map((v) => Math.floor(v));
  let assigned = alloc.reduce((a, b) => a + b, 0);
  const order = exact
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac);
  for (let k = 0; assigned < count && order.length > 0; k++, assigned++) {
    alloc[order[k % order.length].i] += 1;
  }
  return alloc;
}

/** Evenly divided slots across a wall's free spans, widest span first. */
function slotsFor(spans: FreeSpan[], count: number): Array<{ offset: number; width: number }> {
  if (count <= 0 || spans.length === 0) return [];
  const alloc = apportion(
    spans.map((s) => s.end - s.start),
    count,
  );
  const slots: Array<{ offset: number; width: number }> = [];
  spans.forEach((span, i) => {
    const n = alloc[i];
    if (n <= 0) return;
    const width = (span.end - span.start) / n;
    for (let j = 0; j < n; j++) {
      slots.push({ offset: span.start + width * (j + 0.5), width });
    }
  });
  return slots.sort((a, b) => a.offset - b.offset);
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

  // Heroes first: each takes a whole wall. Doorless walls are preferred,
  // but once those are used we keep cycling through the remaining walls —
  // previously a third hero fell back to runs[0] and landed exactly on top
  // of the first one.
  const heroes = works.filter((w) => w.hero);
  const rest = works.filter((w) => !w.hero);
  const heroWalls = new Set<WallSide>();
  const leftoverHeroes: ArtworkView[] = [];
  /** Wall space consumed by heroes, so the remainder can hang around them. */
  const heroOccupancy = new Map<WallSide, FreeSpan[]>();
  for (const hero of heroes) {
    const run =
      runs.find((r) => r.doors.length === 0 && !heroWalls.has(r.side)) ??
      runs.find((r) => !heroWalls.has(r.side));
    if (!run) {
      // Every wall already carries a hero; hang the rest normally.
      leftoverHeroes.push(hero);
      continue;
    }
    const spans = freeSpans(run);
    const widest = [...spans].sort((a, b) => b.end - b.start - (a.end - a.start))[0];
    if (!widest) {
      leftoverHeroes.push(hero);
      continue;
    }
    heroWalls.add(run.side);
    const size = artworkSize(
      hero,
      true,
      widest.end - widest.start - MIN_GAP,
      room.ceiling - 1.0,
    );
    const centre = (widest.start + widest.end) / 2;
    heroOccupancy.set(run.side, [
      { start: centre - size.w / 2 - MIN_GAP, end: centre + size.w / 2 + MIN_GAP },
    ]);
    placed.push(
      placeOnWall(
        room,
        run.side,
        centre,
        heroBaseline(room, size.h),
        hero,
        size,
      ),
    );
  }

  // Distribute the remainder across the walls no hero claimed, in
  // proportion to hangable (door-free) wall length. If heroes took every
  // wall, fall back to all four so nothing is silently dropped.
  const remaining = [...leftoverHeroes, ...rest];
  const available = runs.filter((r) => !heroWalls.has(r.side));
  const candidates = available.length > 0 ? available : runs;
  /** Set when the remainder has to hang below whatever occupies the wall. */
  let lowBand = false;

  // Only walls that actually have hangable space take a share. A short
  // wall whose span is entirely consumed by a doorway gets nothing — its
  // pieces move to the walls that can hold them rather than being dropped.
  let walls = candidates
    .map((run) => ({ run, spans: freeSpans(run, false, heroOccupancy.get(run.side) ?? []) }))
    .filter((w) => w.spans.length > 0);
  if (walls.length === 0) {
    walls = candidates
      .map((run) => ({ run, spans: freeSpans(run, true, heroOccupancy.get(run.side) ?? []) }))
      .filter((w) => w.spans.length > 0);
  }
  if (walls.length === 0 && remaining.length > 0) {
    // Nothing is free at eye level. Rather than drop pieces or hang them
    // through a hero, take the longest wall and use the band beneath
    // whatever occupies it — vertically clear even where horizontally it
    // is not.
    const widest = [...candidates].sort((a, b) => b.length - a.length)[0];
    walls = [
      {
        run: widest,
        spans: [{ start: -widest.length / 2 + WALL_MARGIN, end: widest.length / 2 - WALL_MARGIN }],
      },
    ];
    lowBand = true;
  }

  const counts = apportion(
    walls.map((w) => spanLength(w.spans)),
    remaining.length,
  );

  let workIdx = 0;
  walls.forEach((wall, i) => {
    const group = remaining.slice(workIdx, workIdx + counts[i]);
    workIdx += counts[i];
    if (group.length === 0 || wall.spans.length === 0) return;

    // Add rows before shrinking: a crowded wall reads better as a salon
    // stack than as a row of postage stamps. Row count is bounded by what
    // the ceiling can actually carry.
    const usable = spanLength(wall.spans);
    // Row height shrinks as rows are added, so bound by a minimum band
    // rather than a fixed piece height — an over-full wall should stack
    // deeper instead of squeezing everything into two rows.
    const rowsByHeight = Math.max(1, Math.floor((room.ceiling - 0.8) / 0.8));
    const maxRows = Math.min(salon ? 4 : 3, rowsByHeight);
    let rows = 1;
    while (
      rows < maxRows &&
      usable / Math.ceil(group.length / rows) - MIN_GAP < COMFORTABLE_WIDTH
    ) {
      rows += 1;
    }

    let perRow = Math.ceil(group.length / rows);
    const slots = slotsFor(wall.spans, perRow);
    if (slots.length === 0) return;
    // Fragmented spans can yield fewer slots than asked for; add rows so
    // every piece still gets its own slot.
    if (slots.length < perRow) {
      perRow = slots.length;
      rows = Math.ceil(group.length / perRow);
    }

    // In the low-band fallback the wall is already occupied at eye level,
    // so the remainder sits in the strip beneath it.
    const bandSpace = lowBand ? LOW_BAND_TOP - 0.15 : room.ceiling - 0.7;
    const bandHeight = Math.min(1.35, Math.max(0.2, bandSpace / rows));

    // The stack is positioned so its lowest row already clears the floor.
    // Clamping each piece upward instead would push the bottom row into
    // the row above it — a vertical overlap in place of a horizontal one.
    const lowestTop = bandHeight * rows + 0.1;
    const stackTop = lowBand
      ? LOW_BAND_TOP
      : Math.min(
          Math.max(lowestTop, EYE_HEIGHT + (bandHeight * rows) / 2),
          Math.max(lowestTop, room.ceiling - 0.35),
        );

    group.forEach((work, j) => {
      const row = Math.floor(j / perRow);
      const slot = slots[j % perRow];
      // The gap shrinks with the slot instead of being a fixed floor: a
      // minimum width larger than the slot it sits in is how pieces end up
      // overlapping on a wall that is genuinely over capacity.
      const gap = Math.min(MIN_GAP, slot.width * 0.15);
      const size = artworkSize(
        work,
        false,
        Math.max(0.02, slot.width - gap),
        bandHeight - 0.08,
      );
      const y =
        rows === 1 && !lowBand ? EYE_HEIGHT : stackTop - bandHeight * (row + 0.5);
      placed.push(placeOnWall(room, wall.run.side, slot.offset, y, work, size));
    });
  });

  return placed;
}

/** Hero centre height: eye-ish, but always clear of floor and ceiling. */
function heroBaseline(room: LayoutRoom, height: number): number {
  const lowest = height / 2 + 0.35;
  const highest = room.ceiling - height / 2 - 0.3;
  return Math.min(Math.max(EYE_HEIGHT + 0.15, lowest), Math.max(lowest, highest));
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

/**
 * The room containing a point. Rooms are matched strictly first; only if
 * the point falls in the gap between rooms (a doorway) do we fall back to
 * the nearest room. Returning the first tolerance match instead made the
 * active room depend on array order, which flickered the lighting rig
 * while a visitor stood in a doorway.
 */
export function roomAtPoint(layout: GalleryLayout, x: number, z: number): LayoutRoom | null {
  let nearest: LayoutRoom | null = null;
  let nearestDistance = Infinity;

  for (const room of layout.rooms) {
    const [cx, cz] = room.center;
    const dx = Math.abs(x - cx) - room.width / 2;
    const dz = Math.abs(z - cz) - room.depth / 2;
    if (dx <= 0 && dz <= 0) return room; // strictly inside

    const outside = Math.max(dx, dz);
    if (outside <= ROOM_GAP + 0.35 && outside < nearestDistance) {
      nearest = room;
      nearestDistance = outside;
    }
  }
  return nearest;
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
  const configs = dbRooms.map((r) => ({
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

  // Anything not assigned to a room — newly ingested work, or a piece whose
  // room was deleted — joins the last hangable room instead of vanishing
  // from the gallery.
  const assigned = new Set(configs.flatMap((c) => c.artworkIds));
  const orphans = artworks
    .filter((a) => !assigned.has(a.id))
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((a) => a.id);
  if (orphans.length > 0 && configs.length > 0) {
    const target = [...configs].reverse().find((c) => c.kind === "room") ?? configs[0];
    target.artworkIds.push(...orphans);
  }
  return configs;
}
