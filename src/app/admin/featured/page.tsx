import { desc, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db, tables } from "@/db";
import { currentCreator, isOwner } from "@/lib/auth";
import { FeaturedReviewList } from "@/components/admin/FeaturedReviewList";

export const dynamic = "force-dynamic";

/** Owner-only featured-submission review queue. */
export default async function AdminFeaturedPage() {
  const creator = await currentCreator();
  if (!creator || !isOwner(creator)) notFound();

  const submissions = await db()
    .select({ submission: tables.featuredSubmissions, gallery: tables.galleries })
    .from(tables.featuredSubmissions)
    .innerJoin(tables.galleries, eq(tables.featuredSubmissions.galleryId, tables.galleries.id))
    .orderBy(desc(tables.featuredSubmissions.createdAt))
    .limit(50);

  return (
    <main className="container" style={{ padding: "48px 24px" }}>
      <h1 style={{ marginTop: 0 }}>Featured review</h1>
      <FeaturedReviewList
        items={submissions.map(({ submission, gallery }) => ({
          id: submission.id,
          status: submission.status,
          note: submission.note,
          createdAt: submission.createdAt.toISOString(),
          galleryTitle: gallery.title,
          gallerySlug: gallery.slug,
        }))}
      />
    </main>
  );
}
