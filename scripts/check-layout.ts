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

for (const archetypeId of Object.keys(ARCHETYPES)) {
  for (const density of densities) {
    for (const count of counts) {
      for (const heroes of [0, 1, 3, 5]) {
        const artworks = makeArtworks(count, { heroes });
        const layout = buildLayout({
          archetypeId,
          hangDensity: density,
          lightingDefault: "",
          environmentParams: {},
          rooms: [],
          artworks,
        });
        const label = `${archetypeId}/${density}/${count}pc/${heroes}hero`;

        // 1. Every piece is placed exactly once.
        const placedIds = layout.rooms.flatMap((r) => r.artworks.map((p) => p.artwork.id));
        check(label, placedIds.length === count, `placed ${placedIds.length} of ${count}`);
        check(label, new Set(placedIds).size === placedIds.length, "duplicate placement");

        for (const room of layout.rooms) {
          // 2. No two canvases on the same wall+row overlap.
          const byWall = new Map<string, Array<{ min: number; max: number; y: number }>>();
          for (const p of room.artworks) {
            // Project onto the wall's own axis.
            const along =
              p.wall === "north" || p.wall === "south" ? p.position[0] : p.position[2];
            const key = `${p.wall}:${p.position[1].toFixed(2)}`;
            const list = byWall.get(key) ?? [];
            list.push({ min: along - p.width / 2, max: along + p.width / 2, y: p.position[1] });
            byWall.set(key, list);
          }
          for (const [key, spans] of byWall) {
            spans.sort((a, b) => a.min - b.min);
            for (let i = 1; i < spans.length; i++) {
              check(
                label,
                spans[i].min >= spans[i - 1].max - 1e-6,
                `overlap on ${key} in room ${room.index} (${spans[i - 1].max.toFixed(2)} > ${spans[i].min.toFixed(2)})`,
              );
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

if (failures === 0) {
  console.log("layout geometry: all configurations clean");
  process.exit(0);
}
console.error(`layout geometry: ${failures} failing assertions`);
process.exit(1);
