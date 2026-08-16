import { eq, sql } from "drizzle-orm";
import { db, tables } from "@/db";
import { rateLimit } from "@/lib/rate-limit";
import { enqueueOnce } from "@/lib/notify";

/**
 * Exercises the SQL that only fails at runtime: the rate limiter's
 * conditional upsert, the partial unique indexes, and the notification
 * dedup claim. Requires DATABASE_URL to point at a scratch database —
 * it writes and deletes rows.
 * Run: DATABASE_URL=... npx tsx scripts/check-db.ts
 */

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (ok) {
    console.log(`ok    ${label}`);
    return;
  }
  failures += 1;
  console.error(`FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
}

async function main() {
  const suffix = Math.floor(Date.now() % 1e9);

  // --- rate limiter -------------------------------------------------
  const key = `test:${suffix}`;
  const first = await rateLimit(key, { limit: 3, windowMs: 60_000 });
  check("rate limit allows the first request", first.ok);

  await rateLimit(key, { limit: 3, windowMs: 60_000 });
  await rateLimit(key, { limit: 3, windowMs: 60_000 });
  const overLimit = await rateLimit(key, { limit: 3, windowMs: 60_000 });
  check("rate limit refuses past the limit", !overLimit.ok, "4th request was allowed");
  check(
    "rate limit reports a retry-after",
    overLimit.retryAfterSeconds > 0 && overLimit.retryAfterSeconds <= 60,
    `got ${overLimit.retryAfterSeconds}s`,
  );

  // Expire the window and confirm the counter restarts rather than
  // staying latched — the branch the conditional upsert exists for.
  await db()
    .update(tables.rateLimits)
    .set({ windowStart: sql`now() - interval '2 minutes'` })
    .where(eq(tables.rateLimits.key, key));
  const afterWindow = await rateLimit(key, { limit: 3, windowMs: 60_000 });
  check("rate limit resets after the window elapses", afterWindow.ok, "still blocked");

  const [row] = await db()
    .select()
    .from(tables.rateLimits)
    .where(eq(tables.rateLimits.key, key));
  check("rate limit counter restarted at 1", row?.count === 1, `count = ${row?.count}`);
  await db().delete(tables.rateLimits).where(eq(tables.rateLimits.key, key));

  // --- fixtures for the index tests ---------------------------------
  const [creator] = await db()
    .insert(tables.creators)
    .values({ id: crypto.randomUUID(), email: `test-${suffix}@example.com` })
    .returning();
  await db()
    .insert(tables.environments)
    .values({ id: "white-cube", name: "White Cube" })
    .onConflictDoNothing();
  const [gallery] = await db()
    .insert(tables.galleries)
    .values({ creatorId: creator.id, slug: `t-${suffix}`, title: "Test" })
    .returning();

  // --- artworks (gallery_id, source_ref) partial unique --------------
  const insertArtwork = (sourceRef: string | null) =>
    db()
      .insert(tables.artworks)
      .values({ galleryId: gallery.id, title: "x", sourceRef, sourceType: "url" })
      .onConflictDoNothing()
      .returning();

  const a1 = await insertArtwork("https://example.com/a.jpg");
  const a2 = await insertArtwork("https://example.com/a.jpg");
  check("duplicate source_ref is skipped", a1.length === 1 && a2.length === 0);

  // Uploads carry no source_ref and must never collide with each other.
  const u1 = await insertArtwork(null);
  const u2 = await insertArtwork(null);
  check("null source_ref rows do not collide", u1.length === 1 && u2.length === 1);

  // --- purchases: one creation per gallery ---------------------------
  // Mirrors the webhook: the conflict target is the session id only, so a
  // redelivery is idempotent while a genuinely second creation charge
  // trips the one-per-gallery index instead of being swallowed.
  const buy = (kind: "creation" | "annual_bundle" | "download", session: string) =>
    db()
      .insert(tables.purchases)
      .values({
        creatorId: creator.id,
        galleryId: gallery.id,
        kind,
        amountCents: 2999,
        stripeCheckoutSessionId: session,
      })
      .onConflictDoNothing({ target: tables.purchases.stripeCheckoutSessionId })
      .returning();

  const p1 = await buy("creation", `cs_${suffix}_1`);
  check("first creation purchase is recorded", p1.length === 1);

  // Same session again = redelivery: absorbed silently.
  const replay = await buy("creation", `cs_${suffix}_1`);
  check("redelivery of the same session is idempotent", replay.length === 0);

  // A different session = a second real charge: must be visible.
  let surfaced = false;
  let constraint = "";
  try {
    await buy("creation", `cs_${suffix}_2`);
  } catch (err) {
    constraint = (err as { constraint?: string }).constraint ?? "";
    surfaced = constraint === "purchases_one_creation_per_gallery_idx";
  }
  check(
    "a second creation charge surfaces instead of being swallowed",
    surfaced,
    constraint ? `raised ${constraint}` : "no error was raised — a double charge would go unnoticed",
  );

  const p3 = await buy("download", `cs_${suffix}_3`);
  check("a download purchase is still allowed alongside", p3.length === 1);

  // --- notification dedup --------------------------------------------
  const dedupeKey = `notice:${suffix}`;
  const sent1 = await enqueueOnce(dedupeKey, "send-email", {
    to: "x@example.com",
    subject: "s",
    template: "PurchaseReceiptEmail",
    props: {},
  }).catch(() => null);
  const sent2 = await enqueueOnce(dedupeKey, "send-email", {
    to: "x@example.com",
    subject: "s",
    template: "PurchaseReceiptEmail",
    props: {},
  }).catch(() => null);
  check(
    "a notification is claimed once",
    sent1 === true && sent2 === false,
    `first=${sent1} second=${sent2}`,
  );

  // --- cleanup (children before parents) ------------------------------
  await db().delete(tables.purchases).where(eq(tables.purchases.creatorId, creator.id));
  await db().delete(tables.galleries).where(eq(tables.galleries.id, gallery.id));
  await db().delete(tables.creators).where(eq(tables.creators.id, creator.id));
  await db()
    .delete(tables.notificationLog)
    .where(eq(tables.notificationLog.dedupeKey, dedupeKey));

  if (failures > 0) {
    console.error(`\ndb: ${failures} failing assertions`);
    process.exit(1);
  }
  console.log("\ndb: schema constraints and SQL behave as intended");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
