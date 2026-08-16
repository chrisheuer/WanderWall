import type { ArtworkView } from "@/lib/galleries";
import { LICENSES, type License } from "@/lib/licenses";

/**
 * The 2D grid: skeleton proof in phase 1, and later the public "List view"
 * fallback that works without WebGL.
 */
export function ArtworkGrid({
  artworks,
  creatorName,
  showStatus,
  statuses,
}: {
  artworks: ArtworkView[];
  creatorName: string;
  showStatus?: boolean;
  statuses?: Record<string, string>;
}) {
  if (artworks.length === 0) {
    return <p className="muted">No works yet.</p>;
  }
  return (
    <div className="grid-2d">
      {artworks.map((a) => {
        const license = LICENSES[(a.license ?? "all-rights-reserved") as License];
        return (
          <figure key={a.id} id={`artwork-${a.id}`}>
            {a.urls.wall ? (
              <img
                src={a.urls.wall}
                alt={a.title}
                loading="lazy"
                width={a.widthPx ?? undefined}
                height={a.heightPx ?? undefined}
              />
            ) : (
              <div
                style={{
                  aspectRatio: "4 / 3",
                  background: "var(--line)",
                  display: "grid",
                  placeItems: "center",
                  fontSize: 13,
                  color: "var(--ink-soft)",
                }}
              >
                {showStatus ? (statuses?.[a.id] ?? "processing…") : "processing…"}
              </div>
            )}
            <figcaption>
              <strong>{a.title}</strong>
              {a.caption ? <div className="muted small">{a.caption}</div> : null}
              <div style={{ marginTop: 4 }}>
                {license.deedUrl ? (
                  <a
                    className="badge"
                    href={license.deedUrl}
                    target="_blank"
                    rel="license noopener noreferrer"
                  >
                    {license.badge}
                  </a>
                ) : (
                  <span className="badge">© {creatorName}</span>
                )}
              </div>
            </figcaption>
          </figure>
        );
      })}
    </div>
  );
}
