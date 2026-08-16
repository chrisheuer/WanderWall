import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db, tables } from "@/db";
import { currentCreator } from "@/lib/auth";
import { publishGate } from "@/lib/billing";
import {
  PieceCapError,
  assertWithinPieceCap,
  galleryArtworks,
  galleryByIdForCreator,
} from "@/lib/galleries";
import { MIN_PIECES } from "@/lib/tiers";

const publishSchema = z.object({
  mode: z.enum(["published", "unlisted", "draft"]),
  /** Content-ownership attestation is required to go live. */
  attestOwnership: z.boolean().optional(),
});

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const creator = await currentCreator();
  if (!creator) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const gallery = await galleryByIdForCreator(id, creator.id);
  if (!gallery) return NextResponse.json({ error: "not found" }, { status: 404 });

  const body = publishSchema.safeParse(await request.json().catch(() => ({})));
  if (!body.success) {
    return NextResponse.json({ error: body.error.flatten() }, { status: 400 });
  }

  // Unpublishing back to draft is always allowed.
  if (body.data.mode === "draft") {
    const [updated] = await db()
      .update(tables.galleries)
      .set({ status: "draft", updatedAt: new Date() })
      .where(eq(tables.galleries.id, gallery.id))
      .returning();
    return NextResponse.json({ gallery: updated });
  }

  if (gallery.status === "frozen" || gallery.status === "readonly") {
    return NextResponse.json(
      { error: "reactivate hosting before publishing again" },
      { status: 403 },
    );
  }

  if (!body.data.attestOwnership && !gallery.ownershipAttestedAt) {
    return NextResponse.json(
      { error: "please confirm you own or have rights to publish these works" },
      { status: 400 },
    );
  }

  const works = (await galleryArtworks(gallery.id)).filter((a) => a.ingestStatus === "ready");
  if (works.length < MIN_PIECES) {
    return NextResponse.json(
      { error: `a gallery needs at least ${MIN_PIECES} finished pieces to publish` },
      { status: 400 },
    );
  }
  try {
    await assertWithinPieceCap(gallery);
  } catch (err) {
    if (err instanceof PieceCapError) {
      return NextResponse.json(
        { error: err.message, needsTierUpgrade: err.upgradable },
        { status: err.upgradable ? 409 : 403 },
      );
    }
    throw err;
  }

  const gate = await publishGate(gallery);
  if (!gate.allowed) {
    return NextResponse.json(
      {
        error:
          gate.reason === "download-tier"
            ? "download galleries aren't hosted — export instead, or upgrade to hosting"
            : "publishing requires payment",
        needsPayment: gate.reason === "needs-payment",
      },
      { status: 402 },
    );
  }

  const [updated] = await db()
    .update(tables.galleries)
    .set({
      status: body.data.mode,
      ownershipAttestedAt: gallery.ownershipAttestedAt ?? new Date(),
      updatedAt: new Date(),
    })
    .where(eq(tables.galleries.id, gallery.id))
    .returning();

  return NextResponse.json({ gallery: updated });
}
