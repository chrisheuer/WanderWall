import { createWriteStream } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import archiver from "archiver";
import { eq } from "drizzle-orm";
import { db, tables } from "@/db";
import { env } from "@/lib/env";
import {
  galleryArtworks,
  galleryRooms,
  toArtworkView,
  type ArtworkView,
} from "@/lib/galleries";
import { buildLayout, roomsToConfig, type HangDensity } from "@/lib/layout";
import { FRAME_STYLES } from "@/lib/frames";
import { LIGHTING_RIGS } from "@/lib/lighting";
import { LICENSES, type License } from "@/lib/licenses";
import { enqueue, QUEUES } from "@/lib/queue";
import { storage } from "@/lib/storage";

/**
 * Queued static export: a zip containing a fully static build — HTML/JS,
 * optimized textures, and the baked layout config — runnable on any
 * static host with no server dependencies. The same layout engine that
 * renders the hosted scene bakes the world here; the bundled vanilla
 * viewer only draws it.
 */

export interface ExportBuildJobData {
  galleryId: string;
  requestedByEmail: string;
}

export async function runExportBuildJob(data: ExportBuildJobData): Promise<void> {
  const [gallery] = await db()
    .select()
    .from(tables.galleries)
    .where(eq(tables.galleries.id, data.galleryId))
    .limit(1);
  if (!gallery) return;
  const [creator] = await db()
    .select()
    .from(tables.creators)
    .where(eq(tables.creators.id, gallery.creatorId))
    .limit(1);
  if (!creator) return;
  const creatorName = creator.displayName || creator.email;

  const rows = (await galleryArtworks(gallery.id)).filter((a) => a.ingestStatus === "ready");
  // Views with storage URLs (for fetching bytes) and relative URLs (baked).
  const storageViews = rows.map((a) => toArtworkView(a, gallery));
  const relativeViews: ArtworkView[] = storageViews.map((v) => ({
    ...v,
    urls: {
      thumb: v.urls.thumb ? `textures/${v.id}/thumb.webp` : null,
      wall: v.urls.wall ? `textures/${v.id}/wall.webp` : null,
      zoom: v.urls.zoom ? `textures/${v.id}/zoom.webp` : null,
    },
  }));

  const dbRooms = await galleryRooms(gallery.id);
  const layout = buildLayout({
    archetypeId: gallery.environmentArchetype,
    hangDensity: gallery.hangDensity as HangDensity,
    lightingDefault: gallery.lightingDefault,
    environmentParams: (gallery.environmentParams ?? {}) as Record<string, unknown>,
    rooms: roomsToConfig(dbRooms, relativeViews),
    artworks: relativeViews,
  });

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: gallery.title,
    description: gallery.statement,
    hasPart: relativeViews.map((art) => {
      const license = LICENSES[(art.license ?? "all-rights-reserved") as License];
      return {
        "@type": "VisualArtwork",
        name: art.title,
        creator: { "@type": "Person", name: creatorName },
        image: art.urls.wall ?? undefined,
        ...(license.schemaUrl ? { license: license.schemaUrl } : {}),
      };
    }),
  };

  const galleryData = {
    title: gallery.title,
    statement: gallery.statement,
    creatorName,
    layout,
    frames: FRAME_STYLES,
    rigs: LIGHTING_RIGS,
  };

  const templateDir = path.join(process.cwd(), "src", "export-template");
  const [indexTemplate, viewerJs] = await Promise.all([
    readFile(path.join(templateDir, "index.html"), "utf8"),
    readFile(path.join(templateDir, "viewer.js"), "utf8"),
  ]);
  const threeModule = await readThreeModule();

  const noscriptGrid = `<div class="grid">${relativeViews
    .map(
      (a) =>
        `<figure><img src="${a.urls.wall ?? ""}" alt="${escapeHtml(a.title)}" loading="lazy" />` +
        `<figcaption>${escapeHtml(a.title)}</figcaption></figure>`,
    )
    .join("")}</div>`;

  const indexHtml = indexTemplate
    .replaceAll("__TITLE__", escapeHtml(gallery.title))
    .replaceAll("__CREATOR__", escapeHtml(creatorName))
    .replace("__DESCRIPTION__", escapeHtml(gallery.statement.slice(0, 160)))
    .replace(
      "__STATEMENT_HTML__",
      gallery.statement ? `<p>${escapeHtml(gallery.statement)}</p>` : "",
    )
    .replace("__JSON_LD__", JSON.stringify(jsonLd).replace(/</g, "\\u003c"))
    .replace(
      "__DONATE_LINK__",
      gallery.exportDonationUrl
        ? `<a id="donate" href="${escapeHtml(gallery.exportDonationUrl)}" target="_blank" rel="noopener">♥ Support the artist</a>`
        : "",
    )
    .replace("__NOSCRIPT_GRID__", noscriptGrid)
    .replace(
      "__FOOTER_NOTE__",
      `© ${escapeHtml(creatorName)}. This gallery belongs to its creator. ` +
        `<a href="${env().NEXT_PUBLIC_APP_URL}" rel="noopener">Made with Wanderwall</a> ` +
        `<!-- This footer link may be removed; the export is yours. -->`,
    )
    .replace("__GALLERY_DATA__", JSON.stringify(galleryData).replace(/</g, "\\u003c"));

  const readme = buildReadme(gallery.title, Boolean(gallery.exportDonationUrl));

  // Assemble the zip in a temp dir, then upload to the private exports bucket.
  const workDir = await mkdtemp(path.join(tmpdir(), "wanderwall-export-"));
  const zipPath = path.join(workDir, "gallery.zip");
  try {
    await new Promise<void>((resolve, reject) => {
      const output = createWriteStream(zipPath);
      const archive = archiver("zip", { zlib: { level: 9 } });
      output.on("close", () => resolve());
      archive.on("error", reject);
      archive.pipe(output);

      archive.append(indexHtml, { name: "index.html" });
      archive.append(viewerJs, { name: "viewer.js" });
      archive.append(threeModule, { name: "three.module.min.js" });
      archive.append(readme, { name: "README.md" });

      void (async () => {
        for (let i = 0; i < rows.length; i++) {
          const row = rows[i];
          const keys = row.derivativeKeys ?? {};
          for (const size of ["thumb", "wall", "zoom"] as const) {
            const key = keys[size];
            if (!key) continue;
            const bytes = await storage().get(env().STORAGE_DERIVATIVES_BUCKET, key);
            archive.append(bytes, { name: `textures/${row.id}/${size}.webp` });
          }
        }
        await archive.finalize();
      })().catch(reject);
    });

    const exportKey = `${gallery.id}/${Date.now()}.zip`;
    const zipBytes = await readFile(zipPath);
    await storage().put(env().STORAGE_EXPORTS_BUCKET, exportKey, zipBytes, {
      contentType: "application/zip",
    });

    await db()
      .update(tables.galleries)
      .set({ lastExportKey: exportKey, lastExportAt: new Date(), updatedAt: new Date() })
      .where(eq(tables.galleries.id, gallery.id));

    const downloadUrl = await storage().signedUrl(
      env().STORAGE_EXPORTS_BUCKET,
      exportKey,
      7 * 24 * 3600,
    );
    await enqueue(QUEUES.sendEmail, {
      to: data.requestedByEmail,
      subject: `Your export of "${gallery.title}" is ready`,
      template: "ExportReadyEmail",
      props: { galleryTitle: gallery.title, downloadUrl },
    });
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function readThreeModule(): Promise<string> {
  const candidates = [
    path.join(process.cwd(), "node_modules", "three", "build", "three.module.min.js"),
    path.join(process.cwd(), "node_modules", "three", "build", "three.module.js"),
  ];
  for (const candidate of candidates) {
    try {
      return await readFile(candidate, "utf8");
    } catch {
      // try next
    }
  }
  throw new Error("three.js module build not found for export bundling");
}

function buildReadme(title: string, hasDonate: boolean): string {
  return `# ${title} — static gallery export

This folder is a complete, self-contained build of your gallery. It is
yours: host it anywhere, modify it, keep it forever.

## Hosting it

Any static host works — no server, database, or build step required:

- **Netlify / Vercel / Cloudflare Pages**: drag the unzipped folder into
  their dashboard (or point a project at it).
- **GitHub Pages**: push the folder to a repository and enable Pages.
- **Your own server**: copy the folder to any web root (nginx, Apache,
  S3 + CDN, …).

Then open \`index.html\` from the served URL. Opening the file directly
from disk also works in most browsers for the 2D list; some browsers
restrict module scripts on file:// URLs, so use any local static server
(e.g. \`npx serve .\`) to test the walkable view.

## What's inside

- \`index.html\` — the gallery page (walkable 3D + 2D list view, license
  badges, schema.org metadata)
- \`viewer.js\` + \`three.module.min.js\` — the self-contained viewer
- \`textures/\` — optimized WebP derivatives of your works
${hasDonate ? "- The donate button links to the Stripe Payment Link you configured.\n" : ""}
The "Made with Wanderwall" footer link is a courtesy and may be removed —
this export belongs to you.
`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
