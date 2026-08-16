"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Item {
  id: string;
  status: string;
  note: string;
  createdAt: string;
  galleryTitle: string;
  gallerySlug: string;
}

export function FeaturedReviewList({ items }: { items: Item[] }) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function decide(id: string, decision: "approved" | "declined") {
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(`/api/admin/featured/${id}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision }),
      });
      if (!res.ok) throw new Error("review action failed");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "review action failed");
    } finally {
      setBusyId(null);
    }
  }

  if (items.length === 0) return <p className="muted">No submissions yet.</p>;

  return (
    <div>
      {error ? <p className="notice">{error}</p> : null}
      <table className="plain">
        <thead>
          <tr>
            <th>Gallery</th>
            <th>Note</th>
            <th>Status</th>
            <th>Submitted</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id} style={{ opacity: busyId === item.id ? 0.5 : 1 }}>
              <td>
                <a href={`/g/${item.gallerySlug}`} target="_blank" rel="noopener noreferrer">
                  {item.galleryTitle}
                </a>
              </td>
              <td className="small muted">{item.note || "—"}</td>
              <td>
                <span className="badge">{item.status}</span>
              </td>
              <td className="small">{item.createdAt.slice(0, 10)}</td>
              <td style={{ whiteSpace: "nowrap" }}>
                {item.status === "pending" ? (
                  <>
                    <button
                      className="btn btn-secondary small"
                      onClick={() => decide(item.id, "approved")}
                    >
                      Approve
                    </button>{" "}
                    <button
                      className="btn btn-danger small"
                      onClick={() => decide(item.id, "declined")}
                    >
                      Decline
                    </button>
                  </>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
