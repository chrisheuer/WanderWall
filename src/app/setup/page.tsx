import type { Metadata } from "next";
import { supabaseConfigStatus } from "@/lib/supabase/config";

export const metadata: Metadata = { title: "Setup required" };
export const dynamic = "force-dynamic";

/**
 * Shown instead of a stack trace when Supabase is not configured. Signing
 * in, the Studio, and uploads all depend on it, so a first run without it
 * should say so plainly rather than 500.
 */
export default function SetupPage() {
  const { configured, missing } = supabaseConfigStatus();

  if (configured) {
    return (
      <main className="container" style={{ padding: "56px 24px", maxWidth: 640 }}>
        <h1>Setup looks complete</h1>
        <p className="muted">
          Supabase is configured. <a href="/studio">Open the Studio</a>.
        </p>
      </main>
    );
  }

  return (
    <main className="container" style={{ padding: "56px 24px", maxWidth: 720 }}>
      <h1 style={{ marginTop: 0 }}>Setup required</h1>
      <p className="muted">
        Signing in, the Studio, and photo uploads need Supabase. The public pages work
        without it, which is why the rest of the site loaded.
      </p>

      <div className="card" style={{ marginTop: 24 }}>
        <h2 style={{ marginTop: 0, fontSize: 18 }}>Missing environment variables</h2>
        <ul style={{ lineHeight: 1.8, fontFamily: "ui-monospace, monospace", fontSize: 14 }}>
          {missing.map((key) => (
            <li key={key}>{key}</li>
          ))}
        </ul>
      </div>

      <section style={{ marginTop: 32 }}>
        <h2>Fastest local setup</h2>
        <p>
          The Supabase CLI runs Postgres, Auth and Storage on your machine — no cloud project
          and no real email needed.
        </p>
        <pre
          style={{
            background: "var(--surface)",
            border: "1px solid var(--line)",
            padding: 16,
            overflowX: "auto",
            fontSize: 13,
          }}
        >
{`supabase start          # prints your local URL and keys
cp .env.example .env.local
# paste the printed API URL, anon key and service_role key into .env.local
npm run db:migrate
npx tsx scripts/setup-storage.ts
npx tsx scripts/seed.ts
npm run dev             # app
npm run worker          # image processing, separate terminal`}
        </pre>
        <p className="muted small">
          Sign-in emails are caught locally by Inbucket at{" "}
          <a href="http://localhost:54324">localhost:54324</a> — open the link from there. See
          README for the hosted-Supabase alternative.
        </p>
      </section>
    </main>
  );
}
