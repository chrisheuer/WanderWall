import { avg, count, countDistinct, eq, sum } from "drizzle-orm";
import { db, tables } from "@/db";

/** First-party gallery stats — no third-party analytics anywhere. */
export interface GalleryStats {
  visits: number;
  uniques: number;
  avgSeconds: number;
  donationCount: number;
  donationCents: number;
  /** Donations per unique visitor. */
  conversion: number;
}

export async function galleryStats(galleryId: string): Promise<GalleryStats> {
  const [visitRow] = await db()
    .select({
      visits: count(),
      uniques: countDistinct(tables.galleryVisits.visitorHash),
      avgSeconds: avg(tables.galleryVisits.durationSeconds),
    })
    .from(tables.galleryVisits)
    .where(eq(tables.galleryVisits.galleryId, galleryId));

  const [donationRow] = await db()
    .select({
      donationCount: count(),
      donationCents: sum(tables.donations.amountCents),
    })
    .from(tables.donations)
    .where(eq(tables.donations.galleryId, galleryId));

  const visits = Number(visitRow?.visits ?? 0);
  const uniques = Number(visitRow?.uniques ?? 0);
  const donationCount = Number(donationRow?.donationCount ?? 0);

  return {
    visits,
    uniques,
    avgSeconds: Math.round(Number(visitRow?.avgSeconds ?? 0)),
    donationCount,
    donationCents: Number(donationRow?.donationCents ?? 0),
    conversion: uniques > 0 ? donationCount / uniques : 0,
  };
}
