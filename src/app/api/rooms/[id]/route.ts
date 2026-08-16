import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db, tables } from "@/db";
import { currentCreator } from "@/lib/auth";
import { EditLockedError, assertEditable, galleryByIdForCreator } from "@/lib/galleries";

const patchSchema = z.object({
  name: z.string().max(80).nullable().optional(),
  chapterLabel: z.string().max(120).nullable().optional(),
  archetype: z.string().max(60).optional(),
  wallColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  floorMaterial: z.string().max(40).optional(),
  lightingRig: z.string().max(60).optional(),
  footprintM2: z.number().min(12).max(400).optional(),
  ceilingM: z.number().min(2.4).max(14).optional(),
  sortOrder: z.number().int().min(0).optional(),
  kind: z.enum(["room", "corridor", "courtyard"]).optional(),
});

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const creator = await currentCreator();
  if (!creator) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const [room] = await db().select().from(tables.rooms).where(eq(tables.rooms.id, id)).limit(1);
  if (!room) return NextResponse.json({ error: "not found" }, { status: 404 });

  const gallery = await galleryByIdForCreator(room.galleryId, creator.id);
  if (!gallery) return NextResponse.json({ error: "not found" }, { status: 404 });

  const body = patchSchema.safeParse(await request.json().catch(() => ({})));
  if (!body.success) {
    return NextResponse.json({ error: body.error.flatten() }, { status: 400 });
  }

  try {
    assertEditable(gallery);
  } catch (err) {
    if (err instanceof EditLockedError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    throw err;
  }

  const [updated] = await db()
    .update(tables.rooms)
    .set(body.data)
    .where(eq(tables.rooms.id, room.id))
    .returning();
  return NextResponse.json({ room: updated });
}
