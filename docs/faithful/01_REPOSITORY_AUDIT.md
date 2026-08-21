# FaithForm / Faithful repository audit

Audit date: 2026-08-19

Repository: `/Users/mostafamahdi/Desktop/Dev Projects/FaithForm`

Git baseline: `main` at `0ac6667` (`origin/main`), clean before this audit

## Executive summary

FaithForm is a substantial, single-package Next.js administrative product backed by Supabase/Postgres. People, weekly attendance, announcements, live production, recorded media, Sermon Builder, church websites, and Stripe giving all have working web paths. It is not a monorepo, it has no versioned public/mobile API contract, and no native iOS or Android application exists. The requested Faithful app is therefore **not ready for native feature implementation**.

The safest starting point is not an iOS or Android shell. Prompt 2 must first close verified security defects, establish visitor identity and account-to-People linkage, make migration/deployment state reproducible, and define versioned mobile contracts. The current dashboard account model is staff-only and intentionally resolves one `church_users` membership; it cannot safely serve church visitors (`lib/auth/church.ts:33-44`, `app/dashboard/settings/team-actions.ts:150-167`).

Current domain verdicts:

| Domain | Status | Audit conclusion |
|---|---|---|
| People | Partial | Authoritative `members` records and dashboard CRUD exist; visitor-account linkage, households, deduplication, merge, and mobile contracts do not. |
| Attendance | Partial | Manual Sunday rosters write `attendance_records`/`attendance_entries`; there is no service occurrence, campus, check-in source, geofence, QR, kiosk, or transaction-safe convergence. |
| Announcements/events | Partial | Draft/schedule/publish and Google/Facebook/email paths exist; app push, targeting, pinning, device registration, and a Faithful feed do not. |
| Livestream history | Partial | Live production, schedules, private recording upload, metadata, and direct replay pages exist; recording finalization, public archive, adaptive VOD, retention, and authorization need hardening. |
| Sermon Builder archive | Missing | The web builder is real, but its saved model/export output is not a versioned, published, read-only archive and is separate from website media. |
| Donations | Partial | Stripe Connect giving, recurring gifts, webhooks, refunds, receipts, reporting, and a donor portal exist; mobile payment contracts are absent and the portal has a critical authorization flaw. |
| Swift/iOS | Missing | No Swift source, Xcode target, package, entitlements, or store configuration exists. |
| Kotlin/Android | Missing | No Kotlin/Java source, Gradle project, manifest, or Play configuration exists. |

“Partial” means executable production-shaped code exists, not that the live deployment was verified. Production database migration state, buckets, provider configuration, external stream scheduler, backups, and runtime metrics remain **Unknown** without deployed-environment access.

## Evidence standard and scope

- **Verified**: inspected in source at the cited path and line range.
- **Partial**: a real path exists but does not meet the requested capability or production invariant.
- **Missing**: an exhaustive relevant path/name/extension search found no implementation.
- **Unknown**: source cannot prove deployed state, provider state, live data cardinality, or policy decisions.
- Historical documentation is context, not authority. `context.md` and `SECURITY_AUDIT_REPORT.md` contain earlier-state claims; current code and migrations were traced independently.
- No migration or production-data command was run. No application, schema, dependency, configuration, or generated file was changed.

## Repository map

| Area | Verified contents | Boundary / readiness evidence |
|---|---|---|
| Web product | Next.js App Router under `app/`; server components/actions plus 78 total route handlers, 76 under `app/api/` | One private package; scripts and dependencies are in `package.json:1-91` |
| Dashboard | `app/dashboard/` People, Attendance, Announcements, Sermon Builder, Live Streaming/Media, Giving, Website, Voice Assistant, Settings | Staff product; auth resolves a `church_users` row (`lib/auth/church.ts:33-44`) |
| Public web | Giving under `app/give/[slug]`, live/embed/replay under `app/live/[slug]`, generated sites under `app/sites/[slug]` | Existing public experience, not a reusable mobile contract |
| Backend | Next route handlers and server actions call Supabase and external providers | No separate API service, OpenAPI schema, or generated Swift/Kotlin clients |
| Data | 53 ordered SQL files in `supabase/migrations/` | Migrations are extensive, but duplicate numeric prefixes and runtime fallback code make deployed order/state a release gate |
| Auth/authorization | Supabase Auth, SSR middleware, `church_users`, RLS helpers, platform admins, feature grants | Staff roles are only `admin`/`viewer` (`supabase/migrations/0001_schema.sql:21-28`) |
| Storage | Public church logos/covers/social assets; private stream recordings created by a script | Stream-recording bucket is imperative rather than migration-owned (`scripts/ensure-storage-buckets.mjs:5-90`) |
| Payments | Stripe Connect server SDK, Stripe.js/React, webhooks, donor portal | Provider owns money movement; Postgres owns application ledger metadata |
| Streaming | MediaMTX relay, FFmpeg fan-out/recording, OBS/ATEM agent, YouTube/Facebook integrations | Relay and agent are separately deployed (`infra/stream-relay/README.md:1-176`, `infra/stream-agent/README.md:1-52`) |
| Automation | Vercel cron for weekly announcement drafts and integration keep-alive | `vercel.json:25-34`; stream scheduled-start/retry relies on externally configured calls (`DEPLOY.md:146-151`) |
| Legacy workflow | n8n attendance follow-up documentation | Explicitly deprecated in favor of direct SMS (`n8n/README.md:1-62`) |
| Native apps | None | No `.swift`, `.kt`, `.java`, Xcode/Gradle project, manifest, or native directory was found |
| Tests/CI | GitHub Actions installs, lints, and builds | CI has no tests (`.github/workflows/ci.yml:8-29`); `package.json:5-42` has no test script |
| Observability | Console logging; streaming-only sampled structured telemetry | `lib/stream/telemetry.ts:1-100`; no repository-owned Sentry/APM/OpenTelemetry setup |
| Deployment | Vercel web app plus separate relay host | `vercel.json:1-35`; relay lifecycle is outside Vercel |

The tracked repository contains 752 files, including 201 component files, 195 library files, 76 API route handlers (78 route handlers across all of `app/`), and 53 SQL migration files. There is no workspace/monorepo manifest or secondary package.

## Verified technology stack

Source-declared and lock-resolved versions at the audit baseline:

| Layer | Version / implementation | Evidence |
|---|---|---|
| Runtime/CI | Node 20 in CI; pnpm 8 | `.github/workflows/ci.yml:12-22` |
| Web | Next.js 14.2.35, React/React DOM 18.3.1 | `package.json:62-67`; `pnpm-lock.yaml` importer/package resolution |
| Language | TypeScript 5.9.3 resolved | `package.json:78-90`; `pnpm-lock.yaml` |
| Styling/UI | Tailwind 3.4.19 resolved, Base UI 1.5.0, CVA, Lucide, shadcn | `package.json:44-76`, `package.json:78-90` |
| Backend | Next server actions/route handlers; Supabase JS 2.106.1 and SSR 0.10.3 | `package.json:53-54`; `lib/supabase/server.ts`, `lib/supabase/admin.ts` |
| Database | Supabase Postgres, SQL migrations, RLS | `supabase/migrations/0001_schema.sql:1-115`, `supabase/migrations/0002_rls_policies.sql:1-220` |
| Payments | Stripe server 22.2.0, Stripe.js 9.7.0, React Stripe 6.4.0 | `package.json:51-52`, `package.json:73` |
| AI/exports | AI SDK 6.0.191, Anthropic/OpenAI/Google SDKs, PPTXGenJS 3.12, React PDF 4.5.1 resolved | `package.json:45-55`, `package.json:63`; `pnpm-lock.yaml` |
| Live media | hls.js 1.6.2, external MediaMTX/FFmpeg relay | `package.json:59`; `infra/stream-relay/mediamtx.yml:12-56` |
| Email/SMS | Resend 6.12.4; SMSMobileAPI direct integration | `package.json:69`; `lib/attendance/send-follow-up-texts.ts:77-166` |

## Application and ownership boundaries

1. **FaithForm owns administration**: churches, staff access, People, service configuration, attendance review/correction, authoring/publication, stream operations, sermon editing, financial configuration/reporting, refunds, and retention controls.
2. **Faithful must be a constrained consumer/actor**: it reads published material and submits visitor-owned commands such as follow/join, notification preferences, attendance attempts, and payments.
3. **The shared backend remains authoritative**. Native caches are replicas; a mobile database must not duplicate People, attendance, content, or donations.
4. **External providers have narrow authority**: Supabase Auth owns credentials/sessions, Stripe owns payment settlement, MediaMTX/YouTube/Facebook own transport, object storage owns bytes, and APNs/FCM will own push transport. FaithForm’s database owns product lifecycle and reconciliation state.

## Identity, tenancy, and data ownership

### Authentication and staff tenancy — Partial

- Supabase SSR middleware refreshes the user and gates `/dashboard`; public giving/site rewrites occur before authentication (`lib/supabase/middleware.ts:9-93`).
- Production environment validation catches and logs an error but continues rather than failing closed (`lib/supabase/middleware.ts:41-49`).
- `getChurchAuth` orders a user’s `church_users` rows by creation time and takes the first (`lib/auth/church.ts:33-44`). The table only enforces uniqueness per `(church_id,user_id)`, so the database permits multiple churches even though the application selects one (`supabase/migrations/0001_schema.sql:21-28`).
- Team invitations explicitly reject a user already linked to another church (`app/dashboard/settings/team-actions.ts:150-167`). This is a staff-team rule, not visitor follow/join.
- Roles are `admin` and `viewer`; optional feature grants were added later (`supabase/migrations/0041_team_access_and_feature_flags.sql:10-87`).
- Platform administration still contains a hard-coded bootstrap email (`lib/auth/superadmin-emails.ts:1-5`, `lib/auth/superadmin.ts:17-25`).
- Finding an existing auth user by email can scan up to 50 pages of 1,000 accounts (`lib/auth/auth-users.ts:12-59`). That is bounded but unsuitable as the visitor identity lookup strategy.

### Church creation and invitations — Partial, staff only

Platform onboarding uses server-only `church_invites`, a seven-day token, an email match, church profile updates, and an admin `church_users` link (`supabase/migrations/0015_onboarding.sql:8-25`, `app/onboarding/actions.ts:247-294`). It creates/configures FaithForm churches; it does not let a visitor discover, follow, or join a church.

### Faithful account/profile/membership — Missing

There is no visitor profile, device installation, visitor church membership/follow record, account-to-People link, household/dependent relationship, account export/deletion workflow, or consent record. A native app must not reuse `church_users`: that table confers dashboard tenant access and staff roles.

### People authority and linkage — Partial

`members` is the existing church-owned People authority (`supabase/migrations/0001_schema.sql:34-44`). It has name, phone, email, photo, and activity status, but no unique normalized contact, auth identifier, household, merge marker, or provenance. Dashboard mutations validate normalized fields and enforce admin access but do not detect duplicates (`app/dashboard/people/actions.ts:1-220`).

Faithful must add an explicit tenant-scoped link from `auth.users.id` to `members.id`. Email or phone may find candidates, but mutable contact fields must never auto-merge or auto-claim a People record. A verified claim/admin resolution flow must preserve the existing `members.id`, because attendance already references it.

### Multi-campus and multi-church — Missing for Faithful

Churches have one timezone and profile address. `church_service_times` has label/day/start/end/kind, but no campus, coordinates, radius, exception, or attendance window (`supabase/migrations/0038_church_profile.sql:64-83`). Staff multi-church switching is absent. Visitor multi-church following is absent.

### RLS and tenant isolation — Partial

Core RLS helpers restrict authenticated data to `user_church_ids()` and admin writes where declared (`supabase/migrations/0002_rls_policies.sql:1-220`); direct execution of helper functions is revoked later (`supabase/migrations/0004_lockdown_helpers.sql`). Important exceptions are documented in the Security section. Runtime migration/policy state is Unknown.

## Domain findings

### People — Partial

**Reusable:** `members`, dashboard list/create/edit/deactivate flows, tenant-scoped admin mutations, People-to-attendance foreign key.

**Gaps:** visitor link/claim, households, dedupe/merge, details/history API, cursor pagination, deletion/anonymization ownership, and mobile models. The list loads every member and separately loads every present attendance entry, then aggregates in memory (`lib/queries/members.ts:18-67`).

### Attendance — Partial

The authoritative detailed path is `attendance_records` plus `attendance_entries`, linked to `members` (`supabase/migrations/0001_schema.sql:50-68`). The existing experience is manual and Sunday-only: it renders the last eight Sundays (`app/dashboard/attendance/(record)/page.tsx:40-74`) and rejects non-Sunday submissions (`app/dashboard/attendance/(record)/[date]/actions.ts:100-120`).

The save path validates People membership, performs an application-level existing-date check, inserts a record, then inserts entries in a second operation (`app/dashboard/attendance/(record)/[date]/actions.ts:122-190`). There is no database uniqueness on `(church_id,service_date)`, no transaction, and no occurrence key. Concurrent submits can create duplicate records; an entry failure can strand the record and block a retry. The entry uniqueness constraint only protects `(record_id,member_id)`.

Migration `0003_weekly_inputs.sql` also creates a simpler aggregate `attendance` table (`supabase/migrations/0003_weekly_inputs.sql:12-19`), but no application `.from("attendance")` use was found. It is parallel/dead schema and must not become Faithful’s model.

No geofence, latitude/longitude, radius, location permission, check-in window, QR, kiosk, anti-spoof, source, idempotency key, or service occurrence exists. Every source should ultimately converge on one counted fact uniquely keyed by `(service_occurrence_id, member_id)`, with separate append-only attempts/audit data.

### Announcements and events — Partial

`announcements` is the current combined announcement/event authority. Later migrations add scheduling, integration identifiers, social artwork, and weekly email queue (`supabase/migrations/0001_schema.sql:74-86`, `supabase/migrations/0005_announcement_scheduling.sql:3-59`, `supabase/migrations/0009_announcement_integrations.sql:3-82`, `supabase/migrations/0048_announcement_email_queue.sql:16-46`).

The publish action first stores a published row with `push_to_app: false`, then performs Google Calendar/Facebook side effects and persists provider errors (`app/dashboard/announcements/actions.ts:103-154`, `app/dashboard/announcements/actions.ts:244-379`). This is a real, non-transactional integration workflow with useful error state, not a mobile publication pipeline. Public church sites show at most six approved/published upcoming items (`lib/sites/queries.ts:113-163`).

Missing: Faithful feed/detail contracts, target audience, pinning, explicit expiry behavior for clients, push installations/preferences, APNs/FCM delivery, receipts/retries, and realtime invalidation. The legacy announcements webhook validates a secret and otherwise does nothing (`app/api/webhooks/announcements-submitted/route.ts:1-20`).

### Livestreams and history — Partial

Substantial production-shaped live infrastructure exists:

- one active stream session per church, paired encoders, remote commands (`supabase/migrations/0032_stream_production.sql:25-64`);
- scheduled events and syndication attempts (`supabase/migrations/0033_stream_scheduling.sql:3-48`);
- recording metadata (`supabase/migrations/0034_stream_recordings.sql:3-21`);
- series, visibility/tags, and media views (`supabase/migrations/0047_media_library.sql:12-93`);
- MediaMTX RTMP/SRT/WHIP/HLS relay with local MP4 recording/upload (`infra/stream-relay/README.md:1-176`).

When a broadcast ends, FaithForm stops the encoder, clears relay destinations, completes provider broadcasts, marks the session/event ended, and can create a next weekly occurrence (`lib/stream/go-live.ts:196-300`). The relay later uploads its local recording and calls `recording-complete`. That callback resolves only the *active* stream session and inserts a `ready` recording without an idempotent unique key (`app/api/stream/recording-complete/route.ts:12-70`, `lib/stream/recordings.ts:70-99`). If the session is already ended before a large upload completes, event/session correlation and live view inheritance can be lost; retries can duplicate the recording.

The media dashboard edits title/series/tags/visibility, but no transcode, thumbnail job, archive retention, or deletion workflow was found (`app/dashboard/live-streaming/media/actions.ts:35-98`). A direct replay page signs the private MP4 for four hours, but there is no public archive listing (`app/live/[slug]/watch/[id]/page.tsx:40-79`).

Security and scale findings:

- `getHlsPlaybackUrl` returns a raw relay path containing the persistent publish key; its `publicAccess` option is unused (`lib/stream/playback.ts:57-73`). The public status API returns that URL (`app/api/stream/public-status/route.ts:49-70`), while relay publish authorization accepts the same path key (`app/api/stream/publish-auth/route.ts:46-60`). This exposes an ingest credential to every viewer and must be corrected before a mobile player ships.
- Anonymous chat accepts client-supplied church/event identifiers with no auth, rate limit, or server-side relationship/live-state check (`app/live/[slug]/actions.ts:10-34`).
- An authenticated church admin can cancel a caller-supplied event ID through a service-role update that is not scoped to the admin's church (`app/dashboard/live-streaming/actions.ts:299-312`, `lib/stream/events.ts:210-252`). The chat moderation action has the same cross-tenant IDOR shape for a caller-supplied message ID (`app/dashboard/media/actions.ts:14-31`, `lib/stream/chat.ts:55-65`).
- The public view endpoint does not validate that a replay belongs to the requested church or is public and has no rate limit (`app/api/stream/view/route.ts:25-73`).
- The web player polls a no-store public endpoint every five seconds, slowing only on failures/hidden state; no Supabase realtime subscription exists (`components/live-streaming/public-watch-client.tsx:46-103`).
- MediaMTX serves MPEG-TS HLS with an eight-second live window and wildcard HLS CORS; no adaptive bitrate ladder is configured (`infra/stream-relay/mediamtx.yml:18-29`).

### Sermon Builder — Partial editor; archive Missing

The builder persists `sermon_series`, `sermons`, and generated `sermon_assets`. A sermon stores structured JSON content/outline, scripture/theme fields, and draft/published status—not an immutable slide/page rendition (`supabase/migrations/0006_sermon_builder.sql:38-80`, `types/sermon.ts:1-121`). Simple-mode and generation timestamps were added later.

PDF/PPTX exports are rebuilt on request from current sermon, scripture, and theme data (`app/api/sermon/[id]/export/pptx/route.ts:40-134`). The rendered artifact is not stored/versioned, so a later Bible/theme change can alter the same sermon’s output. `sermon_assets` tracks support assets rather than a complete presentation package.

Church-site `site_media` is explicitly a separate manually maintained video/link model (`supabase/migrations/0042_church_sites.sql:175-199`). Publishing a Sermon Builder record does not place it in a public website or Faithful archive. The safe approach is to preserve the builder and add an immutable published presentation version/manifest plus renditions; native apps render/download that output read-only and never reimplement editing.

### Donations — Partial

Stripe Connect state lives on `churches`; `giving_donations`, `giving_subscriptions`, and `stripe_webhook_events` record ledger metadata and event processing (`supabase/migrations/0013_stripe_giving.sql:8-145`). Funds and donors were added with tenant/email uniqueness (`supabase/migrations/0016_giving_enhancements.sql:16-47`). Funds have name/slug/default/active state, not campaign goals or date windows.

The public checkout requires name and email, so anonymous giving is Missing (`app/give/[slug]/give-form.tsx:452-485`). Donors are separate from `members`; no verified People/account link exists. Intent/subscription creation does not supply a Stripe idempotency key (`lib/stripe/giving.ts:51-83`, `lib/stripe/giving.ts:104-211`).

Webhook signatures are verified (`app/api/webhooks/stripe/route.ts:9-38`), but event idempotency is a read-before-process check with the event marked only after all side effects (`lib/stripe/webhooks.ts:562-683`). Concurrent deliveries can race. Receipt code claims `receipt_email_sent_at` before sending; a provider failure prevents retry (`lib/stripe/webhooks.ts:174-226`).

**Critical:** unauthenticated `POST /api/give/portal` accepts a church slug and email, looks up an active subscription, creates a real Stripe billing portal session, and returns its URL (`app/api/give/portal/route.ts:14-75`). Knowing a donor email is not proof of control. The separate magic-link session implementation is HMAC-signed, but its cookie is scoped to `/give/{slug}/portal`, so it is not sent to management APIs under `/api/give/portal/*`; token consumption is also a non-atomic read then update (`lib/giving/portal-session.ts:104-179`). These issues must be fixed and tested before reusing giving for mobile.

## Performance and reliability

| Finding | Verified query/path | Consequence / required gate |
|---|---|---|
| Unbounded People plus all historical presence rows | `lib/queries/members.ts:18-67` | Replace with paged People query and database aggregation; validate proposed composite indexes with `EXPLAIN ANALYZE` and production cardinality. |
| Unbounded active members plus presence history | `lib/queries/attendance.ts:268-310` | Do not use as a mobile roster/feed; return a bounded occurrence roster/summary. |
| Offset pagination exists for sermons | `lib/queries/sermons.ts:68-100` | Use stable cursor ordering for mobile published feeds; retain dashboard behavior unless metrics justify change. |
| Announcement/media/series lists are unbounded | `lib/queries/announcements.ts:87-171`, `lib/stream/media-library.ts:102-125` | Add explicit limits/cursors before Faithful consumption. |
| Basic tenant/date indexes exist | `supabase/migrations/0003_indexes.sql:4-35` | Do not blindly add indexes. Tie every addition to exact filter/order and validate via plans/metrics. |
| Public sites cache for five minutes | `app/sites/[slug]/page.tsx:1-12` | Acceptable explicit TTL for web; mobile needs version/ETag and defined stale-while-revalidate behavior. |
| Live status polling fans out to multiple reads | `app/api/stream/public-status/route.ts:20-55`, `components/live-streaming/public-watch-client.tsx:46-103` | Add cache/event fan-out or scoped realtime after measuring concurrent viewers. |
| Scheduled stream automation is not in Vercel cron | `vercel.json:25-34`, `DEPLOY.md:146-151` | Make scheduler ownership/retries/deployment checks reproducible before calling schedules Ready. |
| Recording storage bucket is script-owned | `scripts/ensure-storage-buckets.mjs:5-90` | Move desired storage state into auditable deployment/migration ownership and verify live policy/bucket state. |
| No offline contract | exhaustive native/web worker search | Define freshness, local encryption, retry/idempotency, conflict, and logout cache purge per domain. |

## Security and privacy

Positive controls include Supabase session verification, tenant-aware server actions, core RLS, Stripe raw-body signature verification, timing-safe shared-secret comparisons, security headers, input/image validation, and private recording storage. These do not offset the following blockers.

### Critical

1. **Donor billing portal authorization bypass**: an email address alone yields a Stripe management URL (`app/api/give/portal/route.ts:14-75`). Disable this path or require a verified, correctly scoped donor session.

### High

1. **Known production-dependency vulnerabilities**: `pnpm audit --prod` on 2026-08-19 reported 60 advisories: 27 high, 28 moderate, and 5 low. The direct Next.js 14.2.35 dependency is included in multiple high-severity advisories; other results include transitive runtime/CLI paths. `package.json:44-76` and `pnpm-lock.yaml` are the audited dependency sources. Prompt 2 must upgrade/replace, test, and reachability-triage the results rather than assume every transitive advisory is exploitable.
2. **Live publish credential exposed in public playback URL**: the persistent publish key is embedded in public HLS paths and also authenticates publishing (`lib/stream/playback.ts:57-73`, `app/api/stream/publish-auth/route.ts:46-60`). Separate viewer capability from ingest credentials and rotate existing keys.
3. **Cross-tenant stream administration IDORs**: cancellation and chat moderation authenticate a local admin but pass caller-controlled IDs to service-role updates without a church filter (`app/dashboard/live-streaming/actions.ts:299-312`, `lib/stream/events.ts:210-252`, `app/dashboard/media/actions.ts:14-31`, `lib/stream/chat.ts:55-65`).
4. **OAuth/stream tokens are client-readable to church admins**: `church_integrations` contains access/refresh/publish tokens, but its authenticated-admin select policy exposes all columns and a security-definer RPC explicitly returns token fields (`supabase/migrations/0009_announcement_integrations.sql:20-63`, `supabase/migrations/0011_integration_tokens_rpc.sql:3-30`). RLS is row-level, not column redaction; move token reads/writes behind a server-only boundary and rotate exposed credentials as appropriate.
5. **Cross-tenant storage write policies**: any authenticated user may insert into any nonempty `church-logos` folder and update/delete any object in that bucket (`supabase/migrations/0015_onboarding.sql:73-96`); church covers have the same problem (`supabase/migrations/0038_church_profile.sql:174-196`). Bind the first folder segment to an authorized church in policy.
6. **Attendance integrity is not concurrency-safe**: no occurrence key/unique constraint/transaction protects the two-step write (`supabase/migrations/0001_schema.sql:50-68`, `app/dashboard/attendance/(record)/[date]/actions.ts:136-190`).
7. **Public live writes lack authorization/abuse controls**: chat trusts client tenant/event IDs and view tracking trusts replay IDs (`app/live/[slug]/actions.ts:10-34`, `app/api/stream/view/route.ts:25-73`).
8. **Visitor identity/privacy lifecycle is absent**: there is no account-to-People claim, precise-location consent/retention model, export, or deletion path.

### Medium

1. Rate limiting is non-atomic and fails open on configuration/database errors (`lib/security/rate-limit.ts:20-82`); it is absent from chat, views, and public stream status.
2. Stripe webhook event claiming is non-atomic; receipt delivery state is recorded before send (`lib/stripe/webhooks.ts:174-226`, `lib/stripe/webhooks.ts:562-683`).
3. Stream recording completion is non-idempotent and depends on an active session (`app/api/stream/recording-complete/route.ts:12-70`).
4. CSV exports quote fields but do not neutralize spreadsheet formula prefixes (`app/api/dashboard/giving/export/route.ts:11-78`).
5. Production env validation logs and continues (`lib/supabase/middleware.ts:41-49`), and schema compatibility fallbacks can mask missing migrations (`lib/auth/church.ts:46-57`, `lib/auth/feature-grants.ts:8-23`).
6. No MFA enforcement, centralized security event trail, or secrets/provider rotation runbook was found.

### Low

1. `media_series` is selectable by all anonymous users regardless of church or publication (`supabase/migrations/0047_media_library.sql:28-40`), exposing names/descriptions.
2. A hard-coded bootstrap super-admin email remains in source (`lib/auth/superadmin-emails.ts:1-5`).

## Native-mobile readiness

### iOS — Missing

No Swift source, `.xcodeproj`, `.xcworkspace`, `Package.swift`, Info.plist, entitlements, signing/store files, or iOS tests exist. Minimum OS, SwiftUI architecture/navigation, Supabase authentication, Keychain use, local cache, background tasks, APNs, AVPlayer/HLS, Core Location/geofencing, universal links, accessibility, localization, privacy manifests, and App Store configuration all must be created after backend contracts are locked.

### Android — Missing

No Kotlin/Java source, Gradle settings/build, Android manifest, resources, signing/store files, or Android tests exist. Minimum SDK, Compose architecture/navigation, Supabase authentication, encrypted local persistence, WorkManager, FCM, Media3, geofencing/permissions, app links, accessibility, localization, privacy/data safety, and Play configuration all must be created after the same contracts are locked.

Neither platform should embed the service-role key, Stripe secret, relay secret, publish key, or unrestricted direct-table access. Public read contracts and authenticated commands must be server-owned and versioned.

## Design parity audit

FaithForm has a coherent but web-specific design source:

- light/dark semantic colors, brand navy `#002D5F`, gold `#C5A059`, background `#F8F7F4`, dark background `#0A1628`, and base radius `0.75rem` (`app/globals.css:5-60`);
- Nunito body and Montserrat heading fonts (`app/layout.tsx:1-17`);
- semantic Tailwind mappings, radii, and card shadows (`tailwind.config.ts:10-70`);
- button variants, focus states, and 44–48 px primary/icon touch sizes (`components/ui/button.tsx:6-40`);
- card radius/border/shadow/padding behavior (`components/ui/card.tsx:3-56`);
- logo, Apple touch icon, favicons, and two sermon-theme images under `public/`.

This is not yet a platform-neutral design contract. Later work should add one canonical, versioned token/behavior specification owned by the repository (for example `design/faithful/tokens.json` plus documented component states and visual fixtures). Generate or validate Swift and Kotlin constants from it; do not share UI code. Exact parity applies to brand, layout rhythm, hierarchy, component states, imagery, and motion intent. Navigation, back behavior, permission prompts, Dynamic Type/font scaling, VoiceOver/TalkBack, reduced motion, platform payment sheets, picture-in-picture, location settings, and background restrictions must remain native.

## Test, deployment, and observability readiness

- CI only runs install, lint, and build (`.github/workflows/ci.yml:8-29`). There is no unit, integration, RLS, route-contract, browser, native, payment-webhook, or migration test suite.
- `pnpm lint` cannot run unattended because no ESLint configuration exists; Next prompts for initial setup.
- `pnpm build` completed successfully against `.env.local`, compiling and statically generating all 97 pages; this validates compilation/types, not provider or database behavior.
- `pnpm audit --prod` completed and found 60 known advisories (27 high, 28 moderate, 5 low); no dependency was changed during this audit.
- The repository has no APM/error reporting ownership. Streaming telemetry is sampled log output only (`lib/stream/telemetry.ts:1-100`).
- Deployment cannot prove migrations/buckets/external scheduled-stream jobs are applied. Prompt 2 needs a non-production environment inventory and drift check before any new migration.

## Ranked program risks

1. **Critical — donor account takeover path:** email-only billing portal creation.
2. **High — vulnerable dependency baseline:** the production audit reports 27 high-severity advisories, including direct Next.js 14.2.35 findings.
3. **High — stream credential disclosure:** public viewers receive the persistent ingest key in the HLS URL.
4. **High — tenant and provider-secret isolation:** cross-tenant stream cancellation/moderation and client-readable integration tokens expand a compromised admin session beyond its intended boundary.
5. **High — identity collision/privacy:** there is no safe visitor-to-People link, deletion, consent, or household model.
6. **High — attendance double-counting/data loss:** existing saves lack occurrence identity, database uniqueness, and transactionality.
7. **High — tenant storage isolation:** authenticated cross-church writes/deletes are allowed by bucket policies.
8. **High — no stable mobile contract:** native clients would otherwise couple to staff tables and schema drift.
9. **Medium — recording/archive lifecycle:** completion can lose correlation or duplicate; public archive/transcoding/retention are absent.
10. **Medium — payment/event retry semantics:** non-atomic event claiming and receipt state can duplicate or suppress work.
11. **Medium — performance:** several lists and historical aggregations are unbounded; index changes require real plans/metrics.
12. **Medium — delivery/operations:** external stream scheduling, storage setup, monitoring, and retry ownership are not deployment-verified.
13. **Low — design drift:** reusable web tokens exist but no cross-platform contract or golden visual fixtures exist.

## Readiness conclusion

Prompt 2 may begin only as a security, deployment-drift, identity/tenancy, and contract-foundation phase. It must not ship visitor screens or create parallel People/attendance/content/giving stores. A genuine external blocker remains: live Supabase/provider state cannot be certified from source alone, so migration status, storage policies/buckets, external cron, and provider credentials must be inventoried in an authorized non-production/production read-only review before schema rollout.
