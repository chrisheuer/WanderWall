import { db, tables } from "@/db";
import { ARCHETYPE_LIST } from "@/lib/environments";

/**
 * Galleries reference `environments` by foreign key, so the catalog has to
 * exist before the first gallery is created. scripts/seed.ts does this at
 * setup time; this is the safety net for a project where it was missed.
 * Cached per instance so it costs one query at most.
 */
let seeded = false;

export async function ensureEnvironmentsSeeded(): Promise<void> {
  if (seeded) return;

  const existing = await db()
    .select({ id: tables.environments.id })
    .from(tables.environments)
    .limit(1);
  if (existing.length > 0) {
    seeded = true;
    return;
  }

  await db()
    .insert(tables.environments)
    .values(
      ARCHETYPE_LIST.map((a) => ({
        id: a.id,
        name: a.name,
        description: a.description,
        params: {
          palette: a.palette,
          floorMaterial: a.floorMaterial,
          lightingRigs: a.lightingRigs,
          defaultLightingRig: a.defaultLightingRig,
          defaultFootprintM2: a.defaultFootprintM2,
          defaultCeilingM: a.defaultCeilingM,
          outdoor: a.outdoor,
          salonCapable: a.salonCapable,
          connector: a.connector,
        },
        sortOrder: a.sortOrder,
      })),
    )
    .onConflictDoNothing();

  seeded = true;
}
