# Production readiness gate — 2026-09-27

FaithForm already serves four churches. This release closes a direct staff-data
authorization gap and fixes failing release checks. It has **not** been deployed
by this branch. A green build alone does not authorize a claim of production
readiness.

## Verified in an isolated checkout

- Web: typecheck, lint (zero errors), production build, 1,785 application tests,
  generated-contract/design/localization checks, migration baseline check,
  secret scan, and feature-guard scan pass.
- Database: the earlier 113 migrations applied to disposable PostgreSQL 15 and
  17; the current 118-migration chain passed a fresh PostgreSQL 17
  migration rehearsal. All 45 database tests pass, including
  cross-church, per-feature,
  and view-access denial probes. The additive
  `0111_announcement_status_view_invoker.sql` migration resolves the live
  Security Advisor's SECURITY DEFINER view finding. It is local only.
- A full custom-format PostgreSQL backup and restore rehearsal passed on a
  disposable PostgreSQL 17 server with four synthetic churches. Restored record
  fingerprints, RLS, view settings, and medical-note grants matched the source.
  Run it with `pnpm test:backup-restore`, `FAITHFORM_DB_TARGET=disposable`, and
  a loopback-only `FAITHFORM_TEST_DATABASE_URL`, with PostgreSQL 17 client tools
  first on `PATH`. This does not validate
  Supabase's production physical backups or Storage object recovery.
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
- Platform admin totals, church list counts and last activity, and analytics
  now use server-role-only PostgreSQL aggregates in migration 0112. This removes
  the silent 1,000-row truncation from those reports. Admin user listing and
  the temporary pre-migration fallback page through all rows. The updated web
  build and all 1,757 application tests pass.

## Local 100-church rehearsal

- A disposable Docker PostgreSQL 17.6 database restored the approved production
  archive, then accepted migration 0112. The test added 96 synthetic churches
  to the four restored churches, with 12 staff memberships, 20 sermons, 20
  successful gifts, 20 activity records, and 30 days of daily usage per new
  church. This crossed 1,000 rows in the tables whose admin reports had been
  truncated.
- The server-role aggregates returned exact totals: 100 churches, 14,088
  saved minutes, 1,970,604 cents in successful gifts, 20,999,872 dashboard
  seconds, and 100 active churches. All 96 synthetic churches had the expected
  12 users, 20 sermons, and a last-activity time. Analytics counted all 1,920
  synthetic sermons and 1,920 synthetic activity records. `anon` and
  `authenticated` cannot execute these aggregate functions.
- A bounded, read-only 15-second database check with 20 concurrent clients
  completed 11,107 transactions with zero failures, averaging 27 ms per
  transaction. Each transaction called all three aggregate functions. This
  checks the local database implementation; it does not measure Vercel,
  hosted Supabase resources, API behavior, providers, or Sunday user traffic.
- The local catch-up migration 0113 applied transactionally to the restored
  production schema with all 100 churches intact. A rollback-only insert of a
  group-chat notification and a church domain request succeeded; neither test
  row remained afterward. Anonymous and authenticated roles cannot execute the
  new church-app projection functions, while the server role can.
- Migration 0114 makes a group meeting edit, its existing attendance window,
  and its audit event one transaction. All 116 migrations and 43 Groups and
  security database tests passed in a fresh disposable local database. A
  deliberately failed occurrence update rolled back the meeting edit; a saved
  zero-attendee attendance record prevented the meeting time from changing.
  Browser roles cannot call the new function. A separate disposable restore of
  the approved production archive, excluding unrelated Supabase Vault and
  Realtime platform objects that the local container cannot restore, accepted
  migration 0114; all four churches remained and `anon` lacked execute access.
  That restored copy was removed. This fix has not been deployed.
- Migration 0115 makes the final church onboarding step one transaction:
  administrator membership, church completion, and invite acceptance either
  all persist or all roll back. All 117 migrations and 44 database tests pass
  in a fresh disposable database. A deliberately failed invite update left no
  administrator or completed church. The service role can execute the function;
  browser roles cannot. The approved production archive also accepted both
  migrations in a disposable local restore with four churches intact. This
  fix has not been deployed or browser rehearsed.
- Invite resend no longer deletes the existing link before sending. An
  unexpired invite is resent as-is; an expired invite gets a new row while the
  expired one remains unusable. If the email provider fails, the current valid
  link can be resent again. This change is local and still needs a provider
  delivery rehearsal after release.
- The local group attendance form now refuses to open if its roster, saved
  counts, or People labels fail to load, or if the API returns fewer rows than
  the database counted. This prevents a partial view from being saved as a
  correction that marks unseen people absent. Saving also stops if a selected
  member has left the group since the form opened. A disposable restore of the
  approved production archive had one group with one active member, so no
  archived church hits the current row limit. Groups with rosters larger than
  the API response limit receive a clear support message; batched attendance
  for such groups remains a capacity decision before selling to churches that
  need it.
- Kids Check-in roster, dependent list, family pickup records, household
  directory, and room attendance reports now read in counted 500-row pages.
  The service attendance roster uses the same complete-read guard. If a page
  fails, repeats, or stops early, the check-in and pickup paths report failure
  instead of treating the missing people as absent. The change passed 1,785
  application tests, typecheck, targeted lint, and a local production build.
  The helper caps an individual read at 10,000 rows and reports larger results
  as an error; a server-side aggregate or narrower filter will be needed for
  any church that reaches that limit. Hosted load at that size is untested.
- Migration 0116 releases all selected children in one database transaction.
  It locks the selected sessions, checks that every child is still present and
  belongs to one family, verifies child and pickup-person eligibility, and
  requires all updates to succeed. A forced failure on the second child left
  both children checked in. The disposable PostgreSQL 17 full migration chain
  and all 45 database tests pass. The approved production archive also restored
  into a disposable local PostgreSQL 17.6 database, accepted 0116, and showed
  four churches, 18 check-in sessions, and the installed function. That copy
  was removed. The updated web action calls this function, so 0116 must be
  applied before that web build is deployed. Neither change is live yet.
- Room deletion now requires all three exact usage counts to succeed. A failed
  count returns a retry message, so a room with history cannot look unused
  merely because its database read failed. Typecheck, targeted lint, and the
  55 focused Check-in tests pass. This change is local only.

## Live production findings on 2026-09-27 (read-only)

- Supabase shows completed daily physical backups from September 20 through 27;
  the newest is September 27 at 09:14:41 UTC. Point-in-time recovery is off.
  Daily recovery can lose almost a day's changes, depending on failure time.
  The dashboard explicitly excludes Storage objects from database backups.
- Production Storage currently lists 342 objects across nine nonempty buckets,
  with about 484 MB in recorded object sizes. These include stream recordings,
  church images, and an attachment. The database backup does not preserve
  those object bytes.
- All 342 production Storage objects were downloaded one at a time to the
  private, Git-ignored local directory `.env.storage-backup-2026-09-27.local`.
  The manifest records bucket, object path, length, and SHA-256 for each file.
  An independent check verified all 484,402,097 bytes, and a disposable local
  reconstruction recreated every bucket/path and matched every hash before
  that reconstruction was removed. No file was uploaded to Supabase. This
  proves the local copy is complete and readable, but not that a provider-side
  Storage restore has been rehearsed.
- A read-only logical dump of the production database was saved locally at
  10:43 EDT as `.env.backup-2026-09-27.dump.local` (1,653,245 bytes, mode 0600,
  Git-ignored). Its adjacent `.env.backup-2026-09-27.sha256.local` checksum file
  verified. The approved restore into disposable PostgreSQL 17 succeeded after
  excluding ten Supabase Vault archive entries because that extension is not
  installed locally; production has zero Vault secret rows. Seven aggregate
  counts matched the live database exactly at verification: 4 churches, 14
  auth users, 109 members, 11 announcements, 6 donations, 50 calls, and 342
  Storage metadata rows. The restored local database and temporary logs were
  deleted. The local archive remains; it is on the same computer, not an
  independent offsite backup.
- A second rehearsal restored the complete archive, including access grants and
  the Supabase Vault extension, into a disposable Docker container running the
  same PostgreSQL 17.6 version as production. A placeholder
  `supabase_realtime_admin` role was needed for the archived grants in this
  isolated image. Before the local migrations, the restored `anon` role saw
  11 announcement rows through the status view and zero through its base table,
  matching the live finding; `authenticated` could select medical notes.
  Migrations 0110 and 0111 applied together without error. Afterward, both
  anonymous announcement counts were zero, the medical-note grant was gone,
  and the six core record counts above were unchanged. A rollback-only viewer
  simulation with no feature permissions saw zero Giving and People rows. With
  both permissions it saw five gifts and ten members in its own church, zero
  from other churches, and no medical-note access. The disposable container
  and its copy of the production data were removed after verification.
- FileVault is enabled on the Mac holding these archives. Time Machine reports
  no configured destination, so neither local archive currently has an
  independent backup location. Copying them elsewhere requires an approved
  destination that protects the church and member data.
- Supabase's managed physical-backup restore remains **untested**. The offered
  restore-to-new-project path would incur an estimated $10.18/month while it
  exists and copy church data; the owner declined creating that project. The
  dashboard has no download action for those physical backups. No live restore
  was attempted.
- The production database is PostgreSQL 17.6. It has no
  `supabase_migrations.faithform_source_migrations` table, so the local versioned
  migration ledger cannot establish which source SQL files were applied there.
  A schema-object comparison between the restored production archive and a
  fresh source-migration database found partially applied older migrations.
  Production lacks three high-use indexes, follow-up and Facebook schedule
  columns, church-app links and two projections, group notification targeting,
  and the domain-request queue and provisioning fields. Migration 0113 adds
  these active objects without replaying old data-changing migrations. The
  source-only `attendance`, `church_metrics`, and `weekly_inputs` legacy tables
  are still absent; only an unreferenced `saveWeeklyInputs` action uses the last
  one. `pgcrypto` functions live in a different extension schema and are not an
  application-table discrepancy. Do not replay the full local chain onto
  production. Confirm the live schema against this reconciliation immediately
  before rollout.
- Supabase production currently uses Micro shared compute (1 GB). At the
  point-in-time infrastructure check, CPU was 2%, RAM 44%, and connections
  17/60; the seven-day compute chart showed CPU 4%, memory 46%, and disk I/O
  1%. These baseline numbers do not predict 100-church concurrent load. Vercel
  is on Pro, which supports the repository's minute cron schedules. Delivery
  alert routing and provider quotas still need an operational check.
- The live select policies on Giving, Calls, Members, and the household and
  check-in tables currently restrict by church membership, but not by the
  staff member's feature permissions. The `authenticated` role also currently
  has SELECT privilege on `members.medical_notes`. Migration 0110 and its
  matching server changes address this; they have not reached production.
  `anon` has a table-level SELECT grant too, but row policies still apply; this
  audit did not establish anonymous access to member rows.
- The announcement status view currently lacks `security_invoker=true`, is
  owned by `postgres`, and grants SELECT to both `anon` and `authenticated`.
  Its base table has RLS, but the view owner can bypass that policy. A read-only
  anonymous API HEAD request counted 11 rows through the view, while the same
  request to the base `announcements` table counted zero. This confirms a
  publicly reachable RLS bypass. This audit did not retrieve any announcement
  content or establish whether the path has been used. The local 0111 migration
  makes the view honor caller privileges and row policies. This matches
  Security Advisor's one
  error. It also listed 32 warnings; Performance Advisor listed 14 warnings;
  Health Advisor listed no errors or warnings. These counts are point-in-time
  advisor results.

## Release sequence for migrations 0110 through 0116

1. Capture the current deployment and database migration state. Reconcile the
   deployed schema and source migration history. Confirm a recoverable backup
   by restoring it to a separate environment and checking tenant counts and
   critical records, including Storage objects through a separate process.
   Do not restore over live data.
2. Apply `0114_group_gathering_atomic_update.sql`,
   `0115_atomic_onboarding_completion.sql`, and
   `0116_atomic_child_checkout.sql` before deploying the updated
   application: the new meeting, onboarding, and child pickup saves call these server-only
   functions and cannot work until they exist. The currently deployed code
   does not call them. Then deploy the application changes before the
   policy-tightening migrations. The new server code can read medical notes
   and call aggregates after the database policy tightens. The admin aggregate
   calls paginate safely until 0112 arrives. The old server code cannot read
   some fields after 0110.
3. Smoke test sign-in and the existing workflows for each of the four churches:
   Home, People care details, Kids Check-in roster, Reports PDF, Giving, Calls,
   Church App editing, and any enabled provider integration. Check both admin
   and limited staff accounts, plus a disabled-feature account.
4. Apply `0110_feature_scoped_sensitive_reads.sql`,
   `0111_announcement_status_view_invoker.sql`, and
   `0112_platform_admin_aggregates.sql`, and
   `0113_active_schema_catchup.sql` once through the controlled migration
   process. Verify their recorded checksums and inspect the resulting policies,
   column grants, view options, and aggregate function privileges. Confirm
   0114, 0115, and 0116's server-only execute grants. Do not edit an already applied
   migration.
5. Repeat the same workflow checks. A staff session without Giving, Calls,
   People, or Check-in must be denied direct reads of those areas; an attendance
   session must not be able to select `members.medical_notes`. A staff session
   must not read a second church's records. Run
   `pnpm security:anonymous-announcements` with the production Supabase URL and
   public key; both anonymous counts must be zero. Verify platform admin totals
   and church/user lists against direct database aggregates.
6. Watch request errors, latency, webhook failures, and queued jobs during a
   small rollout. Keep lead outreach phased until these checks have held under
   normal Sunday and weekday traffic.

If a page fails after 0110, fix or roll forward the server code. Reverting only
the application to a version that selects `medical_notes` through the staff
client will break that page. Re-granting direct medical access or permissive
financial/call policies is not a safe rollback.

## Admission plan for 100 churches

The local 100-tenant data set validates database query correctness, not a
100-tenant service-level commitment. Before lead outreach, record expected
staff and member counts per church, peak simultaneous staff sessions, daily
sermons, gifts, messages, uploads, and push sends. Use those numbers to run a
hosted, nonproduction load test through sign-in, dashboard, People, Giving,
announcements, and the mobile API. Include provider sandbox callbacks and
background workers, then compare request latency, error rate, queue age,
database connections, CPU, RAM, and Storage growth with the four-church
baseline. Set alert thresholds and an owner before opening each wave.

Enroll in waves, for example 4 existing churches, then 10, 25, 50, and 100.
At each wave, verify the existing churches again, review failed webhooks and
delivery queues, and hold the next wave if error rates, latency, recovery, or
support response exceed the limits agreed with the owner. Increase database
compute or provider quotas based on measured headroom before the next wave;
the current Micro plan's point-in-time utilization cannot justify 100 churches
on its own.

## Gates still requiring live evidence

- The live browser onboarding pass created a fifth, clearly labeled QA church
  with synthetic members and verified People, household, Check-in, Attendance,
  Groups, Announcements, Sermons, Church App, Website, Live scheduling, and
  settings. Details and limitations are in
  `docs/releases/onboarding-browser-pass-2026-09-27.md`. The first-admin
  invitation and Gmail delivery passed; the owner completed the password and
  second email confirmation, Steps 3–6 saved a synthetic profile and finished,
  and the resulting church-admin session sent and reloaded a group chat
  message. Optional external provider connections were skipped.
- The browser pass found a live expired-impersonation transition that can show
  the old QA banner over the platform admin's own church page. A local guard
  now redirects expired switches before dashboard requests or actions run;
  this requires deployment and a timed browser retest. It also found the live
  announcement takedown fallback losing its recovery timestamp when the
  Facebook schedule column is absent; a local fix requires rollout and a
  recovery decision for affected rows. The production Church App lacks the
  `app_links` column until migration 0113 is applied.
- Group meeting edits still write the event and its attendance window in two
  database operations. Local code now detects failed attendance checks and
  incomplete window updates, but an interrupted write can still leave those
  records out of sync. Make that update transactional and rehearse a failure
  before calling this path fully reliable.
- Onboarding currently sends a redundant second confirmation email after the
  church invite. A local one-email account-creation change is ready for a new
  tenant rehearsal after rollout. Step 6 also needs the local checked-write
  ordering fix before onboarding more churches; the current live order can
  close an invite before creating the church-admin membership.
- Google showed an unverified-app warning before the QA church could connect
  the owner's Gmail. The owner reports that Google verification has already
  been requested; approval and a successful consent/connection test have not
  been observed. Keep this separate from FaithForm's redundant onboarding
  email. The requested Gmail compose scope can also send mail, so review the
  scope disclosure and approval status before offering Google connections to
  new churches. See Google's
  [Gmail scope descriptions](https://developers.google.com/workspace/gmail/api/auth/scopes).
- A successful Supabase physical-backup restore test, a provider-side Storage
  restore rehearsal, an independent encrypted location for the local database
  and Storage archives, and documented recovery time and data-loss targets.
  The local logical archive and object reconstruction proved local recovery
  paths, not these remaining disaster-recovery steps.
- Final live-schema comparison, a recorded migration baseline, and safe
  application of 0110 through 0115 in the order above. The local comparison
  exposed the active missing objects, but live production still has the access
  gap and no source migration ledger.
- A representative controlled rollout with real accounts from all four
  churches, including payment/webhook, email/SMS, push, attendance, and media
  paths that those churches actively use.
- Configure and verify Android push if it is among the enabled church
  workflows; the current production variable inventory has no `FCM_*` keys.
- Monitoring with an accountable recipient for application errors, provider
  delivery failures, slow requests, and database/storage capacity. Repository
  code and Vercel's recent logs alone do not prove alert delivery.
- Concurrent-load and recovery tests against a nonproduction copy containing
  representative church data and through the full hosted application path. The
  local 100-church database check and read-only live benchmark do not establish
  provider capacity, request latency, or delivery success at rollout scale.

Release decision: **code hardening is reviewable; a production-ready declaration
and broad lead onboarding remain gated on the live evidence above.**
