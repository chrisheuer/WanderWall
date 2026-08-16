import { createClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";

/**
 * Create storage buckets. Originals + exports are private (signed URLs);
 * derivatives are public with immutable cache headers set per object.
 * Run: npx tsx scripts/setup-storage.ts
 */
async function main() {
  const admin = createClient(env().NEXT_PUBLIC_SUPABASE_URL, env().SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const buckets: Array<{ name: string; isPublic: boolean; fileSizeLimit?: string }> = [
    { name: env().STORAGE_ORIGINALS_BUCKET, isPublic: false, fileSizeLimit: "40MB" },
    { name: env().STORAGE_DERIVATIVES_BUCKET, isPublic: true },
    { name: env().STORAGE_EXPORTS_BUCKET, isPublic: false },
  ];

  for (const bucket of buckets) {
    const { error } = await admin.storage.createBucket(bucket.name, {
      public: bucket.isPublic,
      fileSizeLimit: bucket.fileSizeLimit,
    });
    if (error && !/already exists/i.test(error.message)) {
      throw new Error(`creating bucket ${bucket.name}: ${error.message}`);
    }
    console.log(`bucket ${bucket.name} ready (public=${bucket.isPublic})`);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
