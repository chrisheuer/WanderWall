import { NextResponse } from "next/server";
import { currentCreator } from "@/lib/auth";
import { env } from "@/lib/env";
import { galleryByIdForCreator } from "@/lib/galleries";
import { storage } from "@/lib/storage";

/**
 * Fresh signed URL for the most recent export. Works indefinitely — the
 * last export stays downloadable after the edit window closes, after
 * cancellation, always.
 */
export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const creator = await currentCreator();
  if (!creator) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const gallery = await galleryByIdForCreator(id, creator.id);
  if (!gallery) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!gallery.lastExportKey) {
    return NextResponse.json({ error: "no export has been built yet" }, { status: 404 });
  }

  const url = await storage().signedUrl(env().STORAGE_EXPORTS_BUCKET, gallery.lastExportKey, 3600);
  return NextResponse.redirect(url);
}
