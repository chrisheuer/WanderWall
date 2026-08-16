import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { db, tables } from "@/db";
import { requireCreator } from "@/lib/auth";
import { hostingActive, latestSubscription } from "@/lib/billing";
import {
  derivativeUrl,
  galleryArtworks,
  galleryByIdForCreator,
} from "@/lib/galleries";
import { BillingPanel } from "@/components/studio/BillingPanel";
import { CloudImportPanel } from "@/components/studio/CloudImportPanel";
import { ExportPanel } from "@/components/studio/ExportPanel";
import { EnvironmentTools } from "@/components/studio/EnvironmentTools";
import { FeatureSubmitButton } from "@/components/studio/FeatureSubmitButton";
import { galleryStats } from "@/lib/analytics";
import { isConnected } from "@/lib/cloud-imports";
import { editWindowOpen } from "@/lib/tiers";
import { UploadDropzone } from "@/components/studio/UploadDropzone";
import { UrlImport } from "@/components/studio/UrlImport";
import { EditWindowCountdown } from "@/components/studio/EditWindowCountdown";
import { GallerySettingsForm } from "@/components/studio/GallerySettingsForm";
import { PublishPanel } from "@/components/studio/PublishPanel";
import { RoomManagerPanel, type RoomRow } from "@/components/studio/RoomManagerPanel";
import { WorksManager, type WorkRow } from "@/components/studio/WorksManager";

export const dynamic = "force-dynamic";

export default async function GalleryStudioPage(props: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await props.params;
  const creator = await requireCreator();
  const gallery = await galleryByIdForCreator(id, creator.id);
  if (!gallery) notFound();

  const artworks = await galleryArtworks(gallery.id);
  const [isHosted, subscription, gdriveConnected, dropboxConnected, stats] = await Promise.all([
    hostingActive(gallery.id),
    latestSubscription(gallery.id),
    isConnected(creator.id, "gdrive"),
    isConnected(creator.id, "dropbox"),
    galleryStats(gallery.id),
  ]);
  const seededSwatches =
    ((gallery.environmentParams as Record<string, unknown> | null)?.seededPalette as
      | { swatches?: string[] }
      | undefined)?.swatches ?? [];
  const dbRooms = await db()
    .select()
    .from(tables.rooms)
    .where(eq(tables.rooms.galleryId, gallery.id))
    .orderBy(asc(tables.rooms.sortOrder));

  const editable =
    gallery.status !== "readonly" &&
    gallery.status !== "frozen" &&
    (gallery.tier !== "download" || editWindowOpen(gallery.editWindowExpiresAt));

  const workRows: WorkRow[] = artworks.map((a) => ({
    id: a.id,
    title: a.title,
    caption: a.caption,
    thumbUrl: derivativeUrl(a.derivativeKeys?.thumb),
    ingestStatus: a.ingestStatus,
    ingestError: a.ingestError,
    roomId: a.roomId,
    sortOrder: a.sortOrder,
    frameStyleOverride: a.frameStyleOverride,
    licenseOverride: a.licenseOverride,
    spotlight: a.spotlight,
    hero: a.hero,
  }));

  const roomRows: RoomRow[] = dbRooms.map((r) => ({
    id: r.id,
    name: r.name,
    chapterLabel: r.chapterLabel,
    archetype: r.archetype,
    lightingRig: r.lightingRig,
    kind: r.kind,
    sortOrder: r.sortOrder,
    pieceCount: artworks.filter((a) => a.roomId === r.id).length,
  }));

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

      <section style={{ marginTop: 32 }}>
        <h2>Billing</h2>
        <BillingPanel
          galleryId={gallery.id}
          tier={gallery.tier}
          status={gallery.status}
          hostingActive={isHosted}
          pieceCount={artworks.length}
          cancelAtPeriodEnd={subscription?.cancelAtPeriodEnd ?? false}
          currentPeriodEnd={subscription?.currentPeriodEnd?.toISOString() ?? null}
        />
      </section>

      <section style={{ marginTop: 32 }}>
        <h2>Publish</h2>
        <PublishPanel
          galleryId={gallery.id}
          gallerySlug={gallery.slug}
          status={gallery.status}
          tier={gallery.tier}
          attested={Boolean(gallery.ownershipAttestedAt)}
        />
      </section>

      <section style={{ marginTop: 32 }}>
        <h2>Settings</h2>
        <GallerySettingsForm
          gallery={{
            id: gallery.id,
            title: gallery.title,
            statement: gallery.statement,
            environmentArchetype: gallery.environmentArchetype,
            hangDensity: gallery.hangDensity,
            frameStyleDefault: gallery.frameStyleDefault,
            lightingDefault: gallery.lightingDefault,
            licenseDefault: gallery.licenseDefault,
          }}
        />
        <EnvironmentTools galleryId={gallery.id} seededSwatches={seededSwatches} />
      </section>

      <section style={{ marginTop: 32 }}>
        <h2>Visitors &amp; donations</h2>
        <div className="card" style={{ maxWidth: 640 }}>
          <table className="plain">
            <tbody>
              <tr>
                <td>Visits</td>
                <td>{stats.visits}</td>
              </tr>
              <tr>
                <td>Unique visitors</td>
                <td>{stats.uniques}</td>
              </tr>
              <tr>
                <td>Average time</td>
                <td>
                  {Math.floor(stats.avgSeconds / 60)}m {stats.avgSeconds % 60}s
                </td>
              </tr>
              <tr>
                <td>Donations</td>
                <td>
                  {stats.donationCount} (${(stats.donationCents / 100).toFixed(2)})
                </td>
              </tr>
              <tr>
                <td>Donation conversion</td>
                <td>{(stats.conversion * 100).toFixed(1)}% of uniques</td>
              </tr>
            </tbody>
          </table>
          <p className="muted small" style={{ marginBottom: 0 }}>
            First-party analytics only — no third-party trackers.
          </p>
        </div>
        {gallery.status === "published" && !gallery.featured ? (
          <FeatureSubmitButton galleryId={gallery.id} />
        ) : null}
        {gallery.featured ? <p className="notice">This gallery is featured. ✦</p> : null}
      </section>

      {editable ? (
        <section style={{ marginTop: 32, maxWidth: 640 }}>
          <h2>Add works</h2>
          <UploadDropzone galleryId={gallery.id} />
          <UrlImport galleryId={gallery.id} />
          <CloudImportPanel
            galleryId={gallery.id}
            gdriveConnected={gdriveConnected}
            dropboxConnected={dropboxConnected}
          />
        </section>
      ) : (
        <p className="notice" style={{ marginTop: 24 }}>
          Editing is locked for this gallery.{" "}
          {gallery.tier === "download"
            ? "The 3-day edit window has closed — your last export stays downloadable, and upgrading to hosting re-enables editing."
            : "Reactivate hosting to edit."}
        </p>
      )}

      <section style={{ marginTop: 32 }}>
        <h2>Export</h2>
        <ExportPanel
          galleryId={gallery.id}
          lastExportAt={gallery.lastExportAt?.toISOString() ?? null}
          exportDonationUrl={gallery.exportDonationUrl}
        />
      </section>

      <section style={{ marginTop: 32 }}>
        <h2>Rooms</h2>
        <RoomManagerPanel galleryId={gallery.id} rooms={roomRows} editable={editable} />
      </section>

      <section style={{ marginTop: 32 }}>
        <h2>Works</h2>
        <WorksManager
          works={workRows}
          rooms={roomRows.map((r) => ({
            id: r.id,
            label: r.name ?? `${r.kind} ${r.sortOrder + 1}`,
          }))}
          editable={editable}
        />
      </section>
    </main>
  );
}
