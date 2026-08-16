/**
 * Fixed-window in-memory rate limiter. Per serverless instance, which is
 * acceptable for v1 abuse damping on URL fetch and donation endpoints;
 * a shared store can replace the Map without changing call sites.
 */

const windows = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(
  key: string,
  opts: { limit: number; windowMs: number },
): { ok: boolean; retryAfterSeconds: number } {
  const now = Date.now();
  const entry = windows.get(key);
  if (!entry || entry.resetAt <= now) {
    windows.set(key, { count: 1, resetAt: now + opts.windowMs });
    return { ok: true, retryAfterSeconds: 0 };
  }
  if (entry.count >= opts.limit) {
    return { ok: false, retryAfterSeconds: Math.ceil((entry.resetAt - now) / 1000) };
  }
  entry.count += 1;
  return { ok: true, retryAfterSeconds: 0 };
}

export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  return fwd ? fwd.split(",")[0].trim() : "unknown";
}
