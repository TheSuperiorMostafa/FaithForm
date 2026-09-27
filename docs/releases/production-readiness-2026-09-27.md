# Production readiness gate — 2026-09-27

FaithForm already serves four churches. This release closes a direct staff-data
authorization gap and fixes failing release checks. It has **not** been deployed
by this branch. A green build alone does not authorize a claim of production
readiness.

## Verified in an isolated checkout

- Web: typecheck, lint (zero errors), production build, 1,755 application tests,
  generated-contract/design/localization checks, migration baseline check,
  secret scan, and feature-guard scan pass.
- Database: all 112 migrations apply to a disposable PostgreSQL database; all
  41 database tests pass, including cross-church and per-feature denial probes.
- Native: iOS Swift build and the Android unit suite across debug, staging, and
  release variants pass. Device/provider end-to-end tests remain separate.
- Dependencies: no unresolved high or critical production advisories. Two high
  `image-size` advisories are covered by the repository's reviewed lockfile patch.
- Live read-only signals: the latest Vercel production deployment was marked
  Ready; the public mobile health endpoint returned HTTP 200; the production
  error-log query found no 5xx entries in its last 24-hour window. These are
  point-in-time checks, not an uptime or alerting guarantee.
- The current Vercel variable inventory lists Supabase, Stripe/webhook, APNs,
  relay, and donor-session keys. It does not list the `FCM_*` values required by
  this app's Android push adapter. Presence of a variable does not prove that
  its provider accepts it.
- The existing read-only dashboard benchmark against the matching Supabase
  project measured median query times of 121–285 ms for the newer query shapes
  in its sample. This is a small sample, not a concurrent-load result.

## Release sequence for migration 0110

1. Capture the current deployment and database migration state. Confirm a
   recoverable backup by restoring it to a separate environment and checking
   tenant counts and critical records. Do not restore over live data.
2. Deploy the application changes first. The new server code can read medical
   notes and call aggregates after the database policy tightens. The old server
   code cannot read some of those fields after 0110.
3. Smoke test sign-in and the existing workflows for each of the four churches:
   Home, People care details, Kids Check-in roster, Reports PDF, Giving, Calls,
   Church App editing, and any enabled provider integration. Check both admin
   and limited staff accounts, plus a disabled-feature account.
4. Apply `0110_feature_scoped_sensitive_reads.sql` once through the controlled
   migration process. Verify its recorded checksum and inspect the resulting
   policies and column grants. Do not edit an already applied migration.
5. Repeat the same workflow checks. A staff session without Giving, Calls,
   People, or Check-in must be denied direct reads of those areas; an attendance
   session must not be able to select `members.medical_notes`. A staff session
   must not read a second church's records.
6. Watch request errors, latency, webhook failures, and queued jobs during a
   small rollout. Keep lead outreach phased until these checks have held under
   normal Sunday and weekday traffic.

If a page fails after 0110, fix or roll forward the server code. Reverting only
the application to a version that selects `medical_notes` through the staff
client will break that page. Re-granting direct medical access or permissive
financial/call policies is not a safe rollback.

## Gates still requiring live evidence

- Backup retention and a successful restore test, with an owner and recovery
  time target.
- Deployed migration history and policy/grant inspection. The local credentials
  permit read-only API queries, but no direct production SQL connection was
  available for this check.
- A representative controlled rollout with real accounts from all four
  churches, including payment/webhook, email/SMS, push, attendance, and media
  paths that those churches actively use.
- Configure and verify Android push if it is among the enabled church
  workflows; the current production variable inventory has no `FCM_*` keys.
- Monitoring with an accountable recipient for application errors, provider
  delivery failures, slow requests, and database/storage capacity. Repository
  code and Vercel's recent logs alone do not prove alert delivery.
- Concurrent-load and recovery tests against a nonproduction copy containing
  representative church data. The read-only live benchmark is not a load test.

Release decision: **code hardening is reviewable; a production-ready declaration
and broad lead onboarding remain gated on the live evidence above.**
