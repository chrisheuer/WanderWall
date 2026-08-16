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

### Supabase magic-link email template (required)

Sign-in verifies a `token_hash`, which is what makes a link work when it
is opened on a different device than the one that requested it. Set the
Supabase **Magic Link** template to:

```
<a href="{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=email">Sign in</a>
```

The default `{{ .ConfirmationURL }}` template uses a PKCE `code`, which
only works in the requesting browser. The callback still accepts `code`
as a same-device fallback.

## Checks

```sh
npm run check     # typecheck + layout geometry + ingest privacy
```

- `scripts/check-layout.ts` asserts across 768 archetype/density/count/hero
  combinations that every piece is placed exactly once, no two canvases
  overlap, and nothing hangs through a wall, floor, or ceiling.
- `scripts/check-ingest.ts` asserts on real encoded bytes that served
  derivatives carry no EXIF or GPS, that full EXIF is retained privately
  for the creator, and that derivative sizes and formats match the
  residency policy.

## Architecture notes

- **Single-tenant launch, multi-tenant-ready**: every content table carries
  `creator_id`; auth exists from day one; public routes are `/g/[slug]`,
  creation lives under `/studio`. `SIGNUPS_ENABLED=false` is the only
  single-user assumption — flipping it requires no schema migration.
- **Storage adapter seam** (`src/lib/storage`): Supabase Storage today;
  Cloudflare R2 can replace it by implementing one interface.
- **Single ingest pipeline**: uploads, pasted URLs, Drive and Dropbox
  imports all land an original in storage and enqueue the same ingest job
  (derivatives, dimensions, dominant colors, EXIF handling). Full EXIF is
  kept privately for the creator; nothing served carries any metadata.
- **Room-scoped residency**: only the active room and the rooms through
  its doors are mounted, in both the hosted scene and the static export.
  This is what keeps a 120-piece gallery inside the mobile texture
  budget — the texture cache is reference-counted so on-screen art is
  never evicted.
- **Creator-supplied URLs go through `src/lib/safe-fetch.ts`**, which
  validates every resolved address, re-checks each redirect hop, and pins
  validation to connect time. Do not fetch a user-supplied URL any other
  way.
- **Stripe Connect seam**: donations settle to the owner in v1;
  `creators.stripe_account_id` + the payments module are where destination
  charges slot in later.
- **Dormant flags**: `FEATURE_AI_SKYBOX` (no skybox service is integrated),
  WebXR excluded but the renderer does not preclude `@react-three/xr`.
