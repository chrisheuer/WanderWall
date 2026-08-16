import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, tables } from "@/db";
import { currentCreator } from "@/lib/auth";
import { env } from "@/lib/env";
import {
  EditLockedError,
  PieceCapError,
  assertEditable,
  assertWithinPieceCap,
  galleryByIdForCreator,
} from "@/lib/galleries";

/**
 * Register uploads: creates artwork rows and returns signed upload URLs so
 * the browser sends bytes straight to storage (files up to 40MB never pass
 * through a serverless request body). The client then calls
 * /api/artworks/[id]/complete to enter the ingest pipeline.
 */

const uploadSchema = z.object({
  files: z
    .array(
      z.object({
        name: z.string().max(300),
        sizeBytes: z.number().int().positive().max(40 * 1024 * 1024),
        contentType: z.string().regex(/^image\//),
      }),
    )
    .min(1)
    .max(24), // one registration batch; large sets register in batches
});

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const creator = await currentCreator();
  if (!creator) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const gallery = await galleryByIdForCreator(id, creator.id);
  if (!gallery) return NextResponse.json({ error: "not found" }, { status: 404 });

  const body = uploadSchema.safeParse(await request.json().catch(() => ({})));
  if (!body.success) {
    return NextResponse.json({ error: body.error.flatten() }, { status: 400 });
  }

  try {
    assertEditable(gallery);
    await assertWithinPieceCap(gallery, body.data.files.length);
  } catch (err) {
    if (err instanceof EditLockedError || err instanceof PieceCapError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    throw err;
  }

  const admin = createClient(env().NEXT_PUBLIC_SUPABASE_URL, env().SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const results = [];
  for (const file of body.data.files) {
    const [artwork] = await db()
      .insert(tables.artworks)
      .values({
        galleryId: gallery.id,
        title: file.name.replace(/\.[a-z0-9]+$/i, ""),
        sourceType: "upload",
        ingestStatus: "pending",
      })
      .returning();

    const key = `${gallery.id}/${artwork.id}/original`;
    const { data, error } = await admin.storage
      .from(env().STORAGE_ORIGINALS_BUCKET)
      .createSignedUploadUrl(key);
    if (error || !data) {
      return NextResponse.json({ error: `signed upload failed: ${error?.message}` }, { status: 500 });
    }

    await db()
      .update(tables.artworks)
      .set({ originalKey: key })
      .where(eq(tables.artworks.id, artwork.id));

    results.push({ artworkId: artwork.id, uploadUrl: data.signedUrl, token: data.token, key });
  }

  return NextResponse.json({ uploads: results }, { status: 201 });
}
