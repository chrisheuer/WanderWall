# First deploy — laptop to a private URL

Goal: the app running at a real URL that only you can reach, so you can
upload photos and walk a gallery before anyone else sees it.

About 30 minutes. Do it in order — Vercel needs Supabase's keys, and
Supabase needs Vercel's URL, so there is one deliberate loop back.

Deeper detail on any step is in [deploy-reference.md](deploy-reference.md).

---

## Before you start

- The code is on branch `claude/wanderwall-gallery-build-kwpxse`. There is
  no `main` yet, so that branch is what deploys.
- You need: a GitHub account with this repo, a Vercel account (Pro, for
  the every-2-minutes cron), a Supabase account.
- You do **not** need Stripe or Resend. Uploading photos and walking a
  gallery works without them.

```sh
git clone https://github.com/chrisheuer/WanderWall.git
cd WanderWall
git checkout claude/wanderwall-gallery-build-kwpxse
npm install
```

---

## Step 1 — Create the Supabase project

1. supabase.com → **New project**.
2. Name it `wanderwall`. Region: **us-east-1** (matches Vercel's default).
3. **Save the database password it generates.** It is not shown again.
4. Wait for it to finish provisioning (a couple of minutes).

> A third project in an org costs about $10/month; the first two are free.

Then collect four values — Project Settings → **API**:

- Project URL → `NEXT_PUBLIC_SUPABASE_URL`
- `anon` `public` key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `service_role` `secret` key → `SUPABASE_SERVICE_ROLE_KEY`

Project Settings → **Database** → Connection string → **Session pooler**:

```
postgresql://postgres.[REF]:[PASSWORD]@aws-0-[region].pooler.supabase.com:5432/postgres
```

→ `DATABASE_URL`

**Use the Session pooler, not the direct connection and not the transaction
pooler.** The direct one is IPv6-only and Vercel cannot reach it; the
transaction pooler (port `6543`) breaks the job queue, so photos never
finish processing. This is the single most common way this deploy goes
wrong.

---

## Step 2 — Set up the database from your laptop

Create `.env.local` in the repo (it is gitignored):

```sh
cat > .env.local <<'EOF'
NEXT_PUBLIC_SUPABASE_URL=https://YOURREF.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=paste_anon_key
SUPABASE_SERVICE_ROLE_KEY=paste_service_role_key
DATABASE_URL=paste_session_pooler_uri
STORAGE_ORIGINALS_BUCKET=originals
STORAGE_DERIVATIVES_BUCKET=derivatives
STORAGE_EXPORTS_BUCKET=exports
NEXT_PUBLIC_STORAGE_ORIGINALS_BUCKET=originals
OWNER_EMAIL=you@example.com
SIGNUPS_ENABLED=false
NEXT_PUBLIC_APP_URL=http://localhost:3000
EOF
```

Then:

```sh
npm run db:migrate                 # creates the schema
npx tsx scripts/setup-storage.ts   # creates the 3 buckets
npx tsx scripts/seed.ts            # seeds the 8 environment archetypes
```

Expect: `migrations applied successfully`, three `bucket ... ready` lines,
`seeded 8 environment archetypes`.

Optional sanity check before deploying — this runs the app locally:

```sh
npm run dev      # one terminal
npm run worker   # another terminal, or uploads never process
```

---

## Step 3 — Deploy to Vercel

1. vercel.com/new → **Import** `chrisheuer/WanderWall`.
2. It detects Next.js. Leave build settings alone.
3. Add environment variables — everything from `.env.local` above, except
   set `NEXT_PUBLIC_APP_URL` to a placeholder for now. Plus two secrets:

```
CRON_SECRET=<long random string>
OAUTH_STATE_SECRET=<a different long random string>
```

Generate them with `openssl rand -hex 32`.

`CRON_SECRET` is what lets Vercel's scheduled job drain the queue. Without
it, uploaded photos never process.

4. **Deploy.** Copy the URL it gives you, e.g.
   `https://wanderwall-xyz.vercel.app`.
5. Set `NEXT_PUBLIC_APP_URL` to that URL and **redeploy**. (This is the
   loop back — the app needs to know its own address.)

---

## Step 4 — Lock it to just you

Vercel project → Settings → **Deployment Protection** → enable **Vercel
Authentication** (Standard Protection). Now only your Vercel account can
open the URL.

Two other layers already apply:

- `SIGNUPS_ENABLED=false` means only `OWNER_EMAIL` can get an account,
  even if someone reaches the site.
- Galleries are `draft` until published, and drafts are visible only to
  their creator.

Turn Deployment Protection off when you are ready for other people.

---

## Step 5 — Point Supabase auth at the deployed URL

Supabase → **Authentication** → URL Configuration:

- **Site URL**: your Vercel URL
- **Redirect URLs**: add `https://<your-vercel-url>/auth/callback`

Without that second entry, the sign-in link bounces and you never get a
session.

Then **Authentication → Emails → Magic Link**, replace the body with:

```html
<a href="{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=email">Sign in</a>
```

This is what lets you request a link on your laptop and open it on your
phone. The default template only works in the browser that asked.

> Sign-in email comes from Supabase, not Resend, so it works with nothing
> else configured. It is rate limited to a few per hour and often lands in
> spam — check there before assuming it is broken.

---

## Step 6 — Try it

1. Open your Vercel URL. The home page should load.
2. Go to `/studio`. If anything is missing you land on `/setup`, which
   names the missing variables instead of erroring.
3. Sign in with `OWNER_EMAIL`. Check spam.
4. Create a gallery. Upload **at least 3** photos.
5. Wait up to ~2 minutes. The cron drains the queue and turns your uploads
   into WebP. Refresh — thumbnails appear.
6. Click **Preview gallery**. You are walking a draft, which needs no
   payment.

Controls: WASD or arrows to walk, drag to look, click a work to focus it,
click the floor to move there, mini-map bottom-right to teleport. **List
view** top-right is the 2D fallback. On a phone you get a thumbstick.

Under ~14 pieces you get one room. Above that it segments into chaptered
rooms with corridors between wings — upload 20+ to see that.

---

## If something is wrong

**Photos stuck at "processing"** — the queue is not draining:
- `DATABASE_URL` is the transaction pooler (`:6543`) → switch to session
  pooler (`:5432` on the pooler host), redeploy.
- `CRON_SECRET` not set → set it, redeploy.
- Vercel → your project → **Cron Jobs**: confirm `/api/queue/drain` is
  listed and running. On Hobby it only runs daily and this will not work.
- Vercel → **Logs**, filter to `/api/queue/drain`.

**`/studio` redirects to `/setup`** — it lists exactly which variables are
missing. Add them and redeploy.

**Sign-in link never arrives** — check spam; check Supabase →
Authentication → Logs; confirm the Redirect URL entry from Step 5.

**Images do not appear on the walls** — the `derivatives` bucket must be
**public**. Supabase → Storage → `derivatives` → make public.

**Build fails on Vercel** — run `npm run build` locally to see the same
error with better output.

---

## What is not set up yet

Deliberately deferred, none of it needed to test:

- **Stripe** — publishing a gallery is payment-gated, so you can preview
  drafts but not publish. Add Stripe keys and run
  `npx tsx scripts/setup-stripe.ts` when you want checkout.
- **Resend** — receipts, export links and renewal reminders. Sign-in works
  without it.
- **Google Drive / Dropbox import** — needs OAuth apps. Upload and URL
  paste work now.
- **A custom domain** — Vercel → Settings → Domains. Remember to update
  `NEXT_PUBLIC_APP_URL` and the Supabase URLs from Step 5.

## When you are ready to share it

1. Turn off Deployment Protection (Step 4).
2. Set up Stripe so galleries can actually be published.
3. Publish a gallery, or use **unlisted** — reachable by link, kept out of
   search and listings.
4. Read [admin-runbook.md](admin-runbook.md) for operating it.
