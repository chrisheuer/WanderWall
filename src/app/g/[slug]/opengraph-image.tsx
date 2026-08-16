import { ImageResponse } from "next/og";
import { galleryBySlug, galleryArtworks, derivativeUrl } from "@/lib/galleries";
import { db, tables } from "@/db";
import { eq } from "drizzle-orm";

export const runtime = "nodejs";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "Gallery preview";

/** Auto-rendered OG card: hero derivative + title + creator. */
export default async function OgImage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const gallery = await galleryBySlug(slug);
  const isPublic = gallery && (gallery.status === "published" || gallery.status === "unlisted");

  let heroUrl: string | null = null;
  let creatorName = "";
  if (gallery && isPublic) {
    const artworks = await galleryArtworks(gallery.id);
    const first = artworks.find((a) => a.ingestStatus === "ready");
    heroUrl = derivativeUrl(first?.derivativeKeys?.wall);
    const [creator] = await db()
      .select()
      .from(tables.creators)
      .where(eq(tables.creators.id, gallery.creatorId))
      .limit(1);
    creatorName = creator?.displayName || "";
  }

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          background: "#1c1b18",
          color: "#f6f5f2",
          fontFamily: "Georgia, serif",
        }}
      >
        {heroUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={heroUrl}
            alt=""
            style={{
              width: "55%",
              height: "100%",
              objectFit: "cover",
            }}
          />
        ) : (
          <div style={{ width: "55%", height: "100%", background: "#2c2a25", display: "flex" }} />
        )}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            padding: 48,
            width: "45%",
          }}
        >
          <div style={{ fontSize: 44, lineHeight: 1.15 }}>
            {isPublic && gallery ? gallery.title : "A walkable gallery"}
          </div>
          {creatorName ? (
            <div style={{ fontSize: 24, marginTop: 16, color: "#b8b4a8" }}>by {creatorName}</div>
          ) : null}
          <div style={{ fontSize: 18, marginTop: 40, color: "#8a867c" }}>
            Walk it in your browser · Wanderwall
          </div>
        </div>
      </div>
    ),
    size,
  );
}
