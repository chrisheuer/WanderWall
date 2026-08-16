import { NextResponse } from "next/server";
import { z } from "zod";
import { currentCreator } from "@/lib/auth";
import { galleryByIdForCreator } from "@/lib/galleries";
import { createPortalSession, ensureStripeCustomer } from "@/lib/stripe";

/** One-click cancel lives in the Stripe Customer Portal — no retention flows. */
export async function POST(request: Request) {
  const creator = await currentCreator();
  if (!creator) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = z
    .object({ galleryId: z.string().uuid() })
    .safeParse(await request.json().catch(() => ({})));
  if (!body.success) return NextResponse.json({ error: "invalid request" }, { status: 400 });

  const gallery = await galleryByIdForCreator(body.data.galleryId, creator.id);
  if (!gallery) return NextResponse.json({ error: "not found" }, { status: 404 });

  const customerId = await ensureStripeCustomer(creator);
  const session = await createPortalSession(customerId, gallery.id);
  return NextResponse.json({ url: session.url });
}
