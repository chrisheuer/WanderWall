import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { env } from "@/lib/env";
import * as schema from "./schema";

// One pool per serverless instance; Supabase's pooled connection string
// (transaction mode) keeps concurrent lambdas inside connection limits.
let pool: Pool | null = null;

function getPool(): Pool {
  if (!pool) {
    pool = new Pool({ connectionString: env().DATABASE_URL, max: 3 });
  }
  return pool;
}

let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;

export function db() {
  if (!_db) {
    _db = drizzle(getPool(), { schema });
  }
  return _db;
}

export * as tables from "./schema";
