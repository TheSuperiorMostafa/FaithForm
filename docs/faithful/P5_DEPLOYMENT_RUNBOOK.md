# Prompt 5 — Deployment runbook

For `0054_faithful_publication_and_push.sql`, the notification worker, and the
APNs/FCM providers.

**None of this has been performed.** The migration has never been executed, no
provider credential exists, and no notification has ever been sent. No secret
value belongs in this document.

## 0. Dependencies

`0050` (security baseline) and `0053` (visitor identity) must both be applied
first. `0054` adds columns to `announcements` and tables that reference
`visitor_accounts`, `visitor_church_relationships`, and `church_campuses` — all
of which 0053 creates.

```bash
pnpm test:migrations
```

## 1. Inspect deployed state first

```bash
pnpm security:drift
```

Then confirm, read-only:

- `0053` is actually applied — `visitor_accounts` and
  `visitor_church_relationships` exist.
- `announcements` has `status`, `is_ready`, `published_at`, `start_at`,
  `end_at`, and `social_graphic_url`. `0054` extends this row and does not
  create it.
- `church_campuses` exists with `latitude`/`longitude` — the nearby index
  depends on them.
- None of the four new table names already exists.

The repository has known duplicate legacy prefixes (`0003`, `0010`, `0011`,
`0019`) and a documented history of partially-applied migrations, so **filename
order is not proof of deployed state.**

## 2. Rehearse

```bash
FAITHFUL_MIGRATION_DATABASE_URL=... \
FAITHFUL_MIGRATION_CONFIRM=i-understand-this-is-not-production \
pnpm db:faithful-push
```

The script refuses to run without both variables, and refuses any URL containing
"prod". It wraps the migration in a transaction and rolls back on failure.

Rehearse twice: from an empty baseline, and from a restored copy of a
representative non-production database.

**Never load production congregation, member, or device data into a rehearsal
database.**

## 3. Verify the projection is inert on arrival

Immediately after applying, confirm on a copy with real announcements:

```sql
select count(*) from announcements where mobile_visibility <> 'none';
-- must be 0
```

Applying `0054` must publish nothing. If this returns anything but zero, stop.

Also confirm every existing announcement still renders in the web dashboard, and
that Google/Facebook/email/iCloud publication still works — the mobile half is
additive and must not have disturbed them.

## 4. Verify RLS live

For each of the four new tables, exercise: account owner, staff of the same
church, staff of another church, unauthenticated, blocked visitor, revoked
relationship, and service role.

Specifically confirm:

- `visitor_device_installations` is **unreadable by `anon` and `authenticated`** —
  it holds live provider tokens.
- `claim_notification_jobs` and `complete_notification_job` are executable
  **only** by `service_role`.
- `mobile_announcement_feed` and `mobile_announcement_detail` are **not**
  executable by browsers.
- `discover_churches_nearby` **is** executable by `anon`, and returns nothing for
  a church with `is_discoverable = false`.

Race `claim_notification_jobs` from two connections and confirm they claim
disjoint sets.

## 5. Measure the queries

`EXPLAIN (ANALYZE, BUFFERS)` at production-like cardinality for:

| Query | Index it should use |
|---|---|
| `mobile_announcement_feed` | `announcements_mobile_feed_idx` |
| `discover_churches_nearby` | `church_campuses_geo_idx` |
| `claim_notification_jobs` | `notification_outbox_claimable_idx` |
| worker recipient lookup | `visitor_device_installations_deliverable_idx` |

**These indexes are unmeasured.** They were chosen against exact filters and
orderings; no plan has been run. Confirm the nearby query is a bounded index
scan and not a sequential scan with a filter — that is the whole design.

## 6. APNs

| Item | Required | Where |
|---|---|---|
| Team ID | yes | `APNS_TEAM_ID` |
| Key ID (p8 auth key) | yes | `APNS_KEY_ID` |
| p8 private key | yes | `APNS_PRIVATE_KEY` — secret store only |
| Topic (bundle id) | yes | `APNS_TOPIC` |
| Host | sandbox vs production | `APNS_HOST` |

**The server signs its own provider token.** `ApnsTokenProvider` produces the
ES256 JWT from the `.p8` key, refreshes it at 45 minutes, and re-signs when
Apple rejects it. There is no `APNS_BEARER_TOKEN` and nothing to rotate by hand.

Escaped-newline PEMs are normalised, so a key pasted from a secret store works
whether or not its newlines survived.

**Still required externally:** the Push Notifications capability on the App ID
and a registered bundle identifier. The `aps-environment` entitlement is now
declared in `Config/Faithful.entitlements` (development in the dev xcconfig,
production in the release one), but the App ID it attaches to does not exist yet
— see `P4_EXTERNAL_SETUP_RUNBOOK.md`.

## 7. FCM

| Item | Required | Where |
|---|---|---|
| Service account JSON | yes | `FCM_SERVICE_ACCOUNT_JSON` |
| *or* project / client / key | yes | `FCM_PROJECT_ID`, `FCM_CLIENT_EMAIL`, `FCM_PRIVATE_KEY` |
| Token endpoint override | no | `FCM_TOKEN_URI` |
| `google-services.json` | yes | Android app module — **not committed** |

**The server exchanges its own access token.** `FcmTokenProvider` builds the
RS256 assertion and exchanges it at `token_uri`, caching until a minute before
expiry, single-flight so a batch does not burn quota. There is no
`FCM_ACCESS_TOKEN`.

Either credential shape works, because secret stores differ in which they make
easy and a deployment that has to reshape its credential is one that will get it
wrong.

Notification channels (`faithful_announcements`, `faithful_events`) are created
by the app at first launch, before any permission is requested — creating a
channel is not a prompt and shows nothing, but a channel that does not exist
when the first notification arrives means Android silently drops it.

## 8. The worker

`GET /api/webhooks/notifications/dispatch` is implemented and **registered in
`vercel.json` on a two-minute schedule**, following the same convention as
weekly-draft, keep-alive, and receipt-retry: Bearer `CRON_SECRET`, constant-time
comparison, generic 401.

To operate it:

- Set `CRON_SECRET` in the environment. Without it the route rejects everything,
  which is the correct failure.
- Confirm the schedule suits the church's expectations; two minutes is a
  starting point, not a requirement.
- Overlapping invocations are safe — leases and `SKIP LOCKED` make concurrent
  runs claim disjoint sets — so a slow run followed by the next tick is fine.
- To drain a backlog faster, call it with `?limit=100` (the ceiling).

Monitor the response: it returns `claimed`, `sent`, `cancelled`, `retried`,
`failed`, and `durationMs`. A `durationMs` approaching 60 000 means the batch
size is too large for the function budget.

**Still external:** nothing has run this on a deployed schedule.

## 9. Deep links

`faithful://church/{slug}/announcements` works today via the custom scheme.
Universal Links and App Links still need a domain and verified well-known files
— outstanding from Prompt 4.

## 10. Smoke tests

In a deployed non-production environment, with two churches:

- Manual search with location permission **never granted**.
- Nearby with permission granted, denied, and with location services off.
- Follow, request-to-join under each of the three policies, invitation redemption.
- Publish with each visibility; confirm draft/scheduled/expired never appear.
- Publish, then edit; confirm the feed ETag changes and the stale notification is
  cancelled.
- Unpublish; confirm it disappears within the cache freshness window (5 min).
- Register a device, rotate its token, sign out, confirm the installation is
  retired and the token cleared.
- Confirm neither church sees the other's feed, preferences, or installations.
- Confirm a visitor account still cannot reach `/dashboard` in any state.

## 11. Rollback

`0054` is additive. Before any real notification data exists:

```sql
drop table if exists public.notification_delivery_attempts;
drop table if exists public.notification_outbox;
drop table if exists public.visitor_notification_preferences;
drop table if exists public.visitor_device_installations;

drop function if exists public.complete_notification_job(uuid, text, text, text, integer, timestamptz);
drop function if exists public.claim_notification_jobs(text, integer, integer, timestamptz);
drop function if exists public.mobile_announcement_detail(text, uuid, text, timestamptz);
drop function if exists public.mobile_announcement_feed(text, text, boolean, timestamptz, uuid, integer, timestamptz);
drop function if exists public.discover_churches_nearby(double precision, double precision, double precision, integer);

drop trigger if exists announcements_bump_publication_version on public.announcements;
drop function if exists public.bump_announcement_publication_version();

alter table public.announcements
  drop constraint if exists announcements_mobile_visibility_check,
  drop column if exists mobile_unpublished_at,
  drop column if exists mobile_published_at,
  drop column if exists publication_version,
  drop column if exists poster_alt_text,
  drop column if exists pinned_until,
  drop column if exists is_pinned,
  drop column if exists mobile_visibility;
```

**Prefer forward-fix once devices are registered.** Dropping
`visitor_device_installations` destroys token state that only a device can
recreate, and every affected phone would silently stop receiving notifications
until it next launched.

A faster, safer mitigation for a content problem: set
`mobile_visibility = 'none'` for the affected rows. That removes them from the
app immediately without touching schema.

**Never** roll back by altering `announcements`' pre-existing columns,
`members`, `attendance_records`, `church_users`, or anything `0050` secured.

## 12. Monitoring

Watch, with no body or token in any of it:

- outbox depth by status, and age of the oldest `pending`
- `failed` count — jobs that exhausted `max_attempts`
- `cancelled` rate — high means content is being edited after publishing
- attempts by `error_category`, especially `invalid_token` and `auth_rejected`
- `auth_rejected` spiking is a **credential problem, not a device problem** — it
  must page someone rather than being absorbed as retries

## 13. Production gates

1. Hosted CI pass of `pnpm ci:verify`, `ios:test`, `android:test`, `android:build`.
2. Both rehearsals (§2) and the inert-projection check (§3).
3. Full RLS matrix (§4) including the two-connection claim race.
4. `EXPLAIN (ANALYZE, BUFFERS)` captured for all four queries (§5).
5. APNs and FCM **credentials supplied** (§6, §7). Token issuance itself is
   implemented server-side and needs no manual step.
6. `CRON_SECRET` set so the worker route is reachable (§8).
7. Smoke tests passed with two churches (§10).
8. Product sign-off that every announcement starts `mobile_visibility = 'none'`.
9. Privacy review of the notification payload and of nearby search, including an
   updated iOS privacy manifest and Play Data Safety declaration — both must now
   describe location use.
