import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { db, tables } from "@/db";
import { currentCreator } from "@/lib/auth";
import { CreateGalleryForm } from "@/components/studio/CreateGalleryForm";

export const dynamic = "force-dynamic";

export default async function StudioPage() {
  const creator = await currentCreator();
  if (!creator) {
    return (
      <main className="container" style={{ padding: "48px 24px" }}>
        <h1>Studio</h1>
        <p className="notice">
          Your account isn’t provisioned. Signups are currently closed — if this is your
          instance, sign in with the owner email.
        </p>
        <form action="/api/auth/signout" method="post">
          <button className="btn btn-secondary" type="submit">Sign out</button>
        </form>
      </main>
    );
  }

  const galleries = await db()
    .select()
    .from(tables.galleries)
    .where(eq(tables.galleries.creatorId, creator.id))
    .orderBy(asc(tables.galleries.createdAt));

  return (
    <main className="container" style={{ padding: "48px 24px" }}>
      <h1 style={{ marginTop: 0 }}>Studio</h1>
      <p className="muted">Signed in as {creator.email}</p>

      <section style={{ marginTop: 24 }}>
        <h2>Your galleries</h2>
        {galleries.length === 0 ? (
          <p className="muted">Nothing yet — create your first gallery below.</p>
        ) : (
          <table className="plain">
            <thead>
              <tr>
                <th>Title</th>
                <th>Tier</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {galleries.map((g) => (
                <tr key={g.id}>
                  <td>
                    <Link href={`/studio/galleries/${g.id}`}>{g.title}</Link>
                  </td>
                  <td>{g.tier}</td>
                  <td>
                    <span className="badge">{g.status}</span>
                  </td>
                  <td>
                    {g.status !== "draft" ? (
                      <a className="small" href={`/g/${g.slug}`}>
                        view public page
                      </a>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section style={{ marginTop: 40, maxWidth: 480 }}>
        <h2>New gallery</h2>
        <CreateGalleryForm />
      </section>

      <form action="/api/auth/signout" method="post" style={{ marginTop: 48 }}>
        <button className="btn btn-secondary" type="submit">Sign out</button>
      </form>
    </main>
  );
}
