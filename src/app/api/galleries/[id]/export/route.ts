import { NextResponse } from "next/server";
import { currentCreator } from "@/lib/auth";
import { hasDownloadPurchase, hostingActive } from "@/lib/billing";
import { galleryByIdForCreator } from "@/lib/galleries";
import { enqueue, QUEUES } from "@/lib/queue";
import { editWindowOpen } from "@/lib/tiers";

/**
 * Queue a static export build. Available to every hosted creator; the
 * download tier requires purchase and respects the 3-day edit window
 * (the last export stays downloadable after it closes).
 */
export async function POST(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const creator = await currentCreator();
  if (!creator) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const gallery = await galleryByIdForCreator(id, creator.id);
  if (!gallery) return NextResponse.json({ error: "not found" }, { status: 404 });

  if (gallery.tier === "download") {
    if (!(await hasDownloadPurchase(gallery.id))) {
      return NextResponse.json(
        { error: "purchase the download to build your export", needsPayment: true },
        { status: 402 },
      );
    }
    if (!editWindowOpen(gallery.editWindowExpiresAt)) {
      return NextResponse.json(
        {
          error:
            "the 3-day edit window has closed — your most recent export remains downloadable, and upgrading to hosting re-enables editing and re-export",
        },
        { status: 403 },
      );
    }
  } else {
    // Hosted galleries export freely — including frozen ones ("you can
    // always take your gallery with you"). Unpaid drafts need payment.
    const [hosted, downloadPaid] = await Promise.all([
      hostingActive(gallery.id),
      hasDownloadPurchase(gallery.id),
    ]);
    if (!hosted && !downloadPaid && gallery.status === "draft") {
      return NextResponse.json(
        { error: "exporting needs an active plan or a download purchase", needsPayment: true },
        { status: 402 },
      );
    }
  }

  await enqueue(
    QUEUES.exportBuild,
    { galleryId: gallery.id, requestedByEmail: creator.email },
    { singletonKey: `export:${gallery.id}` },
  );
  return NextResponse.json({ queued: true }, { status: 202 });
}
