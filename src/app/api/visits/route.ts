import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db, tables } from "@/db";
import { env } from "@/lib/env";
import { galleryBySlug } from "@/lib/galleries";
import { clientIp, rateLimit } from "@/lib/rate-limit";

/**
 * First-party visit beacon. Uniques come from a daily-rotating hash of
 * ip+ua — no raw identifiers are stored.
 */

const visitSchema = z.object({ gallerySlug: z.string().min(1).max(120) });

export async function POST(request: Request) {
  const ip = clientIp(request);
  const limited = rateLimit(`visits:${ip}`, { limit: 60, windowMs: 60_000 });
  if (!limited.ok) return NextResponse.json({ ok: false }, { status: 429 });

  const body = visitSchema.safeParse(await request.json().catch(() => ({})));
  if (!body.success) return NextResponse.json({ ok: false }, { status: 400 });

  const gallery = await galleryBySlug(body.data.gallerySlug);
  if (!gallery || (gallery.status !== "published" && gallery.status !== "unlisted")) {
    return NextResponse.json({ ok: false }, { status: 404 });
  }

  const day = new Date().toISOString().slice(0, 10);
  const ua = request.headers.get("user-agent") ?? "";
  const visitorHash = createHash("sha256")
    .update(`${env().CRON_SECRET}:${day}:${ip}:${ua}`)
    .digest("hex")
    .slice(0, 32);

  const [visit] = await db()
    .insert(tables.galleryVisits)
    .values({ galleryId: gallery.id, visitorHash })
    .returning({ id: tables.galleryVisits.id });

  return NextResponse.json({ visitId: visit.id });
}
