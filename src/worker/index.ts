import { getBoss } from "@/lib/queue";
import { registerWorkers } from "@/jobs/registry";

/**
 * Dedicated queue worker (`npm run worker`). In production the Vercel cron
 * drain route covers the same queues; this process is for local dev and for
 * any future always-on worker deployment.
 */
async function main() {
  const boss = await getBoss();
  await registerWorkers(boss);
  console.log("[worker] pg-boss workers registered; waiting for jobs");
}

main().catch((err) => {
  console.error("[worker] fatal", err);
  process.exit(1);
});
