import { and, eq } from "drizzle-orm";
import { db, tables } from "@/db";
import { env } from "@/lib/env";

/**
 * Google Drive + Dropbox access via raw REST (no SDK weight). Tokens live
 * in oauth_tokens; both providers use refresh tokens so imports resume
 * across chunks without re-consent.
 */

export type Provider = "gdrive" | "dropbox";

export function gdriveAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: env().GOOGLE_OAUTH_CLIENT_ID,
    redirect_uri: `${env().NEXT_PUBLIC_APP_URL}/api/imports/gdrive/callback`,
    response_type: "code",
    scope: "https://www.googleapis.com/auth/drive.readonly",
    access_type: "offline",
    prompt: "consent",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

export function dropboxAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: env().DROPBOX_APP_KEY,
    redirect_uri: `${env().NEXT_PUBLIC_APP_URL}/api/imports/dropbox/callback`,
    response_type: "code",
    token_access_type: "offline",
    state,
  });
  return `https://www.dropbox.com/oauth2/authorize?${params}`;
}

export async function exchangeCode(
  provider: Provider,
  code: string,
): Promise<{ accessToken: string; refreshToken: string | null; expiresAt: Date | null }> {
  const e = env();
  const body =
    provider === "gdrive"
      ? new URLSearchParams({
          code,
          client_id: e.GOOGLE_OAUTH_CLIENT_ID,
          client_secret: e.GOOGLE_OAUTH_CLIENT_SECRET,
          redirect_uri: `${e.NEXT_PUBLIC_APP_URL}/api/imports/gdrive/callback`,
          grant_type: "authorization_code",
        })
      : new URLSearchParams({
          code,
          client_id: e.DROPBOX_APP_KEY,
          client_secret: e.DROPBOX_APP_SECRET,
          redirect_uri: `${e.NEXT_PUBLIC_APP_URL}/api/imports/dropbox/callback`,
          grant_type: "authorization_code",
        });
  const url =
    provider === "gdrive"
      ? "https://oauth2.googleapis.com/token"
      : "https://api.dropboxapi.com/oauth2/token";
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) throw new Error(`${provider} token exchange failed: ${await res.text()}`);
  const json = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
  };
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token ?? null,
    expiresAt: json.expires_in ? new Date(Date.now() + json.expires_in * 1000) : null,
  };
}

export async function saveToken(
  creatorId: string,
  provider: Provider,
  token: { accessToken: string; refreshToken: string | null; expiresAt: Date | null },
): Promise<void> {
  await db()
    .delete(tables.oauthTokens)
    .where(
      and(eq(tables.oauthTokens.creatorId, creatorId), eq(tables.oauthTokens.provider, provider)),
    );
  await db().insert(tables.oauthTokens).values({
    creatorId,
    provider,
    accessToken: token.accessToken,
    refreshToken: token.refreshToken,
    expiresAt: token.expiresAt,
  });
}

/** Valid access token for the creator, refreshing when expired. */
export async function accessTokenFor(creatorId: string, provider: Provider): Promise<string> {
  const [row] = await db()
    .select()
    .from(tables.oauthTokens)
    .where(
      and(eq(tables.oauthTokens.creatorId, creatorId), eq(tables.oauthTokens.provider, provider)),
    )
    .limit(1);
  if (!row) throw new Error(`${provider} is not connected`);

  const stillValid = !row.expiresAt || row.expiresAt.getTime() > Date.now() + 60_000;
  if (stillValid) return row.accessToken;
  if (!row.refreshToken) throw new Error(`${provider} token expired; reconnect`);

  const e = env();
  const body =
    provider === "gdrive"
      ? new URLSearchParams({
          refresh_token: row.refreshToken,
          client_id: e.GOOGLE_OAUTH_CLIENT_ID,
          client_secret: e.GOOGLE_OAUTH_CLIENT_SECRET,
          grant_type: "refresh_token",
        })
      : new URLSearchParams({
          refresh_token: row.refreshToken,
          client_id: e.DROPBOX_APP_KEY,
          client_secret: e.DROPBOX_APP_SECRET,
          grant_type: "refresh_token",
        });
  const url =
    provider === "gdrive"
      ? "https://oauth2.googleapis.com/token"
      : "https://api.dropboxapi.com/oauth2/token";
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) throw new Error(`${provider} token refresh failed`);
  const json = (await res.json()) as { access_token: string; expires_in?: number };
  await db()
    .update(tables.oauthTokens)
    .set({
      accessToken: json.access_token,
      expiresAt: json.expires_in ? new Date(Date.now() + json.expires_in * 1000) : null,
    })
    .where(eq(tables.oauthTokens.id, row.id));
  return json.access_token;
}

export async function isConnected(creatorId: string, provider: Provider): Promise<boolean> {
  const rows = await db()
    .select({ id: tables.oauthTokens.id })
    .from(tables.oauthTokens)
    .where(
      and(eq(tables.oauthTokens.creatorId, creatorId), eq(tables.oauthTokens.provider, provider)),
    )
    .limit(1);
  return rows.length > 0;
}

/** Pull a Drive folder id out of a pasted URL or raw id. */
export function parseGdriveFolderRef(input: string): string {
  const m = /folders\/([a-zA-Z0-9_-]{10,})/.exec(input);
  if (m) return m[1];
  return input.trim();
}

/** Dropbox folder path from a pasted path ("/Photos/Show") or URL. */
export function parseDropboxFolderRef(input: string): string {
  const trimmed = input.trim();
  if (trimmed.startsWith("/")) return trimmed;
  try {
    const url = new URL(trimmed);
    // Shared-link URLs carry the display path after /home or /scl/fo/...;
    // fall back to the raw path portion.
    const homeIdx = url.pathname.indexOf("/home/");
    if (homeIdx >= 0) return decodeURIComponent(url.pathname.slice(homeIdx + 5));
    return decodeURIComponent(url.pathname);
  } catch {
    return `/${trimmed}`;
  }
}

export interface RemoteImage {
  id: string; // provider file id / path
  name: string;
  sizeBytes: number;
}

export interface ListPage {
  files: RemoteImage[];
  nextCursor: string | null;
}

const IMAGE_EXT = /\.(jpe?g|png|webp|gif|tiff?|avif)$/i;
const MAX_BYTES = 40 * 1024 * 1024;

export async function listGdriveFolder(
  token: string,
  folderId: string,
  cursor: string | null,
): Promise<ListPage> {
  const params = new URLSearchParams({
    q: `'${folderId.replace(/'/g, "\\'")}' in parents and mimeType contains 'image/' and trashed = false`,
    fields: "nextPageToken, files(id, name, size)",
    pageSize: "25",
  });
  if (cursor) params.set("pageToken", cursor);
  const res = await fetch(`https://www.googleapis.com/drive/v3/files?${params}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`drive list failed: ${await res.text()}`);
  const json = (await res.json()) as {
    nextPageToken?: string;
    files: Array<{ id: string; name: string; size?: string }>;
  };
  return {
    files: json.files
      .map((f) => ({ id: f.id, name: f.name, sizeBytes: Number(f.size ?? 0) }))
      .filter((f) => f.sizeBytes > 0 && f.sizeBytes <= MAX_BYTES),
    nextCursor: json.nextPageToken ?? null,
  };
}

export async function downloadGdriveFile(token: string, fileId: string): Promise<Buffer> {
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
    { headers: { authorization: `Bearer ${token}` } },
  );
  if (!res.ok) throw new Error(`drive download failed for ${fileId}`);
  return Buffer.from(await res.arrayBuffer());
}

export async function listDropboxFolder(
  token: string,
  path: string,
  cursor: string | null,
): Promise<ListPage> {
  const url = cursor
    ? "https://api.dropboxapi.com/2/files/list_folder/continue"
    : "https://api.dropboxapi.com/2/files/list_folder";
  const res = await fetch(url, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(cursor ? { cursor } : { path, limit: 25 }),
  });
  if (!res.ok) throw new Error(`dropbox list failed: ${await res.text()}`);
  const json = (await res.json()) as {
    entries: Array<{ ".tag": string; id: string; name: string; path_lower?: string; size?: number }>;
    cursor: string;
    has_more: boolean;
  };
  return {
    files: json.entries
      .filter((e) => e[".tag"] === "file" && IMAGE_EXT.test(e.name))
      .map((e) => ({ id: e.path_lower ?? e.id, name: e.name, sizeBytes: e.size ?? 0 }))
      .filter((f) => f.sizeBytes > 0 && f.sizeBytes <= MAX_BYTES),
    nextCursor: json.has_more ? json.cursor : null,
  };
}

export async function downloadDropboxFile(token: string, path: string): Promise<Buffer> {
  const res = await fetch("https://content.dropboxapi.com/2/files/download", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "dropbox-api-arg": JSON.stringify({ path }),
    },
  });
  if (!res.ok) throw new Error(`dropbox download failed for ${path}`);
  return Buffer.from(await res.arrayBuffer());
}
