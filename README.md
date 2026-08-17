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

See [DEPLOY.md](DEPLOY.md) for deploying to Vercel + Supabase.

## Run it locally

Auth, storage and the database are all Supabase, so you need one of the two
setups below before you can sign in or upload photos. The public pages
render without it; `/studio` redirects to `/setup`, which lists whatever is
missing.

### Option A — everything on your machine (recommended)

Needs Docker and the [Supabase CLI](https://supabase.com/docs/guides/local-development).
No cloud project, no real email.

```sh
npm install
supabase start                 # prints API URL, anon key, service_role key
cp .env.example .env.local     # paste those three values in
npm run db:migrate
npx tsx scripts/setup-storage.ts   # creates the three buckets
npx tsx scripts/seed.ts            # seeds the 8 environment archetypes

npm run dev                    # app on :3000
npm run worker                 # REQUIRED — see below. separate terminal.
```

Set `OWNER_EMAIL` in `.env.local` to the address you will sign in with:
`SIGNUPS_ENABLED=false` means only that address gets an account.

Sign-in emails don't leave your machine — the local stack catches them at
[localhost:54324](http://localhost:54324). Open the newest message and click
the link.

### Option B — hosted Supabase, app local

Create a free project at supabase.com, copy its URL, anon key and
service_role key into `.env.local`, and set `DATABASE_URL` to the project's
connection string. Then run the same migrate / setup-storage / seed / dev /
worker commands. Magic-link emails go to your real inbox.

For hosted Supabase, set the **Magic Link** email template to send a token
hash, so a link opened on your phone works:

```
<a href="{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=email">Sign in</a>
```

The default template uses a PKCE `code`, which only works in the browser that
requested it. The callback accepts both, so same-device local testing works
either way.

### Two things that will bite you

- **`npm run worker` must be running.** Uploads land in storage, then a
  queued job makes the WebP derivatives. Without the worker your photos sit
  at "processing" forever and never appear on a wall. In production a Vercel
  cron drains the same queue; locally nothing does.
- **You do not need Stripe to test uploading and walking a gallery.** Leave
  a gallery as a draft and open its "Preview gallery" link — a draft is
  visible to its creator at `/g/[slug]`. Only *publishing* is payment-gated,
  so Stripe keys are only needed to exercise checkout.

### What to expect

Upload 3+ photos, then preview. Under ~14 pieces you get a single room;
above that the gallery segments into chaptered rooms with corridors between
wings. WASD or arrows to walk, drag to look, click a work to focus it, click
the floor to move, and the mini-map bottom-right teleports. "List view"
top-right is the 2D fallback and works without WebGL.

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
npm run check                          # typecheck + layout + ingest + SSRF
DATABASE_URL=... npm run check:db      # schema constraints, against a scratch DB
```

- `scripts/check-layout.ts` asserts across 768 archetype/density/count/hero
  combinations that every piece is placed exactly once, no two canvases
  overlap, and nothing hangs through a wall, floor, or ceiling.
- `scripts/check-ingest.ts` asserts on real encoded bytes that served
  derivatives carry no EXIF or GPS, that full EXIF is retained privately
  for the creator, and that derivative sizes and formats match the
  residency policy.
- `scripts/check-safe-fetch.ts` runs the URL importer against a live
  server standing in for an attacker's host: redirects into cloud
  metadata and loopback, obfuscated IP literals, IPv4-mapped IPv6,
  non-image content, and oversized streaming bodies must all be refused,
  while genuine public hosts are allowed.
- `scripts/check-db.ts` (needs a scratch `DATABASE_URL`) exercises the
  SQL that only fails at runtime: the rate limiter's conditional upsert
  and window reset, the partial unique indexes that dedup imports and
  refuse a second creation charge, and the notification dedup claim.

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
