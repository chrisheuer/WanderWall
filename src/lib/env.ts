import { z } from "zod";

/**
 * Server-side environment. Parsed lazily so that build-time page data
 * collection does not require a fully configured environment.
 */
const serverSchema = z.object({
  NEXT_PUBLIC_APP_URL: z.string().url().default("http://localhost:3000"),
  SIGNUPS_ENABLED: z
    .string()
    .default("false")
    .transform((v) => v === "true"),
  OWNER_EMAIL: z.string().email().default("owner@example.com"),

  NEXT_PUBLIC_SUPABASE_URL: z.string().url().default("http://localhost:54321"),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().default(""),
  SUPABASE_SERVICE_ROLE_KEY: z.string().default(""),
  DATABASE_URL: z
    .string()
    .default("postgresql://postgres:postgres@localhost:5432/postgres"),

  STORAGE_ORIGINALS_BUCKET: z.string().default("originals"),
  STORAGE_DERIVATIVES_BUCKET: z.string().default("derivatives"),
  STORAGE_EXPORTS_BUCKET: z.string().default("exports"),

  STRIPE_SECRET_KEY: z.string().default(""),
  STRIPE_WEBHOOK_SECRET: z.string().default(""),
  STRIPE_PRICE_CREATION: z.string().default(""),
  STRIPE_PRICE_S_MONTHLY: z.string().default(""),
  STRIPE_PRICE_S_ANNUAL_BUNDLE: z.string().default(""),
  STRIPE_PRICE_L_MONTHLY: z.string().default(""),
  STRIPE_PRICE_L_ANNUAL_BUNDLE: z.string().default(""),
  STRIPE_PRICE_DOWNLOAD: z.string().default(""),

  RESEND_API_KEY: z.string().default(""),
  EMAIL_FROM: z.string().default("Wanderwall <hello@example.com>"),

  GOOGLE_OAUTH_CLIENT_ID: z.string().default(""),
  GOOGLE_OAUTH_CLIENT_SECRET: z.string().default(""),
  DROPBOX_APP_KEY: z.string().default(""),
  DROPBOX_APP_SECRET: z.string().default(""),

  CRON_SECRET: z.string().default("dev-secret"),

  FEATURE_AI_SKYBOX: z
    .string()
    .default("false")
    .transform((v) => v === "true"),
});

let cached: z.infer<typeof serverSchema> | null = null;

export function env(): z.infer<typeof serverSchema> {
  if (!cached) {
    cached = serverSchema.parse(process.env);
  }
  return cached;
}
