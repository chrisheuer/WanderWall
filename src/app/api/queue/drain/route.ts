import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { getBoss } from "@/lib/queue";
import { drainOnce } from "@/jobs/registry";

export const maxDuration = 60;

/**
 * Vercel-cron-triggered queue drain. Long imports chunk into resumable
 * jobs, so each bounded drain makes forward progress.
 */
export async function GET(request: Request) {
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${env().CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const boss = await getBoss();
  const processed = await drainOnce(boss, 50_000);
  return NextResponse.json({ processed });
}
