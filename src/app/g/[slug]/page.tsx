import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { currentCreator } from "@/lib/auth";
import { galleryBySlug } from "@/lib/galleries";
import { loadGalleryWorld } from "@/lib/layout-server";
import { LICENSES, type License } from "@/lib/licenses";
import { env } from "@/lib/env";
import { GalleryViewerLazy } from "@/components/GalleryViewerLazy";
import { DonateButton } from "@/components/DonateButton";
import { VisitPing } from "@/components/VisitPing";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ a?: string }>;
};

export async function generateMetadata(props: Props): Promise<Metadata> {
  const { slug } = await props.params;
  const gallery = await galleryBySlug(slug);
  if (!gallery || (gallery.status !== "published" && gallery.status !== "unlisted")) {
    return { title: "Gallery not found" };
  }
  return {
    title: gallery.title,
    description: gallery.statement.slice(0, 160) || `A walkable gallery: ${gallery.title}`,
    robots: gallery.status === "unlisted" ? { index: false, follow: false } : undefined,
    openGraph: {
      title: gallery.title,
      description: gallery.statement.slice(0, 200),
      type: "website",
      url: `${env().NEXT_PUBLIC_APP_URL}/g/${gallery.slug}`,
    },
  };
}

export default async function PublicGalleryPage(props: Props) {
  const { slug } = await props.params;
  const { a: deepLink } = await props.searchParams;
  const gallery = await galleryBySlug(slug);
  if (!gallery) notFound();

  const isPublic = gallery.status === "published" || gallery.status === "unlisted";
  if (!isPublic) {
    // Draft/frozen/readonly galleries are visible only to their creator.
    const creator = await currentCreator();
    if (!creator || creator.id !== gallery.creatorId) notFound();
  }

  const { layout, artworks, creatorName } = await loadGalleryWorld(gallery);

  // Machine-readable licensing: schema.org JSON-LD per artwork.
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: gallery.title,
    description: gallery.statement,
    url: `${env().NEXT_PUBLIC_APP_URL}/g/${gallery.slug}`,
    hasPart: artworks.map((art) => {
      const license = LICENSES[(art.license ?? "all-rights-reserved") as License];
      return {
        "@type": "VisualArtwork",
        name: art.title,
        description: art.caption || undefined,
        creator: { "@type": "Person", name: creatorName },
        image: art.urls.wall ?? undefined,
        ...(license.schemaUrl ? { license: license.schemaUrl } : {}),
      };
    }),
  };

  return (
    <main className="container" style={{ padding: "24px 24px 64px" }}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <header style={{ margin: "16px 0 20px", maxWidth: 720 }}>
        <h1 style={{ margin: 0, fontSize: 34 }}>{gallery.title}</h1>
        <p className="muted" style={{ margin: "6px 0 0" }}>
          by {creatorName}
        </p>
        {gallery.statement ? (
          <p style={{ marginTop: 12, fontSize: 16 }}>{gallery.statement}</p>
        ) : null}
        {!isPublic ? (
          <p className="notice">
            Private preview — only you can see this. Status: {gallery.status}.
          </p>
        ) : null}
      </header>

      <GalleryViewerLazy
        layout={layout}
        artworks={artworks}
        creatorName={creatorName}
        initialFocusId={deepLink ?? null}
        // Thumb, not wall: the poster exists to paint something fast
        // before the scene bundle arrives, so it must not be the heaviest
        // image on the page.
        posterUrl={artworks[0]?.urls.thumb ?? artworks[0]?.urls.wall ?? null}
      >
        <DonateButton gallerySlug={gallery.slug} galleryTitle={gallery.title} />
      </GalleryViewerLazy>

      {isPublic ? <VisitPing gallerySlug={gallery.slug} /> : null}
    </main>
  );
}
