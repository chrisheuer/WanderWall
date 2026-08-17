# Deploying to Vercel + Supabase

Written to be followable from a phone browser. Order matters: Supabase
first, because Vercel needs its keys.

## 1. Create the Supabase project

supabase.com → New project. Name it whatever you like; pick a region near
Vercel's default (`us-east-1` / N. Virginia is a good match). Save the
database password it generates — you need it for `DATABASE_URL` and it is
not shown again.

### Get the right connection string

Project Settings → Database → Connection string. **Use the Session pooler
URI**, not the direct one:

```
postgresql://postgres.[REF]:[PASSWORD]@aws-0-[region].pooler.supabase.com:5432/postgres
```

This matters more than it looks:

- The **direct** connection (`db.[REF].supabase.co:5432`) is IPv6-only
  without a paid add-on, and Vercel's functions generally can't reach it.
- The **transaction** pooler (port `6543`) breaks the job queue. pg-boss
  relies on session-scoped state that transaction pooling discards, so
  ingest jobs fail in ways that are tedious to diagnose.
- The **session** pooler (port `5432` on the `pooler.supabase.com` host)
  is IPv4 and keeps session semantics. Use this one.

### Auth settings (or sign-in silently fails)

Authentication → URL Configuration:

- **Site URL**: your Vercel URL, e.g. `https://wanderwall.vercel.app`
- **Redirect URLs**: add `https://<your-vercel-url>/auth/callback`

Without the redirect entry the magic link bounces and you never get a
session.

Authentication → Emails → **Magic Link** template. To sign in on a
different device than you requested the link on — request on a laptop,
tap on your phone — the link must carry a token hash:

```html
<a href="{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=email">Sign in</a>
```

The default template sends a PKCE `code`, which only works in the browser
that asked for it. The callback accepts both, so same-device sign-in works
either way — but cross-device needs this.

Supabase's built-in email service sends these, so **you do not need Resend
to sign in**. It is rate limited to a few messages an hour and can land in
spam; Resend is only for the app's own mail (receipts, export links,
renewal reminders).

## 2. Apply the schema

From a machine with the repo (or ask Claude, which can do this over the
Supabase MCP connection once the project exists):

```sh
DATABASE_URL="<session pooler URI>" npm run db:migrate
DATABASE_URL="<session pooler URI>" npx tsx scripts/seed.ts
```

### Storage buckets

`scripts/setup-storage.ts` creates all three with the right visibility:

```sh
npx tsx scripts/setup-storage.ts   # needs the Supabase env vars set
```

Or by hand in Storage → New bucket:

| Bucket        | Public | Why                                        |
| ------------- | ------ | ------------------------------------------ |
| `originals`   | No     | Your uploaded files; served via signed URLs |
| `derivatives` | **Yes** | The WebP versions the gallery displays     |
| `exports`     | No     | Static export zips; signed links only       |

`derivatives` must be public or artwork will not load on the wall.

## 3. Deploy on Vercel

vercel.com/new → import `chrisheuer/WanderWall`.

The repo currently has one branch and no `main`, so Vercel will build
`claude/wanderwall-gallery-build-kwpxse`. That is fine for testing. If you
merge to `main` later, set Production Branch accordingly.

Framework preset is detected as Next.js; leave build settings alone.

### Environment variables

Minimum to sign in, upload photos, and walk a gallery. Stripe, Resend,
Google and Dropbox are **not** needed for that.

```
NEXT_PUBLIC_APP_URL=https://<your-vercel-url>
SIGNUPS_ENABLED=false
OWNER_EMAIL=<the email you will sign in with>

NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key>
SUPABASE_SERVICE_ROLE_KEY=<service_role key>
DATABASE_URL=<session pooler URI>

STORAGE_ORIGINALS_BUCKET=originals
STORAGE_DERIVATIVES_BUCKET=derivatives
STORAGE_EXPORTS_BUCKET=exports
NEXT_PUBLIC_STORAGE_ORIGINALS_BUCKET=originals

CRON_SECRET=<any long random string>
OAUTH_STATE_SECRET=<a different long random string>
```

`NEXT_PUBLIC_APP_URL` is a chicken-and-egg: deploy once, copy the URL
Vercel assigns, set the variable, redeploy.

`CRON_SECRET` is what protects the queue drain — Vercel automatically
sends it as `Authorization: Bearer <CRON_SECRET>` on scheduled runs, and
the route rejects anything else. Set it or ingest never runs.

Add the rest (Stripe, Resend, cloud imports) only when you want to
exercise checkout, transactional email, or folder imports.

## 4. Check it worked

1. Visit `/` — should render immediately.
2. Visit `/studio`. If something is missing you land on `/setup`, which
   names the variables it can't find rather than throwing a 500.
3. Sign in with `OWNER_EMAIL`. Only that address gets an account while
   `SIGNUPS_ENABLED=false`.
4. Create a gallery, upload 3+ photos.
5. Wait up to ~2 minutes — the cron drains the queue on that interval and
   turns your uploads into WebP derivatives. Refresh; thumbnails appear.
6. Hit **Preview gallery**. A draft is visible to its creator, so you can
   walk it without paying anything. Publishing is what's payment-gated.

### If photos stay at "processing"

That is the queue not draining. In order of likelihood:

- `DATABASE_URL` is the transaction pooler (`:6543`) — switch to session
  pooler (`:5432` on the pooler host).
- `CRON_SECRET` is unset, so the drain route rejects Vercel's call.
- Cron isn't running: Vercel dashboard → your project → Cron Jobs. On
  Hobby, cron is capped at once per day and `*/2 * * * *` won't run as
  written; Pro runs it as configured.
- Check Vercel → Logs, filtered to `/api/queue/drain`.

## 5. Costs

- **Supabase**: free tier covers 2 projects per org. A third is ~$10/mo.
- **Vercel**: Hobby is free but caps cron at daily, which breaks ingest as
  configured. Pro runs it every 2 minutes.
- **Stripe / Resend**: free to set up; not needed to test uploads.
