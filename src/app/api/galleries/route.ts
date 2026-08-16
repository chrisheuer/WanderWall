import { NextResponse } from "next/server";
import { z } from "zod";
import { db, tables } from "@/db";
import { currentCreator } from "@/lib/auth";
import { ensureEnvironmentsSeeded } from "@/lib/environments-seed";
import { uniqueSlug } from "@/lib/slug";

const createSchema = z.object({
  title: z.string().min(1).max(120),
  tier: z.enum(["S", "L", "download"]).default("S"),
  environmentArchetype: z.string().default("white-cube"),
});

export async function POST(request: Request) {
  const creator = await currentCreator();
  if (!creator) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = createSchema.safeParse(await request.json().catch(() => ({})));
  if (!body.success) {
    return NextResponse.json({ error: body.error.flatten() }, { status: 400 });
  }

  // environment_archetype is a foreign key, so a project whose seed script
  // has not been run would fail here with an opaque constraint error.
  await ensureEnvironmentsSeeded();

  const [gallery] = await db()
    .insert(tables.galleries)
    .values({
      creatorId: creator.id,
      slug: uniqueSlug(body.data.title),
      title: body.data.title,
      tier: body.data.tier,
      environmentArchetype: body.data.environmentArchetype,
    })
    .returning();

  return NextResponse.json({ gallery }, { status: 201 });
}
