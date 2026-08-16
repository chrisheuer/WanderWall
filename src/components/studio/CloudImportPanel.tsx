"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

interface ImportRun {
  id: string;
  provider: string;
  status: string;
  processedFiles: number;
  error: string | null;
}

/**
 * Drive/Dropbox folder imports: connect via OAuth, paste a folder link,
 * import runs as chunked resumable jobs feeding the one ingest pipeline.
 */
export function CloudImportPanel({
  galleryId,
  gdriveConnected,
  dropboxConnected,
}: {
  galleryId: string;
  gdriveConnected: boolean;
  dropboxConnected: boolean;
}) {
  const [provider, setProvider] = useState<"gdrive" | "dropbox">("gdrive");
  const [folderRef, setFolderRef] = useState("");
  const [runs, setRuns] = useState<ImportRun[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const connected = provider === "gdrive" ? gdriveConnected : dropboxConnected;
  const hasRunning = runs.some((r) => r.status === "running");

  useEffect(() => {
    let stop = false;
    async function poll() {
      const res = await fetch(`/api/imports/run?galleryId=${galleryId}`).catch(() => null);
      if (!res?.ok || stop) return;
      const body = await res.json();
      setRuns(body.runs ?? []);
    }
    void poll();
    const t = setInterval(() => {
      void poll().then(() => {
        if (runs.some((r) => r.status === "running")) router.refresh();
      });
    }, 5000);
    return () => {
      stop = true;
      clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [galleryId, hasRunning]);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/imports/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ galleryId, provider, folderRef }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof body.error === "string" ? body.error : "import failed");
      setFolderRef("");
      setRuns((r) => [body.run, ...r]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "import failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <h3 style={{ marginTop: 0 }}>Import from cloud storage</h3>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <select
          value={provider}
          onChange={(e) => setProvider(e.target.value as "gdrive" | "dropbox")}
          style={{ width: "auto" }}
        >
          <option value="gdrive">Google Drive</option>
          <option value="dropbox">Dropbox</option>
        </select>
        {connected ? (
          <>
            <input
              placeholder={
                provider === "gdrive"
                  ? "Paste a Drive folder link"
                  : "Paste a Dropbox folder path, e.g. /Photos/Show"
              }
              value={folderRef}
              onChange={(e) => setFolderRef(e.target.value)}
              style={{ flex: 1, minWidth: 220 }}
            />
            <button className="btn" disabled={busy || !folderRef} onClick={start}>
              {busy ? "Starting…" : "Import folder"}
            </button>
          </>
        ) : (
          <a
            className="btn btn-secondary"
            href={`/api/imports/${provider}/start?galleryId=${galleryId}`}
          >
            Connect {provider === "gdrive" ? "Google Drive" : "Dropbox"}
          </a>
        )}
      </div>
      <p className="muted small">
        Google Photos and iCloud don’t offer supported APIs — iCloud users: download your photos,
        then upload them here.
      </p>
      {error ? <p className="notice">{error}</p> : null}
      {runs.length > 0 ? (
        <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
          {runs.map((r) => (
            <li key={r.id}>
              {r.provider === "gdrive" ? "Drive" : "Dropbox"} import — {r.status},{" "}
              {r.processedFiles} file{r.processedFiles === 1 ? "" : "s"}
              {r.error ? <span className="muted"> ({r.error})</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
