import { buildLayout, type HangDensity } from "@/lib/layout";
import type { ArtworkView } from "@/lib/galleries";
import { ARCHETYPES } from "@/lib/environments";

/**
 * Geometry assertions for the hanging engine. Overlapping canvases and
 * pieces hung through walls are the failure modes that only show up with
 * real piece counts, so exercise the matrix rather than eyeballing one
 * gallery. Run: npx tsx scripts/check-layout.ts
 */

function makeArtworks(n: number, opts: { heroes?: number } = {}): ArtworkView[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `a${i}`,
    title: `Work ${i}`,
    caption: "",
    widthPx: i % 3 === 0 ? 1600 : 2400,
    heightPx: i % 3 === 0 ? 2400 : 1600,
    dominantColors: ["#888888"],
    license: "all-rights-reserved",
    spotlight: false,
    hero: i < (opts.heroes ?? 0),
    roomId: null,
    sortOrder: i,
    frameStyle: "thin-black-metal",
    urls: { thumb: null, wall: null, zoom: null },
  }));
}

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (!ok) {
    failures += 1;
    console.error(`FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const densities: HangDensity[] = ["salon", "standard", "airy"];
const counts = [3, 8, 14, 15, 30, 50, 80, 120];

/**
 * A creator-defined room holding every piece. Auto-segmentation respects
 * per-room capacity; a hand-built room does not, so this is the path most
 * likely to crowd a wall.
 */
function manualRooms(archetypeId: string, artworks: ArtworkView[]) {
  return [
    {
      id: "room-1",
      archetype: archetypeId,
      footprintM2: ARCHETYPES[archetypeId].defaultFootprintM2,
      ceilingM: ARCHETYPES[archetypeId].defaultCeilingM,
      wallColor: null,
      floorMaterial: null,
      lightingRig: null,
      name: "Manual",
      chapterLabel: null,
      kind: "room",
      artworkIds: artworks.map((a) => a.id),
    },
  ];
}

for (const archetypeId of Object.keys(ARCHETYPES)) {
  for (const density of densities) {
    for (const count of counts) {
      for (const heroes of [0, 1, 3, 5, 7]) {
        for (const mode of ["auto", "manual"] as const) {
          const artworks = makeArtworks(count, { heroes });
          const layout = buildLayout({
            archetypeId,
            hangDensity: density,
            lightingDefault: "",
            environmentParams: {},
            rooms: mode === "manual" ? manualRooms(archetypeId, artworks) : [],
            artworks,
          });
          const label = `${archetypeId}/${density}/${count}pc/${heroes}hero/${mode}`;

        // 1. Every piece is placed exactly once.
        const placedIds = layout.rooms.flatMap((r) => r.artworks.map((p) => p.artwork.id));
        check(label, placedIds.length === count, `placed ${placedIds.length} of ${count}`);
        check(label, new Set(placedIds).size === placedIds.length, "duplicate placement");

        for (const room of layout.rooms) {
          // 2. No two canvases on the same wall may overlap — compared as
          //    2D rectangles. Bucketing by height first would hide exactly
          //    the case where a big piece swallows a smaller one hung at a
          //    different height on the same wall.
          const byWall = new Map<
            string,
            Array<{ id: string; minU: number; maxU: number; minV: number; maxV: number }>
          >();
          for (const p of room.artworks) {
            // u = along the wall, v = height.
            const along =
              p.wall === "north" || p.wall === "south" ? p.position[0] : p.position[2];
            const list = byWall.get(p.wall) ?? [];
            list.push({
              id: p.artwork.id,
              minU: along - p.width / 2,
              maxU: along + p.width / 2,
              minV: p.position[1] - p.height / 2,
              maxV: p.position[1] + p.height / 2,
            });
            byWall.set(p.wall, list);
          }
          for (const [wall, rects] of byWall) {
            for (let i = 0; i < rects.length; i++) {
              for (let j = i + 1; j < rects.length; j++) {
                const a = rects[i];
                const b = rects[j];
                const overlaps =
                  a.minU < b.maxU - 1e-6 &&
                  b.minU < a.maxU - 1e-6 &&
                  a.minV < b.maxV - 1e-6 &&
                  b.minV < a.maxV - 1e-6;
                check(
                  label,
                  !overlaps,
                  `${a.id} and ${b.id} overlap on ${wall} in room ${room.index}`,
                );
              }
            }
          }

          // 2b. Nothing may be hung across a doorway.
          for (const p of room.artworks) {
            const along =
              p.wall === "north" || p.wall === "south" ? p.position[0] : p.position[2];
            const wallCentre =
              p.wall === "north" || p.wall === "south" ? room.center[0] : room.center[1];
            for (const door of room.doors.filter((d) => d.side === p.wall)) {
              const doorMin = wallCentre + door.offset - door.width / 2;
              const doorMax = wallCentre + door.offset + door.width / 2;
              const clear =
                along + p.width / 2 <= doorMin + 1e-6 || along - p.width / 2 >= doorMax - 1e-6;
              check(label, clear, `piece hung across the ${p.wall} doorway in room ${room.index}`);
            }
          }

          // 3. Pieces stay inside the room footprint and below the ceiling.
          for (const p of room.artworks) {
            const [x, y, z] = p.position;
            const insideX = Math.abs(x - room.center[0]) <= room.width / 2 + 0.2;
            const insideZ = Math.abs(z - room.center[1]) <= room.depth / 2 + 0.2;
            check(label, insideX && insideZ, `piece outside room ${room.index}`);
            check(
              label,
              y + p.height / 2 <= room.ceiling && y - p.height / 2 >= 0,
              `piece breaches floor/ceiling in room ${room.index}`,
            );
          }
          }
        }
      }
    }
  }
}

if (failures === 0) {
  console.log("layout geometry: all configurations clean");
  process.exit(0);
}
console.error(`layout geometry: ${failures} failing assertions`);
process.exit(1);
