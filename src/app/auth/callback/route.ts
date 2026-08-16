import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

/** Magic-link landing: exchange the code for a session, then continue. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next") ?? "/studio";

  if (code) {
    const supabase = await supabaseServer();
    await supabase.auth.exchangeCodeForSession(code);
  }

  // Never redirect off-site.
  const safeNext = next.startsWith("/") ? next : "/studio";
  return NextResponse.redirect(new URL(safeNext, url.origin));
}
