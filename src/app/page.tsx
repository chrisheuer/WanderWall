import Link from "next/link";

export default function HomePage() {
  return (
    <main className="container" style={{ padding: "72px 24px" }}>
      <h1 style={{ fontSize: 44, lineHeight: 1.15, maxWidth: 640, marginTop: 0 }}>
        A gallery your visitors can walk through.
      </h1>
      <p className="muted" style={{ fontSize: 18, maxWidth: 560 }}>
        Upload 3 to 120 works, choose a space — a white cube, a collector’s house, a stone hall —
        and share a link. Visitors explore in the browser, on desktop or phone, and can support you
        directly.
      </p>
      <p style={{ marginTop: 32 }}>
        <Link href="/studio" className="btn">
          Create your gallery
        </Link>{" "}
        <Link href="/featured" className="btn btn-secondary">
          Walk a featured gallery
        </Link>
      </p>
      <section style={{ marginTop: 72, display: "grid", gap: 24, gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))" }}>
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Rooms that pace your work</h3>
          <p className="muted small">
            Larger collections flow into chaptered rooms — salon walls, courtyards, hero walls —
            with wayfinding and a mini-map.
          </p>
        </div>
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Yours to keep</h3>
          <p className="muted small">
            Unlimited updates while hosted, one-click cancel, and a full static export you can host
            anywhere. No lock-in, ever.
          </p>
        </div>
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Works on everything</h3>
          <p className="muted small">
            Walk with WASD or a thumbstick — or switch to the 2D list view, which needs no WebGL at
            all.
          </p>
        </div>
      </section>
    </main>
  );
}
