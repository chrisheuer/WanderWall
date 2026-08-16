import { desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db, tables } from "@/db";
import { currentCreator } from "@/lib/auth";
import {
  isConnected,
  parseDropboxFolderRef,
  parseGdriveFolderRef,
} from "@/lib/cloud-imports";
import {
  EditLockedError,
  assertEditable,
  galleryByIdForCreator,
} from "@/lib/galleries";
import { enqueue, QUEUES } from "@/lib/queue";

const startSchema = z.object({
  galleryId: z.string().uuid(),
  provider: z.enum(["gdrive", "dropbox"]),
  folderRef: z.string().min(1).max(1000),
});

/** Kick off a chunked, resumable folder import. */
export async function POST(request: Request) {
  const creator = await currentCreator();
  if (!creator) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = startSchema.safeParse(await request.json().catch(() => ({})));
  if (!body.success) return NextResponse.json({ error: "invalid request" }, { status: 400 });

  const gallery = await galleryByIdForCreator(body.data.galleryId, creator.id);
  if (!gallery) return NextResponse.json({ error: "not found" }, { status: 404 });

  try {
    assertEditable(gallery);
  } catch (err) {
    if (err instanceof EditLockedError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    throw err;
  }

  if (!(await isConnected(creator.id, body.data.provider))) {
    return NextResponse.json(
      { error: `connect ${body.data.provider === "gdrive" ? "Google Drive" : "Dropbox"} first` },
      { status: 400 },
    );
  }

  const folderRef =
    body.data.provider === "gdrive"
      ? parseGdriveFolderRef(body.data.folderRef)
      : parseDropboxFolderRef(body.data.folderRef);

  const [run] = await db()
    .insert(tables.importRuns)
    .values({
      galleryId: gallery.id,
      provider: body.data.provider,
      folderRef,
      status: "running",
    })
    .returning();

  await enqueue(QUEUES.importChunk, { importRunId: run.id });
  return NextResponse.json({ run }, { status: 201 });
}

/** Poll import progress for a gallery. */
export async function GET(request: Request) {
  const creator = await currentCreator();
  if (!creator) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const galleryId = new URL(request.url).searchParams.get("galleryId");
  if (!galleryId) return NextResponse.json({ error: "galleryId required" }, { status: 400 });
  const gallery = await galleryByIdForCreator(galleryId, creator.id);
  if (!gallery) return NextResponse.json({ error: "not found" }, { status: 404 });

  const runs = await db()
    .select()
    .from(tables.importRuns)
    .where(eq(tables.importRuns.galleryId, gallery.id))
    .orderBy(desc(tables.importRuns.createdAt))
    .limit(5);
  return NextResponse.json({ runs });
}
