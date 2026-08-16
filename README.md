# Wanderwall

A hosted web service where a photographer creates a walkable 3D gallery of
their photos or artworks (3–120 pieces), styles the space, and shares it by
link. Visitors explore the gallery in-browser on desktop or mobile and can
donate to the creator via Stripe.

Pro-consumer by design: honest renewal practices, one-click cancellation,
unlimited updates while hosted, and creators can always take their gallery
with them via static export.

## Stack

- **Next.js** (App Router, TypeScript) on Vercel — SSR public pages, API routes
- **React Three Fiber + drei** (WebGL2) for the walkable scene
- **Supabase** Postgres (Drizzle ORM) + Auth (magic link) + Storage
- **pg-boss** DB-backed job queue (ingest, imports, exports, billing email)
- **Stripe** Checkout / Subscriptions / Customer Portal / Promotion Codes
- **Resend** + React Email for all transactional email
- **sharp** for derivatives (WebP thumb 256 / wall 1024 / zoom 2048)

## Local development

```sh
cp .env.example .env.local   # fill in Supabase/Stripe/Resend keys
npm install
npm run db:migrate           # apply drizzle/ migrations to DATABASE_URL
npx tsx scripts/setup-storage.ts
npx tsx scripts/seed.ts      # seed environment archetypes
npm run dev                  # app on :3000
npm run worker               # pg-boss worker (separate terminal)
```

In production the queue drains via a Vercel cron hitting
`/api/queue/drain` (see `vercel.json`); the dedicated worker is optional.

## Architecture notes

- **Single-tenant launch, multi-tenant-ready**: every content table carries
  `creator_id`; auth exists from day one; public routes are `/g/[slug]`,
  creation lives under `/studio`. `SIGNUPS_ENABLED=false` is the only
  single-user assumption — flipping it requires no schema migration.
- **Storage adapter seam** (`src/lib/storage`): Supabase Storage today;
  Cloudflare R2 can replace it by implementing one interface.
- **Single ingest pipeline**: uploads, pasted URLs, Drive and Dropbox
  imports all land an original in storage and enqueue the same ingest job
  (derivatives, dimensions, dominant colors, EXIF GPS stripping).
- **Stripe Connect seam**: donations settle to the owner in v1;
  `creators.stripe_account_id` + the payments module are where destination
  charges slot in later.
- **Dormant flags**: `FEATURE_AI_SKYBOX` (no skybox service is integrated),
  WebXR excluded but the renderer does not preclude `@react-three/xr`.
