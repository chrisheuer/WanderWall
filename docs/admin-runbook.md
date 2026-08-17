# Admin runbook

Operating Wanderwall as the owner. Part 1 is what to do when something
happens; part 2 is the backlog for building an admin surface, because
today most of this is SQL in the Supabase editor.

Everything here assumes single-tenant launch: you are the only creator,
`SIGNUPS_ENABLED=false`, and `OWNER_EMAIL` is your account.

---

# Part 1 — Operations

## The systems you are operating

| Piece | Where it runs | Fails as |
| --- | --- | --- |
| Web app | Vercel | 500s, or `/setup` if env is missing |
| Database | Supabase Postgres | connection errors, slow queries |
| Job queue (pg-boss) | Same Postgres, drained by Vercel cron | photos stuck "processing" |
| Storage | Supabase Storage | broken images, failed uploads |
| Payments | Stripe → webhook → mirror tables | wrong tier, missing purchase |
| Email | Resend (app mail), Supabase (sign-in) | silence |

The queue is the part most likely to be the answer. When something has
"not happened", check the queue first.

## State machines

Knowing which transitions are legal saves guessing.

**Gallery** (`galleries.status`)

```
draft ──publish (payment gated)──> published ──> unlisted
  ^                                    │
  └──unpublish─────────────────────────┘
                                       │
              subscription ends ───────┴──> frozen   (exportable, reactivatable)
              download window closes ─────> readonly (last export stays available)
```

`frozen` and `readonly` are never deleted. That is a product promise, not
an implementation detail — see "Things you must not do".

**Artwork** (`artworks.ingest_status`): `pending → processing → ready | failed`

**Import run** (`import_runs.status`): `running → done | failed`

**Featured submission** (`featured_submissions.status`): `pending → approved | declined`

## Routine

**Featured submissions** — `/admin/featured`, owner-only. Approve or
decline; either sends the creator an email. Approving sets
`galleries.featured` and the gallery appears on `/featured`.

**Watch your inbox for `Duplicate creation charge`** — the app emails
`OWNER_EMAIL` when a gallery is charged the creation fee twice. That is
real money and needs a manual Stripe refund. See below.

**Cron health** — Vercel → project → Cron Jobs. Two exist:
`/api/queue/drain` every 2 minutes and `/api/billing/sweep` daily at 09:00
UTC. On Vercel Hobby, cron only runs once a day and ingest effectively
stops working.

## Triage

### Photos stuck at "processing"

The single most common symptom. In order of likelihood:

1. **`DATABASE_URL` is the transaction pooler** (`:6543`). pg-boss needs
   session-scoped state. Switch to the session pooler (`:5432` on the
   `pooler.supabase.com` host) and redeploy.
2. **`CRON_SECRET` unset** — the drain route rejects Vercel's call with
   401. Set it; Vercel sends it automatically as a Bearer token.
3. **Cron not running** — check the Vercel dashboard; Hobby caps at daily.
4. **Jobs failing** — query below.

```sql
-- What is the queue actually doing?
select name, state, count(*), max(created_on) as newest
from pgboss.job
group by name, state
order by name, state;

-- Recent failures with their error
select name, state, output, created_on
from pgboss.job
where state in ('failed', 'retry')
order by created_on desc
limit 20;
```

```sql
-- Artworks that never finished, and why
select a.id, a.title, a.ingest_status, a.ingest_error, g.title as gallery
from artworks a
join galleries g on g.id = a.gallery_id
where a.ingest_status <> 'ready'
order by a.created_at desc;
```

An artwork with `ingest_status = 'pending'` and no `original_key` means the
upload itself never completed — the browser failed before or during the
storage PUT. Delete it from the Studio and re-upload.

### A gallery froze unexpectedly

Hosting lapsed. Confirm against the mirror, then against Stripe — Stripe
is the source of truth and these tables are only a mirror.

```sql
select g.title, g.status, s.status as sub_status, s.interval,
       s.current_period_end, s.cancel_at_period_end, s.stripe_subscription_id
from galleries g
left join subscriptions s on s.gallery_id = g.id
where g.id = '<gallery id>';
```

If the subscription is active in Stripe but the gallery is frozen, the
webhook was missed. Replay the event from the Stripe dashboard
(Developers → Webhooks → the endpoint → Resend) rather than editing the
row by hand, so the mirror stays derived from Stripe.

### Duplicate creation charge

You get an email titled `Duplicate creation charge on "<gallery>" — refund
required`. The database refused the second purchase row on purpose so the
charge could not pass silently.

1. Find the session id in the email.
2. Stripe dashboard → Payments → find it → Refund.
3. No database change is needed; only one purchase row exists, which is
   correct.

### An import stalled

```sql
select id, provider, status, processed_files, total_files, error, updated_at
from import_runs
where gallery_id = '<gallery id>'
order by created_at desc;
```

`running` with an old `updated_at` means the chain broke. `failed` with an
auth message means the creator's OAuth token expired — they reconnect the
provider in Studio. Files already imported are skipped on a re-run, so
starting a new import is safe.

### Export never arrived

Check for a failed `export-build` job in the queue query above. The most
recent export is always downloadable from Studio regardless of email, so
point the creator there while you investigate.

### Sign-in link not arriving

Sign-in mail is sent by **Supabase**, not Resend. Supabase's built-in SMTP
is rate limited to a few messages per hour and lands in spam often. Check
Supabase → Authentication → Logs. For anything beyond testing, configure
custom SMTP in Supabase.

## Useful queries

```sql
-- Everything at a glance
select status, tier, count(*) from galleries group by status, tier;

-- Donations this month
select count(*), sum(amount_cents)/100.0 as dollars
from donations
where created_at >= date_trunc('month', now());

-- Visitors for a gallery
select count(*) as visits,
       count(distinct visitor_hash) as uniques,
       round(avg(duration_seconds)) as avg_seconds
from gallery_visits
where gallery_id = '<gallery id>';

-- Download galleries whose edit window is closing
select title, slug, edit_window_expires_at
from galleries
where tier = 'download' and edit_window_expires_at > now()
order by edit_window_expires_at;

-- Was a notification actually sent?
select dedupe_key, sent_at from notification_log
order by sent_at desc limit 50;
```

## Things you must not do

These are product promises encoded in the app. Breaking them by hand in
SQL breaks the promise.

- **Never delete a gallery to resolve a billing problem.** Frozen and
  readonly galleries stay exportable and reactivatable forever. The delete
  endpoint already refuses a gallery with live hosting.
- **Never edit `purchases` or `subscriptions` directly.** They are a
  webhook-driven mirror of Stripe. Fix the problem in Stripe and replay
  the event.
- **Never set a Creative Commons license on a creator's behalf.** CC is
  opt-in per the licensing model.
- **Do not add copy-protection.** Right-click blocking and similar theater
  are deliberately absent; CC is legal signaling, not DRM.

## Recovery

- **Database**: Supabase takes automatic daily backups (retention depends
  on plan). Point-in-time recovery is a paid add-on — worth enabling
  before real creators exist.
- **Storage**: originals are the irreplaceable part. Derivatives can be
  regenerated by re-running ingest; originals cannot be recovered if
  deleted. There is no storage backup today — see ADM-013.
- **Rollback**: Vercel keeps every deployment. Promote a previous one from
  the dashboard. Note that a rollback does *not* revert database
  migrations; treat migrations as forward-only.

---

# Part 2 — Admin backlog

What exists today: one page, `/admin/featured`, gated on
`isOwner(creator)`. Everything else in Part 1 is SQL. These stories cover
building an admin surface for the features that already ship.

Format: each story has an ID, a priority, the acceptance criteria, and
pointers to what already exists so the work is assembly rather than
invention.

Priorities: **P1** removes SQL from an operation you will do weekly.
**P2** is real but survivable manually. **P3** is for when there is more
than one creator.

---

### ADM-001 — Admin home with system health · P1

**As** the owner **I want** one page showing whether the system is healthy
**so that** I can answer "is anything broken" without writing queries.

Acceptance criteria:
- Route `/admin`, owner-only, linked from Studio when `isOwner`.
- Shows counts by gallery status and tier; artworks not `ready`; import
  runs not `done`; queue jobs by state; failed jobs in the last 24h.
- Each number links to the relevant detail view.
- A red banner when any of: jobs in `failed`, artworks stuck `pending`
  older than 15 minutes, or an import `running` with `updated_at` older
  than 15 minutes.

Build on: `src/lib/auth.ts` (`isOwner`), `src/app/admin/featured/page.tsx`
for the access pattern, the queries in Part 1.

---

### ADM-002 — Queue monitor with retry · P1

**As** the owner **I want** to see and retry queue jobs **so that** a
transient failure does not need a database session.

Acceptance criteria:
- Lists jobs from `pgboss.job` grouped by queue name and state, newest
  first, with the failure output visible.
- "Retry" re-enqueues a failed job with the same payload.
- "Drain now" triggers `/api/queue/drain` manually rather than waiting for
  cron.
- Retry and drain are POSTs with owner auth, never GETs.

Build on: `src/lib/queue.ts` (`QUEUES`, `enqueue`), `src/jobs/registry.ts`
(`drainOnce`), `src/app/api/queue/drain/route.ts`.

Note: the drain route authenticates with `CRON_SECRET`. Add an
owner-authenticated path rather than exposing that secret to the browser.

---

### ADM-003 — Ingest failure triage · P1

**As** the owner **I want** to see every artwork that failed to process
and retry it **so that** a creator is not stuck with a broken piece.

Acceptance criteria:
- Lists artworks where `ingest_status` is `failed` or has been `pending`
  more than 15 minutes, with `ingest_error`, gallery, and creator.
- "Reprocess" re-enqueues the ingest job for that artwork.
- Distinguishes "never uploaded" (`original_key` is null) from "processing
  failed", because the fixes differ.

Build on: `src/jobs/ingest.ts` (`runIngestJob` is idempotent — it returns
early when already `ready`), `QUEUES.ingest`.

---

### ADM-004 — Billing overview · P2

**As** the owner **I want** subscriptions, purchases and their gallery in
one table **so that** I can answer a billing question without Stripe and
SQL side by side.

Acceptance criteria:
- Lists every subscription with status, interval, period end,
  `cancel_at_period_end`, gallery, creator.
- Lists purchases with kind and amount.
- Deep-links each row to the object in the Stripe dashboard.
- Flags mismatches: an active subscription whose gallery is `frozen`, or a
  published gallery with no active subscription.
- **Read-only.** Mutations go through Stripe so the mirror stays derived.

Build on: `src/lib/billing.ts`, `subscriptions` / `purchases` tables.

---

### ADM-005 — Refund queue for duplicate charges · P2

**As** the owner **I want** duplicate creation charges listed **so that**
a refund is not dependent on me reading an email.

Acceptance criteria:
- Lists detected duplicate charges with gallery, creator, amount, Stripe
  session id, and detection time.
- Each row deep-links to the Stripe payment.
- Mark-as-refunded records who resolved it and when.

Build on: `recordCreationPurchase` in
`src/app/api/webhooks/stripe/route.ts` — it currently logs and emails on
the `purchases_one_creation_per_gallery_idx` violation. This story adds a
table to persist those events; the detection already works.

---

### ADM-006 — Gallery detail and moderation · P2

**As** the owner **I want** to inspect any gallery and unpublish it
**so that** I can respond to a takedown or a content complaint.

Acceptance criteria:
- Detail view: status, tier, creator, piece count, rooms, visits,
  donations, subscription, export history.
- "Unpublish" sets `draft` and records a reason.
- Every moderation action is written to an audit log (ADM-012).
- Unpublishing does **not** cancel billing or delete anything.

Note: the public page already hides non-public galleries from everyone but
their creator, so unpublishing is sufficient for takedown.

---

### ADM-007 — Import run monitor · P2

**As** the owner **I want** to see cloud import runs and restart them
**so that** a stalled import is recoverable.

Acceptance criteria:
- Lists runs with provider, status, `processed_files`, error, timestamps.
- "Resume" re-enqueues `import-chunk` for a `running` run from its stored
  cursor.
- Shows which files were skipped and why.

Build on: `src/jobs/import-chunk.ts`, `import_runs`. Re-running is safe:
the unique `(gallery_id, source_ref)` index makes re-import a no-op for
files already present.

---

### ADM-008 — Manual state override · P2

**As** the owner **I want** to unfreeze a gallery or extend a download
edit window **so that** I can make a customer whole after our mistake.

Acceptance criteria:
- Unfreeze a `frozen` gallery back to `draft`.
- Extend `edit_window_expires_at` by a chosen number of days.
- Both require a typed reason and write to the audit log.
- Both are clearly labelled as goodwill overrides, not billing changes —
  they do not create a subscription.

---

### ADM-009 — Donations ledger · P3

**As** the owner **I want** donations listed with donor name and message
**so that** creators can thank supporters.

Acceptance criteria:
- Table of donations with gallery, amount, donor name, message, date.
- Filter by gallery and date range; CSV export.
- Monthly totals.

---

### ADM-010 — Creator directory · P3

**As** the owner **I want** a list of creators **so that** multi-creator
operation is possible.

Acceptance criteria:
- Lists creators with email, display name, gallery count, Stripe customer,
  join date.
- Detail view links to their galleries and billing.
- Prerequisite for flipping `SIGNUPS_ENABLED=true`.

---

### ADM-011 — Featured program improvements · P3

**As** the owner **I want** to curate the featured index **so that** it
reads as edited rather than chronological.

Acceptance criteria:
- Reorder featured galleries; `/featured` respects the order.
- Choose which artwork is the hero image instead of always the first.
- Un-feature without declining a submission.

Build on: existing `/admin/featured` and `galleries.featured`.

---

### ADM-012 — Admin audit log · P2

**As** the owner **I want** every admin action recorded **so that**
consequential changes are attributable.

Acceptance criteria:
- New table: actor, action, target type and id, reason, timestamp,
  before/after where meaningful.
- Written by every mutating admin action (ADM-005, 006, 008, 011).
- Viewable and filterable; append-only, never editable from the UI.

Do this before ADM-006 and ADM-008 ship, so overrides are never
unattributable.

---

### ADM-013 — Storage backup and orphan cleanup · P2

**As** the owner **I want** originals backed up and orphaned objects
removed **so that** an accident is survivable and storage cost stays
proportional.

Acceptance criteria:
- Scheduled job copying the originals bucket to separate storage.
- Report of storage objects with no matching database row, and of database
  rows whose objects are missing.
- Deletion is a two-step confirm, never automatic.

Note: derivatives are reproducible from originals; originals are not
reproducible from anything. This is the highest-value story here that has
nothing to do with the UI.

---

### ADM-014 — Real admin access control · P3

**As** the owner **I want** admin rights to be a role rather than an email
comparison **so that** someone else can help operate this.

Acceptance criteria:
- `creators.role` (`owner` | `admin` | `creator`), defaulting to `creator`.
- `isOwner` becomes a role check; `OWNER_EMAIL` bootstraps the first owner
  only.
- Middleware enforces the role for `/admin/*` rather than each page
  enforcing it individually.

Note: today `src/middleware.ts` only checks that *someone* is signed in
for `/admin`; each admin page re-checks `isOwner` itself. That is correct
but easy to forget on a new page — this story removes the footgun.

---

## Suggested order

1. **ADM-012** (audit log) — cheap, and everything mutating depends on it.
2. **ADM-001, ADM-002, ADM-003** — the P1 set; removes the SQL you would
   otherwise run weekly.
3. **ADM-013** (backups) — do this before real creators trust you.
4. **ADM-004, ADM-005** — billing visibility and refunds.
5. Everything else as multi-creator approaches.
