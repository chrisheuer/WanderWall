/**
 * Supabase is required for auth, storage and the database. Without it the
 * SDK throws "Your project's URL and Key are required" from deep inside a
 * request, which tells a developer setting this up for the first time
 * nothing useful. These helpers let the app say what is actually missing.
 */

export interface SupabaseConfigStatus {
  configured: boolean;
  missing: string[];
}

const REQUIRED = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "DATABASE_URL",
] as const;

/** Client-safe check: only looks at the public vars. */
export function browserSupabaseConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}

export function supabaseConfigStatus(): SupabaseConfigStatus {
  const missing = REQUIRED.filter((key) => !process.env[key]);
  return { configured: missing.length === 0, missing };
}
