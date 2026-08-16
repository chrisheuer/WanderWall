import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCreator } from "@/lib/auth";
import {
  galleryArtworks,
  galleryByIdForCreator,
  toArtworkView,
} from "@/lib/galleries";
import { editWindowOpen } from "@/lib/tiers";
import { ArtworkGrid } from "@/components/ArtworkGrid";
import { UploadDropzone } from "@/components/studio/UploadDropzone";
import { UrlImport } from "@/components/studio/UrlImport";
import { EditWindowCountdown } from "@/components/studio/EditWindowCountdown";

export const dynamic = "force-dynamic";

export default async function GalleryStudioPage(props: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await props.params;
  const creator = await requireCreator();
  const gallery = await galleryByIdForCreator(id, creator.id);
  if (!gallery) notFound();

  const artworks = await galleryArtworks(gallery.id);
  const views = artworks.map((a) => toArtworkView(a, gallery));
  const statuses = Object.fromEntries(artworks.map((a) => [a.id, a.ingestStatus]));
  const editable =
    gallery.status !== "readonly" &&
    gallery.status !== "frozen" &&
    (gallery.tier !== "download" || editWindowOpen(gallery.editWindowExpiresAt));

  return (
    <main className="container" style={{ padding: "48px 24px" }}>
      <p className="small">
        <Link href="/studio">← Studio</Link>
      </p>
      <h1 style={{ marginTop: 0 }}>{gallery.title}</h1>
      <p className="muted">
        {gallery.tier === "download" ? "Download" : `Tier ${gallery.tier}`} ·{" "}
        <span className="badge">{gallery.status}</span> · {artworks.length} work
        {artworks.length === 1 ? "" : "s"}
      </p>

      {gallery.tier === "download" && gallery.editWindowExpiresAt ? (
        <EditWindowCountdown expiresAt={gallery.editWindowExpiresAt.toISOString()} />
      ) : null}

      {editable ? (
        <section style={{ marginTop: 24, maxWidth: 640 }}>
          <UploadDropzone galleryId={gallery.id} />
          <UrlImport galleryId={gallery.id} />
        </section>
      ) : (
        <p className="notice" style={{ marginTop: 24 }}>
          Editing is locked for this gallery.{" "}
          {gallery.tier === "download"
            ? "The 3-day edit window has closed — your last export stays downloadable, and upgrading to hosting re-enables editing."
            : "Reactivate hosting to edit."}
        </p>
      )}

      <section style={{ marginTop: 40 }}>
        <h2>Works</h2>
        <ArtworkGrid
          artworks={views}
          creatorName={creator.displayName || creator.email}
          showStatus
          statuses={statuses}
        />
      </section>
    </main>
  );
}
