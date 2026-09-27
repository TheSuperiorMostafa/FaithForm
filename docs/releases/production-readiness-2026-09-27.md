# Production readiness gate — 2026-09-27

FaithForm already serves four churches. This release closes a direct staff-data
authorization gap and fixes failing release checks. It has **not** been deployed
by this branch. A green build alone does not authorize a claim of production
readiness.

## Verified in an isolated checkout

- Web: typecheck, lint (zero errors), production build, 1,755 application tests,
  generated-contract/design/localization checks, migration baseline check,
  secret scan, and feature-guard scan pass.
- Database: all 113 migrations apply to disposable PostgreSQL 15 and 17
  databases; all 42 database tests pass, including cross-church, per-feature,
  and view-access denial probes. The additive
  `0111_announcement_status_view_invoker.sql` migration resolves the live
  Security Advisor's SECURITY DEFINER view finding. It is local only.
- A full custom-format PostgreSQL backup and restore rehearsal passed on a
  disposable PostgreSQL 17 server with four synthetic churches. Restored record
  fingerprints, RLS, view settings, and medical-note grants matched the source.
  Run it with `pnpm test:backup-restore`, `FAITHFORM_DB_TARGET=disposable`, and
  a loopback-only `FAITHFORM_TEST_DATABASE_URL`. This does not validate
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
  Do a deployed-schema and migration-history reconciliation before executing
  either new migration. Do not replay the full local chain onto production.
  Read-only checks did confirm that the feature-gate function and the member
  and file columns referenced by 0110 exist; this is a prerequisite check,
  not a complete schema diff.
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

## Release sequence for migrations 0110 and 0111

1. Capture the current deployment and database migration state. Reconcile the
   deployed schema and source migration history. Confirm a recoverable backup
   by restoring it to a separate environment and checking tenant counts and
   critical records, including Storage objects through a separate process.
   Do not restore over live data.
2. Deploy the application changes first. The new server code can read medical
   notes and call aggregates after the database policy tightens. The old server
   code cannot read some of those fields after 0110.
3. Smoke test sign-in and the existing workflows for each of the four churches:
   Home, People care details, Kids Check-in roster, Reports PDF, Giving, Calls,
   Church App editing, and any enabled provider integration. Check both admin
   and limited staff accounts, plus a disabled-feature account.
4. Apply `0110_feature_scoped_sensitive_reads.sql` and
   `0111_announcement_status_view_invoker.sql` once through the controlled
   migration process. Verify their recorded checksums and inspect the resulting
   policies, column grants, and view options. Do not edit an already applied
   migration.
5. Repeat the same workflow checks. A staff session without Giving, Calls,
   People, or Check-in must be denied direct reads of those areas; an attendance
   session must not be able to select `members.medical_notes`. A staff session
   must not read a second church's records. Run
   `pnpm security:anonymous-announcements` with the production Supabase URL and
   public key; both anonymous counts must be zero.
6. Watch request errors, latency, webhook failures, and queued jobs during a
   small rollout. Keep lead outreach phased until these checks have held under
   normal Sunday and weekday traffic.

If a page fails after 0110, fix or roll forward the server code. Reverting only
the application to a version that selects `medical_notes` through the staff
client will break that page. Re-granting direct medical access or permissive
financial/call policies is not a safe rollback.

## Gates still requiring live evidence

- A successful Supabase physical-backup restore test, a provider-side Storage
  restore rehearsal, an independent encrypted location for the local database
  and Storage archives, and documented recovery time and data-loss targets.
  The local logical archive and object reconstruction proved local recovery
  paths, not these remaining disaster-recovery steps.
- Deployed migration-history reconciliation and a safe application of 0110/0111;
  production metadata inspection confirmed the current access gap and the
  absence of the local source-migration ledger.
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
