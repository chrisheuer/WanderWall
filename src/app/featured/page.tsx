import type { Metadata } from "next";
import Link from "next/link";
import { and, asc, eq } from "drizzle-orm";
import { db, tables } from "@/db";
import { derivativeUrl } from "@/lib/galleries";

export const metadata: Metadata = {
  title: "Featured galleries",
  description: "A curated index of walkable galleries.",
};

export const dynamic = "force-dynamic";

/**
 * The curated index — built as a generic highlighted-galleries list, the
 * future discovery surface.
 */
export default async function FeaturedPage() {
  const rows = await db()
    .select({ gallery: tables.galleries, creator: tables.creators })
    .from(tables.galleries)
    .innerJoin(tables.creators, eq(tables.galleries.creatorId, tables.creators.id))
    .where(and(eq(tables.galleries.featured, true), eq(tables.galleries.status, "published")))
    .orderBy(asc(tables.galleries.createdAt));

  const withHeroes = await Promise.all(
    rows.map(async ({ gallery, creator }) => {
      const [hero] = await db()
        .select()
        .from(tables.artworks)
        .where(eq(tables.artworks.galleryId, gallery.id))
        .orderBy(asc(tables.artworks.sortOrder))
        .limit(1);
      return {
        gallery,
        creator,
        heroUrl: derivativeUrl(hero?.derivativeKeys?.wall),
      };
    }),
  );

  return (
    <main className="container" style={{ padding: "48px 24px" }}>
      <h1 style={{ marginTop: 0 }}>Featured galleries</h1>
      <p className="muted" style={{ maxWidth: 560 }}>
        Walk through spaces other creators have built.
      </p>
      {withHeroes.length === 0 ? (
        <p className="muted">Nothing featured yet — check back soon.</p>
      ) : (
        <div className="grid-2d" style={{ marginTop: 24 }}>
          {withHeroes.map(({ gallery, creator, heroUrl }) => (
            <figure key={gallery.id}>
              <Link href={`/g/${gallery.slug}`}>
                {heroUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={heroUrl} alt={gallery.title} loading="lazy" />
                ) : (
                  <div style={{ aspectRatio: "4/3", background: "var(--line)" }} />
                )}
              </Link>
              <figcaption>
                <strong>
                  <Link href={`/g/${gallery.slug}`} style={{ textDecoration: "none" }}>
                    {gallery.title}
                  </Link>
                </strong>
                <div className="muted small">by {creator.displayName || creator.email}</div>
              </figcaption>
            </figure>
          ))}
        </div>
      )}
    </main>
  );
}
