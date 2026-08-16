import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCreator } from "@/lib/auth";
import { galleryArtworks, galleryByIdForCreator } from "@/lib/galleries";
import { TIER_CAPS } from "@/lib/tiers";
import { PlanPicker } from "@/components/studio/PlanPicker";

export const dynamic = "force-dynamic";

export default async function CheckoutPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const creator = await requireCreator();
  const gallery = await galleryByIdForCreator(id, creator.id);
  if (!gallery) notFound();

  const pieceCount = (await galleryArtworks(gallery.id)).length;
  const needsL = pieceCount > TIER_CAPS.S;

  return (
    <main className="container" style={{ padding: "48px 24px", maxWidth: 760 }}>
      <p className="small">
        <Link href={`/studio/galleries/${gallery.id}`}>← Back to “{gallery.title}”</Link>
      </p>
      <h1 style={{ marginTop: 0 }}>Choose how to share this gallery</h1>
      <p className="muted">
        {pieceCount} piece{pieceCount === 1 ? "" : "s"} —{" "}
        {needsL
          ? `over ${TIER_CAPS.S}, so hosting needs Tier L`
          : `fits Tier S (up to ${TIER_CAPS.S})`}
        . Promotion codes can be entered at checkout.
      </p>
      <PlanPicker galleryId={gallery.id} needsL={needsL} />
      <p className="muted small" style={{ marginTop: 24 }}>
        Plain terms: hosting renews until you cancel, and cancelling takes one click — no
        retention hoops. We email you 30 and 7 days before an annual renewal. If hosting ends,
        your gallery freezes but is never deleted: export it or reactivate any time. The
        download option includes a 3-day window to edit and re-export; after that your latest
        export remains downloadable forever.
      </p>
    </main>
  );
}
