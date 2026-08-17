import { eq } from "drizzle-orm";
import { db, tables } from "@/db";
import { env } from "@/lib/env";
import { supabaseConfigStatus } from "@/lib/supabase/config";
import { supabaseServer } from "@/lib/supabase/server";

export type Creator = typeof tables.creators.$inferSelect;

/**
 * Resolve the signed-in creator, provisioning the creators row on first
 * sign-in. Returns null when unauthenticated.
 */
export async function currentCreator(): Promise<Creator | null> {
  // Unconfigured means nobody is signed in, not a crash. Middleware sends
  // interactive routes to /setup; this keeps any other caller sane.
  if (!supabaseConfigStatus().configured) return null;

  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) return null;

  const found = await db()
    .select()
    .from(tables.creators)
    .where(eq(tables.creators.id, user.id))
    .limit(1);
  if (found.length > 0) return found[0];

  // Single-tenant gate lives here and only here: while signups are off, the
  // owner is the one address allowed to provision an account.
  if (!env().SIGNUPS_ENABLED && user.email.toLowerCase() !== env().OWNER_EMAIL.toLowerCase()) {
    return null;
  }

  const inserted = await db()
    .insert(tables.creators)
    .values({ id: user.id, email: user.email, displayName: user.email.split("@")[0] })
    .onConflictDoNothing()
    .returning();
  if (inserted.length > 0) return inserted[0];
  const retry = await db()
    .select()
    .from(tables.creators)
    .where(eq(tables.creators.id, user.id))
    .limit(1);
  return retry[0] ?? null;
}

export async function requireCreator(): Promise<Creator> {
  const creator = await currentCreator();
  if (!creator) throw new Error("unauthorized");
  return creator;
}

export function isOwner(creator: Creator): boolean {
  return creator.email.toLowerCase() === env().OWNER_EMAIL.toLowerCase();
}
