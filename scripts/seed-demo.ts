import { eq } from "drizzle-orm";
import sharp from "sharp";
import { db, tables } from "@/db";
import { env } from "@/lib/env";
import { runIngestJob } from "@/jobs/ingest";
import { storage } from "@/lib/storage";
import { uniqueSlug } from "@/lib/slug";

/**
 * Seed a 120-piece Tier L gallery for the performance acceptance run
 * (~60fps mid-range laptop, ~30fps 3-year-old phone, LCP < 2.5s).
 * Generates gradient placeholder originals and runs the real ingest
 * pipeline inline. Run: npx tsx scripts/seed-demo.ts <creator-email>
 */
async function main() {
  const email = process.argv[2] ?? env().OWNER_EMAIL;
  const [creator] = await db()
    .select()
    .from(tables.creators)
    .where(eq(tables.creators.email, email))
    .limit(1);
  if (!creator) {
    throw new Error(`no creator with email ${email}; sign in once first`);
  }

  const [gallery] = await db()
    .insert(tables.galleries)
    .values({
      creatorId: creator.id,
      slug: uniqueSlug("performance-proof"),
      title: "Performance Proof — 120 pieces",
      statement: "Seeded Tier L gallery for the performance acceptance criteria.",
      tier: "L",
      environmentArchetype: "midtown-modern",
      hangDensity: "standard",
    })
    .returning();

  for (let i = 0; i < 120; i++) {
    const hueA = (i * 137.5) % 360;
    const hueB = (hueA + 40) % 360;
    const landscape = i % 3 !== 0;
    const w = landscape ? 2400 : 1600;
    const h = landscape ? 1600 : 2400;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
      <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="hsl(${hueA},55%,55%)"/>
        <stop offset="1" stop-color="hsl(${hueB},60%,30%)"/>
      </linearGradient></defs>
      <rect width="100%" height="100%" fill="url(#g)"/>
      <circle cx="${w / 2}" cy="${h / 2}" r="${Math.min(w, h) / 5}" fill="hsl(${hueB},30%,85%)"/>
      <text x="${w / 2}" y="${h / 2 + 24}" font-size="120" text-anchor="middle" font-family="Georgia">${i + 1}</text>
    </svg>`;
    const png = await sharp(Buffer.from(svg)).png().toBuffer();

    const [artwork] = await db()
      .insert(tables.artworks)
      .values({
        galleryId: gallery.id,
        title: `Study No. ${i + 1}`,
        caption: i % 7 === 0 ? "From the seeded performance series." : "",
        sortOrder: i,
        sourceType: "upload",
        spotlight: i % 11 === 0,
        hero: i % 40 === 20,
        ingestStatus: "pending",
      })
      .returning();

    const key = `${gallery.id}/${artwork.id}/original`;
    await storage().put(env().STORAGE_ORIGINALS_BUCKET, key, png, {
      contentType: "image/png",
    });
    await db()
      .update(tables.artworks)
      .set({ originalKey: key })
      .where(eq(tables.artworks.id, artwork.id));

    await runIngestJob({ artworkId: artwork.id });
    if ((i + 1) % 10 === 0) console.log(`ingested ${i + 1}/120`);
  }

  console.log(`seeded gallery: /g/${gallery.slug} (preview as its creator)`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
