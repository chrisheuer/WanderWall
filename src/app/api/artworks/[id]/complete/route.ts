import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db, tables } from "@/db";
import { currentCreator } from "@/lib/auth";
import { galleryByIdForCreator } from "@/lib/galleries";
import { enqueue, QUEUES } from "@/lib/queue";

/** Browser finished its direct-to-storage upload → enter ingest pipeline. */
export async function POST(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const creator = await currentCreator();
  if (!creator) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const [artwork] = await db()
    .select()
    .from(tables.artworks)
    .where(eq(tables.artworks.id, id))
    .limit(1);
  if (!artwork) return NextResponse.json({ error: "not found" }, { status: 404 });

  const gallery = await galleryByIdForCreator(artwork.galleryId, creator.id);
  if (!gallery) return NextResponse.json({ error: "not found" }, { status: 404 });

  await enqueue(QUEUES.ingest, { artworkId: artwork.id });
  return NextResponse.json({ ok: true });
}
