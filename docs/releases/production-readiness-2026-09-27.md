# Production readiness gate — 2026-09-27

FaithForm already serves four churches. This release closes a direct staff-data
authorization gap and fixes failing release checks. It has **not** been deployed
by this branch. A green build alone does not authorize a claim of production
readiness.

## Verified in an isolated checkout

- Web: typecheck, lint (zero errors), production build, 1,829 application tests,
  generated-contract/design/localization checks, migration baseline check,
  secret scan, and feature-guard scan pass.
- Database: the earlier 113 migrations applied to disposable PostgreSQL 15 and
  17; the current 124-migration chain passed a fresh PostgreSQL 17
  migration rehearsal. All 52 database tests pass, including
  cross-church, per-feature,
  and view-access denial probes. The additive
  `0111_announcement_status_view_invoker.sql` migration resolves the live
  Security Advisor's SECURITY DEFINER view finding. It is local only.
- The exact planned rollout order was rehearsed against a fresh disposable
  restore of the approved production archive: 0114–0120 first, then
  0110–0113. Every migration applied, and the restore retained four churches,
  109 members, and one pending invitation. The temporary database was removed.
  This verifies schema/data compatibility of that order; it does not replace
  the controlled live migration baseline and rollout checks.
- A full custom-format PostgreSQL backup and restore rehearsal passed with all
  124 migrations on a disposable PostgreSQL 17 server and four synthetic
  churches. Restored record fingerprints, RLS, view settings, and medical-note
  grants matched the source.
  Run it with `pnpm test:backup-restore`, `FAITHFORM_DB_TARGET=disposable`, and
  a loopback-only `FAITHFORM_TEST_DATABASE_URL`, with PostgreSQL 17 client tools
  first on `PATH`. This does not validate
  Supabase's production physical backups or Storage object recovery.
- Native: iOS Swift build and the Android unit suite across debug, staging, and
  release variants pass. Device/provider end-to-end tests remain separate.
- Dependencies: no unresolved high or critical production advisories. Two high
  `image-size` advisories are covered by the repository's reviewed lockfile patch.
  The current `pnpm audit:prod` check reports zero critical, two patched high,
  zero moderate, and zero low advisories. Local lockfile overrides move the
  Google API client's `qs` dependency to 6.16.0 and AI SDK provider utilities
  to 4.0.33. The two reported `qs` denial-of-service cases now reject or
  safely serialize their test inputs; Google and AI clients initialize, all
  1,792 application tests pass, and the production build succeeds. Provider
  calls still need a controlled external integration check after rollout.
- Live read-only signals: the latest Vercel production deployment was marked
  Ready; the public mobile health endpoint returned HTTP 200; the production
  error-log query found no 5xx entries in its last 24-hour window. These are
  point-in-time checks, not an uptime or alerting guarantee.
- A later 24-hour production log check found zero 5xx entries and one
  error-level middleware entry on an HTTP 200 request: Church App quick links
  could not save because the live `churches.app_links` column is absent. This
  confirms that HTTP status alone misses some failed feature saves; local
  migration 0113 addresses the missing column but remains undeployed.
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
- A live QA browser test closed and reopened the only room. The live Check-in
  desk hid the closed room as intended, but called that state “No rooms yet.”
  The local desk now distinguishes all-closed rooms from no rooms and directs
  staff to reopen one. The QA room was reopened after the test.
- The live QA church's two taken-down announcements were missing from the
  recovery list. Read-only QA-row inspection found both are pending with a
  prior publisher but no take-down timestamp from the deployed action. The
  local list now includes those legacy rows and dates them by their last
  update. A read-only run of the local reader returned both; three focused
  take-down tests pass. This still needs a browser retest after rollout.
- OAuth connection state previously carried the onboarding return path as
  readable encoded text, including the invitation token. The local state is
  now authenticated and encrypted with a fresh nonce before it goes to Google
  or Facebook. The callback still accepts correctly signed states already in
  flight until their 30-minute expiry. Focused tests verify round-trip,
  tamper rejection, and unreadable invite content. Vercel's production variable
  list contains the required `INTEGRATION_OAUTH_STATE_SECRET`; provider
  connection still needs a browser retest after rollout.
- Invite validation now closes every outstanding setup link once its church
  finishes onboarding, including a duplicate link from a concurrent send.
  The Google and Facebook callback access check also refuses a completed
  church. Profile saves require a still-incomplete church and confirm that a
  row changed; logo upload no longer reports success when the profile write
  failed. Focused invite and OAuth tests pass. These guards are local only.
- The Admin first-invite path no longer removes a working invitation before
  the replacement email succeeds. If delivery cannot be confirmed, both the
  new and old links remain usable until a resend confirms the new one; the
  screen says so instead of claiming delivery. A successful resend then
  disables the older pending links; a failed or uncertain resend keeps the
  current link available. New-church creation also keeps
  its church and invite in that case, so Admin can resend the same link. Its
  result distinguishes sent, unconfirmed, and already-created outcomes.
  These changes are local; Resend delivery still needs a controlled failure
  rehearsal.
- The Add church dialog now retains a request key across retries. Migration
  0120 stores it on the church and enforces uniqueness, including when two
  submissions arrive together. If preparing the invitation fails, the new
  church remains visible so Admin can send the invite from its Users tab.
  A concurrent two-connection test produced one church for one key and allowed
  a genuinely separate request. All 122 migrations and 48 database tests
  passed in a disposable local database. The approved production archive
  accepted 0119 and 0120 in a separate local restore; all four churches and
  the existing invitation remained, and the new column and unique index were present.
  That restored database was removed. The live Add church path still needs a
  browser retest after rollout.
- The QA browser created a two-week sermon series and a Week 1 draft. The
  database linked the draft to the series, but the live series page still
  offered “Start this week's sermon” with no saved-draft link. Local migration
  0119 adds an exact week number to new sermons; the page now shows saved
  sermons for each week and conservatively matches older linked sermons by a
  unique title or passage. The 0119 column, index, and range check passed a
  rollback-only PostgreSQL 17.6 rehearsal. All 122 migrations and 48 database
  tests pass in a disposable database. The approved production archive also
  restored to a separate local PostgreSQL 17.6 database and accepted 0119;
  all four churches and six sermons remained, and the column, check, and index
  were present. That restored database was removed. The local app and migration
  need rollout together, followed by a browser retest.
- Family-name pickup search now pages through all matching people, family
  names, membership links, and that day's open check-ins. It filters for
  families with children still present before limiting the displayed matches.
  A read that fails or exceeds the 10,000-row per-query guard returns a retry
  message instead of "no family found." The 1,785 application tests, typecheck,
  targeted lint, and a local production build pass. Hosted search latency for
  a very large church remains unmeasured.
- Migration 0117 creates a first-time check-in family, guardian, children, and
  their family links in one transaction. A forced failure on the second child's
  link left zero new People or family rows; all 46 database tests pass. The
  updated web action reports each subsequent physical check-in separately and
  avoids claiming that nothing was saved if a network response is uncertain.
  The approved production archive accepted 0116 and 0117 in a disposable
  local restore: counts stayed at four churches, 109 members, and 18 check-in
  sessions. Both functions were present afterward, and the copy was removed.
  The migration must precede the web build; the live New family flow still
  uses the older cleanup path until rollout.
- Migration 0118 makes a multi-child Undo one transaction. It locks every
  selected check-in, rechecks the same staff member and ten-minute window,
  and refuses the entire request if one child was already released or changed.
  A forced failure on the second update left both children checked in. All 47
  database tests pass. The approved production archive accepted 0116–0118 in
  a disposable local restore with its four churches, 109 members, and 18
  historical check-in sessions unchanged; all three functions were present,
  then the copy was removed. The updated web action requires 0118 before
  deployment.

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
  request to the base `announcements` table counted zero. A repeat on
  2026-09-27 at 22:53 UTC counted 13 view rows and zero base-table rows.
  This confirms a
  publicly reachable RLS bypass. This audit did not retrieve any announcement
  content or establish whether the path has been used. The local 0111 migration
  makes the view honor caller privileges and row policies. This matches
  Security Advisor's one
  error. It also listed 32 warnings; Performance Advisor listed 14 warnings;
  Health Advisor listed no errors or warnings. These counts are point-in-time
  advisor results.
- The same read-only anonymous count check covered 13 private tables/views.
  Eleven returned zero rows, `church_integrations` denied the request, and
  `announcements_with_status` returned 13 rows. The expanded local
  `security:anonymous-private-data` gate correctly fails on that live result.
  It requests counts only, never record content. The full 123-migration chain
  and all 50 disposable database tests passed again, including the anonymous
  view denial. Production remains exposed until the controlled migration and
  a zero-row live retest.

## Release sequence for migrations 0110 through 0122

1. Capture the current deployment and database migration state. Reconcile the
   deployed schema and source migration history. Confirm a recoverable backup
   by restoring it to a separate environment and checking tenant counts and
   critical records, including Storage objects through a separate process.
   Do not restore over live data.
2. Apply `0114_group_gathering_atomic_update.sql`,
   `0115_atomic_onboarding_completion.sql`,
   `0116_atomic_child_checkout.sql`,
   `0117_atomic_checkin_family_creation.sql`,
   `0118_atomic_checkin_undo.sql`,
   `0119_sermon_series_week.sql`, and
   `0120_admin_church_create_request.sql`,
   `0121_atomic_site_publication.sql`, and
   `0122_atomic_church_profile.sql` before deploying the updated
   application. The updated meeting, onboarding, child pickup, new-family,
   Undo, and website publication actions call these server-only functions and
   cannot work until they exist. The sermon-series page also reads the new
   `series_week` column; Add church reads and writes the request-key column.
   The currently deployed code does not call the new functions or read those
   columns. Then deploy the application changes before the
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
   0114 through 0118's server-only execute grants, 0119's column and index,
   0120's unique request-key index, and 0121 and 0122's server-only execute
   grants.
   Do not edit an already applied
   migration.
5. Repeat the same workflow checks. A staff session without Giving, Calls,
   People, or Check-in must be denied direct reads of those areas; an attendance
   session must not be able to select `members.medical_notes`. A staff session
   must not read a second church's records. Run
   `pnpm security:anonymous-private-data` with the production Supabase URL and
   public key; every private table/view must return zero rows or deny anonymous
   access. Verify platform admin totals
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
  message. A synthetic website enquiry also reached the QA church Inbox and
  the owner's authorized Gmail alias with matching content; its temporary
  contact address was removed and verified after reload. Optional external
  provider connections were skipped.
- The browser pass found a live expired-impersonation transition that can show
  the old QA banner over the platform admin's own church page. A local guard
  now redirects expired switches before dashboard requests or actions run;
  this requires deployment and a timed browser retest. It also found the live
  announcement takedown fallback losing its recovery timestamp when the
  Facebook schedule column is absent; a local fix requires rollout and a
  recovery decision for affected rows. The production Church App lacks the
  `app_links` column until migration 0113 is applied.
- An unpublished QA website loaded in Safari Private Browsing when its
  predictable URL included `?preview=1`; without the query it returned 404.
  The local website and contact-form paths now require a same-church staff
  account with Website access for draft previews and submissions, and check
  visibility on each request. Both the page and contact form now require the
  page status and site setting to say published before allowing anonymous
  access; a stale or failed setting read cannot expose a page marked offline.
  A failed Website feature-flag read also denies public access, preserving a
  platform admin's opt-out; a focused failure-path test passes.
  The Website editor's live indicators use the same rule.
  The patched local app displayed a 404 page to an
  anonymous Safari visit for the same QA draft preview. This is a live privacy
  blocker until the fix is deployed and an anonymous production retest hides
  the draft. A compiled local production server, connected only to synthetic
  data through a temporary loopback HTTPS proxy, displayed the published site
  and displayed 404 for an anonymous draft preview, either inconsistent
  publication state, and an explicitly disabled Website. The disabled site's
  contact endpoint returned 404 and stored no submission. The synthetic rows
  were removed afterward. The earlier 503 from a local run with an invalid
  HTTP Supabase URL was resolved by this isolated setup. Next.js streamed the
  404 page with an initial HTTP 200 in one unpublished-site probe; the route
  prevented content disclosure, but this response-status behavior needs review
  for crawlers and monitoring. The dynamic public-site path still needs hosted
  load evidence before a 100-church claim.
- The live group meeting editor still writes its event and attendance window
  separately. Local migration 0114 makes them one transaction and passed a
  forced-failure rollback test. Its rollout and browser retest are outstanding.
- The QA check-in display and welcome desk paired in Safari. Revoking the
  display removed its rotating code, and the kiosk rejected an early check-in
  for a synthetic member. After kiosk pairing, the dashboard's station status
  stayed stale until refreshed. A local bounded pairing-status refresh,
  manual Refresh station status control, and checked station-list reads
  address this. Selecting another service creates fresh panel state, and late
  responses cannot overwrite a newer refresh. Active-display and service
  setting reads now report errors instead of presenting false “off” defaults.
  These changes need a browser retest after
  rollout. Both QA features were turned off again.
- The QA Phone Calls page had no calls. Its query previously treated a failed
  database read as an empty list, so a real outage could have displayed “No
  calls yet.” The local query and voice-settings reader now fail visibly, and
  the old-schema call fallback is limited to a confirmed missing column. All
  56 focused phone-call and read-error tests pass with typecheck and lint. A
  controlled browser failure-path retest remains after rollout.
- The Attendance follow-up message log previously stopped after 1,000 texts,
  which could hide later recipients from a busy Sunday, and showed "No texts
  sent yet" when its database or service-role read failed. The local reader now
  pages until the selected Sundays are complete, checks order and repeated
  rows, and shows a retry state on read failure. A 1,001-text Sunday and a
  failed second page passed focused tests. This needs a browser retest after
  rollout; no live messages were sent for this check.
  The QA church's deployed log loaded an ordinary "No texts sent yet" state;
  no live failure was induced on Sunday, so that screen alone cannot verify
  the local failure path.
- A failed Help ticket or reply read previously appeared as an empty list or
  conversation, and replies beyond Supabase's first page could be omitted.
  The local Help reader now checks complete, counted pages for tickets and
  replies, batches ticket IDs, and raises read failures so the existing Help
  error state appears. The platform ticket detail also stops before showing an
  incomplete thread. A 1,001-reply thread, 1,001-ticket list, and read-failure
  tests pass. The local production build, typecheck, targeted lint, and all
  1,817 application tests pass. Live Help and platform Support still need
  browser retests after rollout. In the
  deployed QA Help page, "Your messages" showed empty and a blank submission
  prompted for the required message. The optional subject field expanded; no
  support message was sent for this check.
- Giving reads previously returned empty funds, failed recurring gifts, or
  false “not found” results on database errors. Year-end statement reads could
  omit rows past Supabase's page limit or produce incomplete PDFs and ZIPs
  after a partial failure. Local queries now page through gift and donor rows,
  stop on read failure, and use old-schema fallback only for confirmed missing
  color columns. Statement routes report an error before returning a file
  when church, donor, or gift data is unavailable. Seven focused integrity tests
  and 77 Giving tests pass; live download/email and large-church rehearsals
  remain after rollout.
- Statement preview, gift selection, year picker, and printed gift dates now
  use each church's calendar zone. A local 1,001-gift PDF rehearsal counted
  every row and the $1,001 total across 43 letter pages. The first, middle,
  and last pages were visually checked: headers and page numbers repeated,
  and the total stayed with the final gift rows. The PDF is synthetic and
  was not sent to a donor. A second 1,001-gift rehearsal with long wrapping
  fund names used 126 pages; every page retained its heading and number, and
  the middle and final pages were visually checked. The 22 focused date,
  pagination, and read-integrity tests pass. The final local build, typecheck,
  targeted lint, and all 1,812 application tests pass. Live statement download
  and email still need a controlled retest.
- The live website publish control writes page status and site settings in
  separate requests. Local migration 0121 saves both in one transaction. All
  50 database tests pass, including a forced second-write failure that leaves
  the draft unpublished and direct-call denials for browser roles. A fresh
  synthetic backup and restore also passed with 0121. Apply this migration
  before deploying its website action, then browser-test publish and unpublish
  against the QA church after rollout.
- Platform church-detail usage and saved-minute totals now page through
  counted results, and the phone-call count must succeed before it is shown.
  A 1,205-row rehearsal included every usage and activity row; a 1,200-row
  member rehearsal included every row for the requested member. Failed reads
  and missing counts now stop the page instead of displaying false zeros.
  Church-detail membership also pages through counted results, while the
  overview, church list, activity, and Auth directory now surface read
  failures. The 1,820 application tests, typecheck, targeted lint, and local
  production build pass. These changes have not been deployed or retested in
  the live admin interface.
- The live QA admin profile showed visible labels beside staff and recurring
  event inputs, but Safari exposed those inputs without accessible names.
  The local form now associates labels with the staff, recurring-event,
  social-link, and file-upload fields and names service-time and office-hour
  controls. The QA-only draft rows used to inspect this were discarded, with
  no profile save. Typecheck and targeted lint pass; keyboard and screen-reader
  retests still need the updated build.
- A later live QA profile save reached the admin route as a POST and the
  production edge auth gate returned HTTP 307 twice, before the save action
  ran. Safari then displayed the global error page. Reloading confirmed that
  the synthetic mission, vision, phone, email, and denomination edits had not
  persisted. The local admin gate now rejects unauthenticated Server Action
  POSTs with 401 and converts other denied POST redirects to GET; the profile
  form catches an action failure so its edits remain available. The global
  error page no longer claims unsaved work was preserved. This failure path
  needs a controlled browser retest after rollout, including an expired
  session. The log showed a redirect, but did not reveal why the admin session
  was denied; the local gate records a non-sensitive denial reason for that.
  Typecheck, targeted lint, all 1,826 application tests, and the local
  production build pass.
- A later click on “Open FaithForm Onboarding QA's dashboard” from the live
  platform admin church page also reached the generic error screen. The
  production request detail showed its Server Action POST received HTTP 307
  from middleware to `/login`, followed by a POST to that page. The reason
  the session was denied remains unknown. Retest admin-to-church handoff after
  the local POST handling change is deployed; the QA recording tab remained
  accessible. The local handoff button now catches a rejected action and
  offers sign-in again on the same page instead of leaving the admin on a
  global error screen. The session-denial reason still needs diagnosis from
  the new post-rollout log field. Typecheck, targeted lint, and the local
  production build pass; the browser behavior needs retesting after rollout.
- The shared church-profile read now requires complete, counted service-time,
  staff, and recurring-event rows. Website and church-app save paths merge from
  this profile; a failed or truncated child read could previously become an
  empty list and be written back as missing profile data. A 1,001-service
  rehearsal kept every row in display order; failed staff and church reads
  now reject instead of returning partial or missing profiles. Typecheck,
  targeted lint, all 1,823 application tests, and the local production build
  pass. This is local only and needs a controlled save retest after rollout.
- Profile saves now read complete, counted IDs for all three child tables before
  writing any profile field. Previously a failed service-time or staff ID read
  could be treated as an empty list during synchronization. The church update
  must affect one row, and the two legacy mirror writes must succeed. A focused
  failure test confirms a failed staff preflight performs no church update.
  Typecheck, targeted lint, all 1,827 application tests, and the local
  production build pass.
  This guarded path remains as a narrow compatibility fallback if the new
  database function has not yet been installed. It still spans multiple
  requests, so the migration must precede the application rollout.
- New profile child rows now use their stable UUID client IDs when inserted,
  including new rows from Website Details. A retry after a partial save updates
  the same staff, service-time, or recurring-event row instead of duplicating
  it. Existing rows removed by another editor now stop the legacy save, and updates
  must confirm a row was changed. A focused in-memory retry test saved the
  same new staff member twice and retained one row. The atomic database save
  now provides the needed transaction; forms opened before
  rollout may still carry older non-UUID temporary IDs. Typecheck, targeted
  lint, all 1,828 application tests, and the local production build pass.
- Local migration 0122 saves church fields, legacy settings mirrors, service
  times, staff, and recurring events in one transaction under a church row
  lock. The server action uses it when available; the guarded older path is
  only for the brief interval before migration. A disposable PostgreSQL 17
  rehearsal applied all 124 migrations and passed 52 database tests. The new
  tests verify stable retry IDs, rollback after a late child failure, rejection
  of another church's or removed row's ID, and direct-call denial for browser
  roles. All 1,829 application tests, typecheck, targeted lint, and the local
  production build pass. A synthetic custom-format backup and restore passed
  again with 0122 included. The approved production archive also restored into
  a disposable PostgreSQL 17 database after excluding 69 unrelated Supabase
  Vault and Realtime objects unavailable in the local image. Migration 0122
  applied there, kept the four church rows, and granted execution to
  `service_role` but not `authenticated`; the disposable copy was removed.
  This is local only; a post-rollout browser save with
  a valid admin session and an expired session is still required.
- Church-team listings now load every ordered page and stop on a failed page
  or missing Auth account details. The prior read could show an empty team on
  a database error or show missing grants when Auth lookups failed. A 1,001
  member test reached the final member and rejected both failure cases. This
  is local only; the live Team and platform Users views need a post-rollout
  check with authorized QA accounts.
- A repeat in Safari Private Browsing confirmed the live privacy gap: an
  anonymous visitor can read the QA church's unpublished site by adding
  `?preview=1`, while the same private window showed 404 without that
  parameter. A separate in-app browser showed FaithForm's marketing page at
  that URL, but it did not reproduce Safari's result and cannot be treated as
  proof of protection. The local preview guard remains a release blocker until
  deployed and retested in Safari Private and another anonymous browser.
- The signed-in QA site preview's visit form required a name and a valid email
  before submission. Optional phone and note fields accepted QA text. The
  invalid draft was discarded without sending another enquiry; an earlier
  valid QA enquiry had reached the owner's Gmail inbox.
- Live-streaming setup choices saved and persisted in the QA church. A separate
  code review found that a failed recording-settings read could display false
  defaults, including the wrong automatic-publication choice. The local fix
  fails visibly on read errors and passed focused tests. It needs rollout and
  a controlled failure-path browser check. A short QA camera broadcast then
  reached Live, recorded 48 seconds, ended, and produced a playable recording
  that remained unpublished. The first browser-studio attempt failed because a
  new church had no stream credentials until Go live; the local studio path now
  provisions them through an authenticated same-origin request. End service
  also left Safari capture active until navigation; the local success path now
  stops the studio. Both fixes need browser retests after rollout. Recording
  publication to the app and website remains untested. The QA recording played
  back and a trim save succeeded; final deletion is awaiting the immediately
  required confirmation at the product's irreversible delete step.
- Onboarding currently sends a redundant second confirmation email after the
  church invite. A local one-email account-creation change is ready for a new
  tenant rehearsal after rollout. Step 6 also needs the local checked-write
  ordering fix before onboarding more churches; the current live order can
  close an invite before creating the church-admin membership.
- Google showed an unverified-app warning before the QA church could connect
  the owner's Gmail. The owner reports that Google verification has already
  been requested; approval has not been observed. The owner completed Google
  consent and FaithForm then showed Calendar and Gmail connected. A synthetic
  event created in FaithForm appeared in the owner's Google Calendar, persisted
  after a FaithForm reload, and was deleted from FaithForm after the owner
  confirmed the irreversible action. FaithForm then showed no event on that
  date. A synthetic email-only QA announcement produced a draft in the owner's
  Gmail account with the expected subject and content. It was taken down from
  FaithForm after verification; deleting the Gmail draft awaits the owner's
  separate confirmation. Keep Google verification separate from FaithForm's redundant onboarding
  email. The requested Gmail compose scope can also send mail, so review the
  scope disclosure and approval status before offering Google connections to
  new churches. See Google's
  [Gmail scope descriptions](https://developers.google.com/workspace/gmail/api/auth/scopes).
  The QA church's weekly email settings also claimed a Monday draft would
  appear despite having no connected mailbox. A local UI fix now identifies
  the missing connection. Manual Gmail draft creation passed; the scheduled
  Monday run and iCloud Mail remain untested. The live draft incorrectly gave
  a non-event announcement an all-day date, and a draft made before take-down
  remained in Gmail after the weekly list became empty. Local rendering now
  omits the invented date, and the card warns that an older draft needs review
  or removal before sending. Local draft creation now fails on incomplete
  calendar, queue, or announcement reads. Google Calendar listing now reads
  all result pages instead of silently stopping after 250 events. These fixes
  passed 32 focused tests, typecheck, and targeted lint; they need rollout and
  browser retests.
- A follow-up audit found another first-page limit in published announcement
  lists, calendar-to-announcement links, the weekly email queue, and the
  weekly draft's own database inputs. The local readers now request counted,
  ordered pages through row
  1,001 and reject a failed later page instead of showing a partial or empty
  result. An older schema without `all_day` still reads the complete weekly
  list. Calendar and announcement read failures now stop the dashboard's
  weekly card and draft creation visibly rather than producing a misleading
  zero count. Focused 1,001-row and failure-path tests, TypeScript checking,
  targeted lint, all 1,839 application tests, and the local production build
  pass. The final queue change also passed focused tests, typecheck, and lint
  after that build. An individual read above 10,000 rows now raises a visible error and
  needs a narrower server query. This remains local and needs a browser retest
  after rollout.
- Weekly draft creation and its availability view now require a successful
  read of the platform email switch. A failed church email-settings read no
  longer substitutes enabled defaults. The automatic draft job now reports a
  failed integration, church-timezone, or feature-list read instead of treating
  it as zero churches or proceeding with unknown switches. Focused tests prove
  that a disabled switch and failed switch/settings reads cannot authorize a
  draft. All 1,842 application tests, typecheck, targeted lint, and the local
  production build pass. This is local and needs a controlled failure-path
  retest after rollout.
  A local onboarding change also reports failed provider-status reads instead
  of presenting them as disconnected; that return path needs a browser retest.
- A successful Supabase physical-backup restore test, a provider-side Storage
  restore rehearsal, an independent encrypted location for the local database
  and Storage archives, and documented recovery time and data-loss targets.
  The local logical archive and object reconstruction proved local recovery
  paths, not these remaining disaster-recovery steps.
- Live Giving statements and email receipts assert that no goods or services
  were provided, and the PDF also asserts every church is tax exempt. FaithForm
  does not record the facts needed to verify those claims. The local build now
  uses neutral giving-record wording in the PDF and both emails. Resolve a
  church/gift verification workflow before relying on these as tax
  acknowledgments. The IRS requires a written acknowledgment
  to describe any goods or services provided (or intangible religious
  benefits); church exemption depends on qualifying under section 501(c)(3).
  See the IRS [written acknowledgment guidance](https://www.irs.gov/charities-non-profits/charitable-organizations/charitable-contributions-written-acknowledgments)
  and [church exemption guidance](https://www.irs.gov/charities-non-profits/churches-integrated-auxiliaries-and-conventions-or-associations-of-churches).
- Final live-schema comparison, a recorded migration baseline, and safe
  application of 0110 through 0122 in the order above. The local comparison
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
