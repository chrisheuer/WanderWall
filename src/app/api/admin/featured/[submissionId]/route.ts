import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db, tables } from "@/db";
import { currentCreator, isOwner } from "@/lib/auth";
import { env } from "@/lib/env";
import { enqueue, QUEUES } from "@/lib/queue";

/** Owner-only review: approve/decline with a Resend notice to the creator. */
export async function POST(request: Request, ctx: { params: Promise<{ submissionId: string }> }) {
  const creator = await currentCreator();
  if (!creator || !isOwner(creator)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { submissionId } = await ctx.params;
  const body = z
    .object({ decision: z.enum(["approved", "declined"]) })
    .safeParse(await request.json().catch(() => ({})));
  if (!body.success) return NextResponse.json({ error: "invalid request" }, { status: 400 });

  const [submission] = await db()
    .select()
    .from(tables.featuredSubmissions)
    .where(eq(tables.featuredSubmissions.id, submissionId))
    .limit(1);
  if (!submission) return NextResponse.json({ error: "not found" }, { status: 404 });

  const [gallery] = await db()
    .select()
    .from(tables.galleries)
    .where(eq(tables.galleries.id, submission.galleryId))
    .limit(1);
  if (!gallery) return NextResponse.json({ error: "gallery gone" }, { status: 404 });
  const [galleryCreator] = await db()
    .select()
    .from(tables.creators)
    .where(eq(tables.creators.id, gallery.creatorId))
    .limit(1);

  const approved = body.data.decision === "approved";
  await db()
    .update(tables.featuredSubmissions)
    .set({ status: body.data.decision, reviewedAt: new Date() })
    .where(eq(tables.featuredSubmissions.id, submission.id));
  await db()
    .update(tables.galleries)
    .set({ featured: approved, updatedAt: new Date() })
    .where(eq(tables.galleries.id, gallery.id));

  if (galleryCreator) {
    await enqueue(QUEUES.sendEmail, {
      to: galleryCreator.email,
      subject: approved
        ? `"${gallery.title}" is now featured`
        : `About your featuring submission for "${gallery.title}"`,
      template: "FeaturedDecisionEmail",
      props: {
        galleryTitle: gallery.title,
        approved,
        featuredUrl: `${env().NEXT_PUBLIC_APP_URL}/featured`,
      },
    });
  }

  return NextResponse.json({ ok: true });
}
