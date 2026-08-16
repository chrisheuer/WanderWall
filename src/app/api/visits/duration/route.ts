import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db, tables } from "@/db";

const durationSchema = z.object({
  visitId: z.string().uuid(),
  durationSeconds: z.number().int().min(0).max(24 * 3600),
});

export async function POST(request: Request) {
  const body = durationSchema.safeParse(await request.json().catch(() => ({})));
  if (!body.success) return NextResponse.json({ ok: false }, { status: 400 });

  await db()
    .update(tables.galleryVisits)
    .set({ durationSeconds: body.data.durationSeconds })
    .where(eq(tables.galleryVisits.id, body.data.visitId));

  return NextResponse.json({ ok: true });
}
