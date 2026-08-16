import { createHmac } from "node:crypto";
import { NextResponse } from "next/server";
import { currentCreator } from "@/lib/auth";
import { exchangeCode, saveToken, type Provider } from "@/lib/cloud-imports";
import { env } from "@/lib/env";

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
  const state = url.searchParams.get("state") ?? "";
  const [creatorId, galleryId, sig] = state.split(":");
  const expected = createHmac("sha256", env().CRON_SECRET)
    .update(`${creatorId}:${galleryId}`)
    .digest("hex")
    .slice(0, 24);
  if (!code || creatorId !== creator.id || sig !== expected) {
    return NextResponse.json({ error: "invalid oauth state" }, { status: 400 });
  }

  const token = await exchangeCode(provider as Provider, code);
  await saveToken(creator.id, provider as Provider, token);

  const back = galleryId ? `/studio/galleries/${galleryId}?connected=${provider}` : "/studio";
  return NextResponse.redirect(new URL(back, env().NEXT_PUBLIC_APP_URL));
}
