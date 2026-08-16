import { NextResponse } from "next/server";
import { z } from "zod";
import { galleryBySlug } from "@/lib/galleries";
import { createDonationSession } from "@/lib/stripe";
import { clientIp, rateLimit } from "@/lib/rate-limit";

const donateSchema = z.object({
  gallerySlug: z.string().min(1).max(120),
  amountCents: z.number().int().min(100).max(500_000),
  donorName: z.string().max(80).optional(),
  donorMessage: z.string().max(280).optional(),
});

export async function POST(request: Request) {
  const limited = await rateLimit(`donate:${clientIp(request)}`, { limit: 10, windowMs: 60_000 });
  if (!limited.ok) {
    return NextResponse.json(
      { error: "too many attempts; try again shortly" },
      { status: 429, headers: { "retry-after": String(limited.retryAfterSeconds) } },
    );
  }

  const body = donateSchema.safeParse(await request.json().catch(() => ({})));
  if (!body.success) {
    return NextResponse.json({ error: "invalid donation" }, { status: 400 });
  }

  const gallery = await galleryBySlug(body.data.gallerySlug);
  if (!gallery || (gallery.status !== "published" && gallery.status !== "unlisted")) {
    return NextResponse.json({ error: "gallery not found" }, { status: 404 });
  }

  const session = await createDonationSession({
    gallerySlug: gallery.slug,
    galleryId: gallery.id,
    galleryTitle: gallery.title,
    amountCents: body.data.amountCents,
    donorName: body.data.donorName,
    donorMessage: body.data.donorMessage,
  });

  return NextResponse.json({ url: session.url });
}
