import { createHmac } from "node:crypto";
import { NextResponse } from "next/server";
import { currentCreator } from "@/lib/auth";
import { dropboxAuthUrl, gdriveAuthUrl } from "@/lib/cloud-imports";
import { env } from "@/lib/env";

/** Begin OAuth for a cloud import provider. State is HMAC-signed. */
export async function GET(request: Request, ctx: { params: Promise<{ provider: string }> }) {
  const creator = await currentCreator();
  if (!creator) return NextResponse.redirect(new URL("/login", request.url));

  const { provider } = await ctx.params;
  const url = new URL(request.url);
  const galleryId = url.searchParams.get("galleryId") ?? "";

  const payload = `${creator.id}:${galleryId}`;
  const sig = createHmac("sha256", env().CRON_SECRET).update(payload).digest("hex").slice(0, 24);
  const state = `${payload}:${sig}`;

  if (provider === "gdrive") return NextResponse.redirect(gdriveAuthUrl(state));
  if (provider === "dropbox") return NextResponse.redirect(dropboxAuthUrl(state));
  return NextResponse.json({ error: "unknown provider" }, { status: 400 });
}
