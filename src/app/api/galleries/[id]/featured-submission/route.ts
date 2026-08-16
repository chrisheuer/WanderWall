import { desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db, tables } from "@/db";
import { currentCreator } from "@/lib/auth";
import { galleryByIdForCreator } from "@/lib/galleries";

/** Submit a published gallery for featuring (short note → review queue). */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const creator = await currentCreator();
  if (!creator) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const gallery = await galleryByIdForCreator(id, creator.id);
  if (!gallery) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (gallery.status !== "published") {
    return NextResponse.json(
      { error: "only publicly published galleries can be submitted for featuring" },
      { status: 400 },
    );
  }

  const body = z
    .object({ note: z.string().max(600).default("") })
    .safeParse(await request.json().catch(() => ({})));
  if (!body.success) return NextResponse.json({ error: "invalid request" }, { status: 400 });

  const [existing] = await db()
    .select()
    .from(tables.featuredSubmissions)
    .where(eq(tables.featuredSubmissions.galleryId, gallery.id))
    .orderBy(desc(tables.featuredSubmissions.createdAt))
    .limit(1);
  if (existing?.status === "pending") {
    return NextResponse.json({ error: "already under review" }, { status: 409 });
  }

  const [submission] = await db()
    .insert(tables.featuredSubmissions)
    .values({ galleryId: gallery.id, note: body.data.note })
    .returning();

  return NextResponse.json({ submission }, { status: 201 });
}
