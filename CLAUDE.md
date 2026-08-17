# Wanderwall — agent guide

A hosted service where a photographer builds a walkable 3D gallery of
3–120 pieces and shares it by link. Single-tenant today, multi-tenant-ready
by construction.

Read this before changing code. The invariants below are load-bearing:
several were broken once already and the breakage was invisible to
typechecking and to the build.

## Commands

```sh
npm run dev          # app on :3000
npm run worker       # pg-boss worker — REQUIRED locally or ingest never runs
npm run check        # typecheck + layout geometry + ingest privacy + SSRF
npm run check:db     # schema/SQL against a scratch DATABASE_URL
npm run build
npm run db:generate  # after editing src/db/schema.ts
npm run db:migrate
```

`npm run check` is the bar for "done". It is fast and it catches the
classes of bug that `tsc` cannot: geometry, privacy of served bytes, and
whether the SSRF guard actually binds.

## What the checks prove

- `scripts/check-layout.ts` — 1920 combinations of archetype, density,
  piece count, hero count, and auto vs creator-defined rooms. Asserts each
  piece is placed exactly once, no two canvases overlap **as rectangles**,
  nothing hangs across a doorway, nothing breaches floor/ceiling/wall.
- `scripts/check-ingest.ts` — on real encoded bytes: served derivatives
  carry no EXIF or GPS, full EXIF is retained privately, sizes/formats
  match the residency policy.
- `scripts/check-safe-fetch.ts` — the URL importer against a live server
  playing the attacker. Also asserts the transport works and that public
  hosts are still allowed, so it cannot pass by refusing everything.
- `scripts/check-db.ts` — the SQL that only fails at runtime: the rate
  limiter's conditional upsert, the partial unique indexes, dedup claims.

If you change layout, ingest, or safe-fetch, extend the matching suite in
the same change.

## Invariants

**Never fetch a creator-supplied URL except through `src/lib/safe-fetch.ts`.**
It resolves and validates every address, re-validates every redirect hop,
and pins validation to connect time. A plain `fetch` with
`redirect: "follow"` is an SSRF hole.

**All storage goes through the adapter** (`src/lib/storage`). No Supabase
storage SDK calls in feature code — the adapter exists so Cloudflare R2 can
replace it.

**One ingest pipeline.** Uploads, pasted URLs, Drive and Dropbox all land
an original in storage and enqueue the same `ingest` job. Do not add a
second path that generates derivatives.

**Stripe is the source of truth for money.** `purchases` and
`subscriptions` are a webhook-driven mirror, written only in
`src/app/api/webhooks/stripe/route.ts`. Never write them from a route
handler; fix problems in Stripe and replay the event.

**Galleries are never deleted to resolve billing.** Lapsed hosting sets
`frozen`; a closed download window sets `readonly`. Both stay exportable
and reactivatable. The delete endpoint refuses a gallery with live hosting.

**Room-scoped residency is enforced by mounting, not by texture choice.**
Only the active room and its door-connected neighbours mount their
artworks; geometry extends one hop further because aligned doorways make
the room beyond visible. Rendering every room loads every texture and
blows the mobile budget. This applies to the static export viewer too.

**Every content table carries `creator_id`**, and authorization goes
through `galleryByIdForCreator`. `SIGNUPS_ENABLED=false` is the only
single-tenant assumption; flipping it must need no migration.

**Creative Commons is opt-in, per gallery and per artwork.** Never default
a creator into CC. Never add copy-protection — no right-click blocking, no
DRM theater. CC is legal signaling.

**Promotion codes on every Checkout session**, one-time and recurring,
donations included.

**Notifications go through `enqueueOnce`** (`src/lib/notify.ts`), which
claims a durable dedup row. pg-boss singleton keys only dedup while a job
is queued, so they do not survive webhook redelivery.

## Traps that cost real time

Each of these was a live bug. None were caught by typecheck or build.

- **Node's global `fetch` silently ignores a dispatcher from an
  npm-installed undici.** Use undici's own `fetch` or connect-time
  validation is dead code.
- **`new URL()` rewrites `::ffff:169.254.169.254` to hex form**
  (`::ffff:a9fe:a9fe`). Match on parsed bytes, not spelling.
- **undici reports a connect-time refusal as `TypeError: fetch failed`**
  with the real error in `.cause`. Unwrap it or a blocked address looks
  transient and burns retries.
- **`onConflictDoNothing()` with no target swallows every constraint**,
  including ones that exist to surface a problem. Always name the target.
- **pg-boss breaks on Supabase's transaction pooler** (`:6543`). Use the
  session pooler (`:5432` on the pooler host).
- **sharp's `withExif()` cannot write a GPS IFD**, so a fixture built that
  way cannot prove GPS handling. Build the EXIF block by hand.
- **A minimum size that exceeds its own slot causes overlap.** Any "at
  least N" clamp in layout must be checked against the space available.
- **Bucketing before comparing hides overlaps.** The layout suite was blind
  to same-wall different-height collisions for exactly this reason.

## Conventions

- Comments explain **why**, not what. Match the density and voice of the
  surrounding file.
- Errors that a creator can fix should say what to do. Errors that only an
  operator can fix should be loud (log + email owner).
- Prefer a failure that is visible over one that is silent — the duplicate
  creation charge surfaces on purpose rather than being absorbed.
- Server-only modules import from `@/lib/env`; never read `process.env`
  directly in feature code (except `NEXT_PUBLIC_*` in client components).

## Out of scope — do not build

Captured deliberately, not forgotten: WebXR/headsets; multi-creator
signups (flag off); Stripe Connect (seam only, `stripe_account_id`); AI
skybox (`FEATURE_AI_SKYBOX` stays dormant, no service integrated); Google
Photos and iCloud APIs; manual 3D placement; a free tier; contests; NFT
sales; comments/social; video or 3D-object artworks.

The one stretch item never implemented: writing license info into XMP
metadata of served derivatives at ingest.

## Known gaps

- The public gallery page is `force-dynamic` with no streaming boundary,
  so LCP < 2.5s is unproven.
- Frame rate targets (60fps laptop / 30fps 3-year-old phone) have never
  been measured on real hardware. `scripts/seed-demo.ts` builds the
  120-piece gallery for that run.
- `enqueueOnce` is at-most-once: a crash between claiming the dedup row
  and enqueuing loses that notification. A transactional outbox would fix
  it.
- No storage backup for originals (see `docs/admin-runbook.md`, ADM-013).

## Docs

- `docs/first-deploy.md` — laptop to a private public URL, step by step
- `docs/deploy-reference.md` — full Vercel + Supabase reference
- `docs/admin-runbook.md` — operating it, plus the admin build backlog
