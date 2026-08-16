import { NextResponse } from "next/server";
import { currentCreator } from "@/lib/auth";
import { dropboxAuthUrl, gdriveAuthUrl } from "@/lib/cloud-imports";
import { signState } from "@/lib/signed-state";

/** Begin OAuth for a cloud import provider. State is signed and expiring. */
export async function GET(request: Request, ctx: { params: Promise<{ provider: string }> }) {
  const creator = await currentCreator();
  if (!creator) return NextResponse.redirect(new URL("/login", request.url));

  const { provider } = await ctx.params;
  const url = new URL(request.url);
  const galleryId = url.searchParams.get("galleryId") ?? "";

  const state = signState({ creatorId: creator.id, galleryId });

  if (provider === "gdrive") return NextResponse.redirect(gdriveAuthUrl(state));
  if (provider === "dropbox") return NextResponse.redirect(dropboxAuthUrl(state));
  return NextResponse.json({ error: "unknown provider" }, { status: 400 });
}
