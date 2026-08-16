import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

/**
 * Magic-link landing.
 *
 * Prefers `token_hash` + verifyOtp, which carries no PKCE verifier and so
 * works when the link is opened on a different device than the one that
 * requested it — the common "request on laptop, tap on phone" path. The
 * `code` exchange is kept as a fallback for same-device flows and for
 * OAuth-style redirects.
 *
 * This requires the Supabase magic-link email template to send
 * `{{ .TokenHash }}`; see README for the exact template.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next") ?? "/studio";
  // Never redirect off-site.
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/studio";

  const supabase = await supabaseServer();
  let failure: string | null = null;

  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    failure = error?.message ?? null;
  } else if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    failure = error?.message ?? null;
  } else {
    failure = "This sign-in link is missing its token.";
  }

  if (failure) {
    const back = new URL("/login", url.origin);
    back.searchParams.set("error", failure);
    back.searchParams.set("next", safeNext);
    return NextResponse.redirect(back);
  }

  return NextResponse.redirect(new URL(safeNext, url.origin));
}
