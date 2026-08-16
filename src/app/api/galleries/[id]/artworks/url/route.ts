import { NextResponse } from "next/server";
import { z } from "zod";
import { db, tables } from "@/db";
import { currentCreator } from "@/lib/auth";
import {
  EditLockedError,
  PieceCapError,
  assertEditable,
  assertWithinPieceCap,
  galleryByIdForCreator,
} from "@/lib/galleries";
import { enqueue, QUEUES } from "@/lib/queue";
import { clientIp, rateLimit } from "@/lib/rate-limit";

/** Paste URLs: the server fetches and stores a copy — never hotlinks. */

const urlSchema = z.object({
  urls: z.array(z.string().url().max(2000)).min(1).max(20),
});

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const creator = await currentCreator();
  if (!creator) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const limited = await rateLimit(`url-fetch:${clientIp(request)}:${creator.id}`, {
    limit: 30,
    windowMs: 60_000,
  });
  if (!limited.ok) {
    return NextResponse.json(
      { error: "too many URL imports; slow down" },
      { status: 429, headers: { "retry-after": String(limited.retryAfterSeconds) } },
    );
  }

  const { id } = await ctx.params;
  const gallery = await galleryByIdForCreator(id, creator.id);
  if (!gallery) return NextResponse.json({ error: "not found" }, { status: 404 });

  const body = urlSchema.safeParse(await request.json().catch(() => ({})));
  if (!body.success) {
    return NextResponse.json({ error: body.error.flatten() }, { status: 400 });
  }

  try {
    assertEditable(gallery);
    await assertWithinPieceCap(gallery, body.data.urls.length);
  } catch (err) {
    if (err instanceof PieceCapError) {
      return NextResponse.json(
        { error: err.message, needsTierUpgrade: err.upgradable },
        { status: err.upgradable ? 409 : 403 },
      );
    }
    if (err instanceof EditLockedError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    throw err;
  }

  const created = [];
  let skipped = 0;
  for (const url of body.data.urls) {
    // A URL already in this gallery is skipped rather than added twice.
    // The (gallery_id, source_ref) index would otherwise reject the insert
    // outright, turning a re-paste or a double-submit into a 500.
    const [artwork] = await db()
      .insert(tables.artworks)
      .values({
        galleryId: gallery.id,
        title: decodeURIComponent(url.split("/").pop() ?? "Untitled").replace(/\.[a-z0-9]+$/i, ""),
        sourceType: "url",
        sourceRef: url,
        ingestStatus: "pending",
      })
      .onConflictDoNothing()
      .returning();
    if (!artwork) {
      skipped += 1;
      continue;
    }
    await enqueue(QUEUES.urlFetch, { artworkId: artwork.id, url });
    created.push(artwork.id);
  }

  return NextResponse.json({ artworkIds: created, skipped }, { status: 201 });
}
