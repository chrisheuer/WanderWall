import { db, tables } from "@/db";
import { ARCHETYPE_LIST } from "@/lib/environments";

/** Seed the environments catalog. Idempotent. Run: npx tsx scripts/seed.ts */
async function main() {
  for (const a of ARCHETYPE_LIST) {
    await db()
      .insert(tables.environments)
      .values({
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
      })
      .onConflictDoUpdate({
        target: tables.environments.id,
        set: { name: a.name, description: a.description, sortOrder: a.sortOrder },
      });
  }
  console.log(`seeded ${ARCHETYPE_LIST.length} environment archetypes`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
