import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";

/**
 * Signed, single-use-ish OAuth state: carries a random nonce and an issue
 * timestamp so the value differs every time and expires, rather than being
 * a constant replayable token.
 */

const STATE_TTL_MS = 15 * 60 * 1000;

function secret(): string {
  // Falls back to CRON_SECRET only so local dev works out of the box;
  // production should set a dedicated value.
  return env().OAUTH_STATE_SECRET || env().CRON_SECRET;
}

export function signState(payload: Record<string, string>): string {
  const body = JSON.stringify({
    ...payload,
    n: randomBytes(9).toString("base64url"),
    t: Date.now(),
  });
  const encoded = Buffer.from(body).toString("base64url");
  const sig = createHmac("sha256", secret()).update(encoded).digest("base64url");
  return `${encoded}.${sig}`;
}

export function verifyState(state: string): Record<string, string> | null {
  const [encoded, sig] = state.split(".");
  if (!encoded || !sig) return null;

  const expected = createHmac("sha256", secret()).update(encoded).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    const parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as Record<
      string,
      string | number
    >;
    const issuedAt = Number(parsed.t);
    if (!Number.isFinite(issuedAt) || Date.now() - issuedAt > STATE_TTL_MS) return null;
    return Object.fromEntries(
      Object.entries(parsed).map(([k, v]) => [k, String(v)]),
    ) as Record<string, string>;
  } catch {
    return null;
  }
}
