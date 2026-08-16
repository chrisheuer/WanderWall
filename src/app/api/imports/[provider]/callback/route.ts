import { NextResponse } from "next/server";
import { currentCreator } from "@/lib/auth";
import { exchangeCode, saveToken, type Provider } from "@/lib/cloud-imports";
import { env } from "@/lib/env";
import { verifyState } from "@/lib/signed-state";

/** OAuth callback: verify state, store tokens, return to the gallery. */
export async function GET(request: Request, ctx: { params: Promise<{ provider: string }> }) {
  const creator = await currentCreator();
  if (!creator) return NextResponse.redirect(new URL("/login", request.url));

  const { provider } = await ctx.params;
  if (provider !== "gdrive" && provider !== "dropbox") {
    return NextResponse.json({ error: "unknown provider" }, { status: 400 });
  }

  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const parsed = verifyState(url.searchParams.get("state") ?? "");
  if (!code || !parsed || parsed.creatorId !== creator.id) {
    return NextResponse.json({ error: "invalid or expired oauth state" }, { status: 400 });
  }
  const galleryId = parsed.galleryId;

  const token = await exchangeCode(provider as Provider, code);
  await saveToken(creator.id, provider as Provider, token);

  const back = galleryId ? `/studio/galleries/${galleryId}?connected=${provider}` : "/studio";
  return NextResponse.redirect(new URL(back, env().NEXT_PUBLIC_APP_URL));
}
