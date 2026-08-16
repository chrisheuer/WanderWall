import { sql } from "drizzle-orm";
import { db, tables } from "@/db";

/**
 * Fixed-window rate limiter backed by Postgres, so the budget is shared
 * across serverless instances rather than being per-process (which is not
 * a limit at all once the app scales horizontally).
 *
 * The whole decision is one atomic upsert: the row is inserted, or its
 * counter is incremented — unless the window has elapsed, in which case
 * it restarts. Concurrent callers therefore cannot both see "count = 0".
 */
export async function rateLimit(
  key: string,
  opts: { limit: number; windowMs: number },
): Promise<{ ok: boolean; retryAfterSeconds: number }> {
  const windowSeconds = Math.ceil(opts.windowMs / 1000);

  try {
    const [row] = await db()
      .insert(tables.rateLimits)
      .values({ key, count: 1, windowStart: new Date() })
      .onConflictDoUpdate({
        target: tables.rateLimits.key,
        set: {
          count: sql`case
            when ${tables.rateLimits.windowStart} < now() - make_interval(secs => ${windowSeconds})
            then 1
            else ${tables.rateLimits.count} + 1
          end`,
          windowStart: sql`case
            when ${tables.rateLimits.windowStart} < now() - make_interval(secs => ${windowSeconds})
            then now()
            else ${tables.rateLimits.windowStart}
          end`,
        },
      })
      .returning({
        count: tables.rateLimits.count,
        windowStart: tables.rateLimits.windowStart,
      });

    if (!row || row.count <= opts.limit) return { ok: true, retryAfterSeconds: 0 };
    const resetAt = row.windowStart.getTime() + opts.windowMs;
    return {
      ok: false,
      retryAfterSeconds: Math.max(1, Math.ceil((resetAt - Date.now()) / 1000)),
    };
  } catch {
    // A limiter that is itself broken must not take the endpoint down.
    return { ok: true, retryAfterSeconds: 0 };
  }
}

export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  return fwd ? fwd.split(",")[0].trim() : "unknown";
}
