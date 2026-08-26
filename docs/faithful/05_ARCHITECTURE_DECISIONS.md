# FaithForm / Faithful architecture decisions

> **Revalidated 2026-08-24 at `9bdbbaf`.** All eighteen decisions re-checked against the repository and none is invalidated. Confirmations worth noting: AD-004's premise still holds exactly — `attendance_records` still has **no** `(church_id, service_date)` uniqueness (`supabase/migrations/0003_indexes.sql:7-18` defines plain indexes only), the check-then-insert race is unchanged, and the unused aggregate `public.attendance` table still has zero callers. AD-006 is now **satisfied in source**: the persistent publish key was removed from playback URLs in Prompt 2 and viewer playback is a separate expiring HMAC capability (`lib/stream/playback.ts:55-108`). AD-009's premise is reinforced — `push_to_app` is still written `false` at every production call site and no APNs/FCM infrastructure exists. AD-005 gains one input: as of `68363cb`, Apple/iCloud is a connectable calendar provider via CalDAV (`supabase/migrations/0052_apple_calendar_integration.sql:11-15`), which is outbound calendar publication and does **not** constitute a Faithful feed. See `01_REPOSITORY_AUDIT.md` § Revalidation addendum.

Audit date: 2026-08-19

Scope: invariants for Prompts 2–12; a later change requires new evidence and an explicit superseding decision

## Decision status

- **Locked**: an invariant supported by the product boundary and current repository authority.
- **Provisional**: the recommended option, but live-state, product, legal, provider, or performance evidence is required before implementation.
- **Rejected**: an option later prompts must not introduce without superseding this record.

## AD-001 — FaithForm owns administration; Faithful is a constrained native client

**Status:** Locked

**Decision**

- FaithForm owns church/campus configuration, staff roles, People administration, schedules/windows, content authoring/publication, stream operations, sermon editing/publication, funds/campaigns, reporting, corrections, refunds, and retention actions.
- Faithful owns only the signed-in visitor’s profile/preferences/consent/cache and allowed requests: discover/follow/join, read published content, submit attendance attempts, and initiate payment operations.
- Both use one shared backend. Faithful never owns a parallel church, People, attendance, content, or donation database.
- Provider systems have narrow authority: Supabase Auth for credentials, Stripe for settlement, stream providers/relay for transport, storage/CDN for bytes, APNs/FCM for delivery. Postgres owns product-facing metadata, authorization, lifecycle, and reconciliation.

**Evidence**

- The repository is one FaithForm Next.js package (`package.json:1-91`).
- Current domain authorities live in shared Supabase migrations (`supabase/migrations/0001_schema.sql:7-86`).
- No iOS or Android project exists.

**Consequences**

- A Faithful action must appear in existing FaithForm views through the same authoritative record.
- Native caches are replaceable replicas and cannot settle payments or count attendance.

**Rejected**

- A mobile-only database, separate People directory, separate attendance ledger, or native Sermon Builder editor.

## AD-002 — Account, staff membership, visitor relationship, People, and donor identities stay separate

**Status:** Locked

**Decision**

1. `auth.users.id` is the global credential/account subject.
2. `church_users` remains the FaithForm staff membership/role relation only.
3. A new visitor-church relation represents follow/join state and supports multiple churches.
4. `members.id` remains the church-owned operational People identity.
5. `giving_donors.id` remains the church-specific donor/reporting identity.
6. Explicit tenant-scoped links connect these identities only after verified claim/admin resolution. Email/phone are mutable candidate signals, never authentication or an automatic merge key.

**Evidence**

- Staff roles are `admin`/`viewer` (`supabase/migrations/0001_schema.sql:21-28`).
- Dashboard auth selects one first-created staff link (`lib/auth/church.ts:33-44`), and team invites reject a second church (`app/dashboard/settings/team-actions.ts:150-167`).
- People has contact fields but no auth link/unique normalized contact (`supabase/migrations/0001_schema.sql:34-44`).
- Donors are unique by church/email but separate from People (`supabase/migrations/0016_giving_enhancements.sql:35-47`).

**Consequences**

- One account may follow multiple churches without obtaining dashboard access.
- Attendance uses the linked `members.id`; giving history uses verified donor/account access.
- Claim conflicts require a staff/user resolution workflow and audit.

**Rejected**

- Reusing `church_users` for visitors; treating email possession as donor or People ownership; creating a new mobile People row.

## AD-003 — Visitor onboarding uses a separate relationship lifecycle

**Status:** **Locked — implemented in Prompt 3** (`supabase/migrations/0053_visitor_identity.sql`)

Option 2 was chosen and built. `visitor_church_relationships` is unique per
`(account_id, church_id)` with states `following`, `pending`, `joined`, `left`,
`blocked`, an append-only transition log, and a pure state machine at
`lib/faithful/relationship-state.ts`. The questions this decision listed under
"verify before implementation" were answered as follows:

- **Follow is immediate; join follows the church's policy** (`open`,
  `approval_required`, `invite_only`), read from the church row at decision time.
- **Discoverability is opt-in and defaults to false.** The migration lists nobody.
- **Invitations** are hashed, purpose-bound, expiring, revocable, and consumed
  atomically; `blocked` is checked inside that same statement.
- **Blocked is terminal for visitors** and survives account deletion.
- **Age/minor rules remain undecided** and fail closed — see
  `P3_IDENTITY_AND_TENANCY_REPORT.md`.
- **Whether `joined` carries ecclesial or legal meaning is still a product
  question**; it is currently a product relationship only.

See `P3_IDENTITY_CONTRACT.md` for the full transition table.

**Evidence**

- Existing `church_invites` creates a FaithForm church administrator and is server-only (`supabase/migrations/0015_onboarding.sql:8-25`, `app/onboarding/actions.ts:247-294`).
- No discovery/follow/join record exists.

**Options**

1. Reuse staff onboarding/`church_users`.
2. Add a separate visitor relationship with states such as `following`, `pending`, `member`, `left`, `blocked`.
3. Store only a selected church on the profile.

**Recommendation**

Choose option 2. The relationship is unique per `(account_id,church_id)`, can be initiated by public discovery or a signed church invitation/deep link, and is independent of a People claim. Keep the currently selected church as client preference, not membership authority.

**Verify before implementation**

- Whether “follow” is immediate and “join/member” needs church approval.
- Public church discoverability, invitation expiry/revocation, blocked users, age/minor rules, and whether membership status has ecclesial/legal meaning.

**Rejected**

- Option 1 because it grants dashboard tenancy; option 3 because it cannot represent multi-church or revocation.

## AD-004 — Unified attendance is occurrence-based and idempotent

**Status:** Locked invariant; Provisional migration shape

**Decision**

- Preserve the existing People link and detailed attendance data, but evolve the authority around an immutable `service_occurrence` rather than a Sunday/date batch.
- Manual, admin, geofence, QR, and kiosk sources call one authenticated server command.
- One counted fact is database-unique on `(service_occurrence_id,member_id)`.
- Source-specific attempts and corrections are append-only/audited; repeated valid attempts do not increment attendance.
- The server validates tenant, People link, occurrence, window, source policy, consent, and idempotency. A client’s coordinates or claim never directly writes attendance.

**Evidence**

- Current detailed authority is `attendance_records`/`attendance_entries` with unique `(record_id,member_id)` (`supabase/migrations/0001_schema.sql:50-68`).
- Current UI supports only the last eight Sundays and rejects other dates (`app/dashboard/attendance/(record)/page.tsx:40-74`, `app/dashboard/attendance/(record)/[date]/actions.ts:114-120`).
- Record and entry inserts are separate and there is no church/date database uniqueness (`app/dashboard/attendance/(record)/[date]/actions.ts:136-190`).
- A separate aggregate `attendance` table exists but is unused (`supabase/migrations/0003_weekly_inputs.sql:12-19`).

**Options for migration**

1. Add occurrence/source columns directly to current header/entries and backfill.
2. Add new occurrence and counted-fact tables, migrate current entries, then adapt existing reads.
3. Use the unused aggregate `attendance` table.

**Recommendation**

Choose between 1 and 2 only after inspecting live duplicates/cardinality and testing report/follow-up compatibility. Option 2 usually expresses the invariants more cleanly; it must preserve existing IDs or explicit mappings and cannot run as a parallel long-term ledger. Reject option 3.

**Verify before implementation**

- Live duplicate church/date records, null People references, correction semantics, multiple same-day services, recurring exceptions/DST, data-retention policy for location evidence, and legal/product rules for automatic attendance/minors.

## AD-005 — Content publication creates a stable mobile projection

**Status:** Locked invariant; Provisional representation

**Decision**

- Faithful never reads dashboard draft/editor tables as an unbounded generic client.
- Announcements/events, stream listings, presentations, and fund/campaign configuration expose explicit published projections with stable IDs, publication/version timestamps, visibility/targeting, and cursor ordering.
- Publication/unpublication and notification/job enqueueing are server-owned and transactionally coordinated where consistency matters.
- External provider failures are reconciled independently; they do not silently roll back the canonical content state.

**Evidence**

- Announcement publish stores state before Google/Facebook work and records errors (`app/dashboard/announcements/actions.ts:103-154`, `:244-379`).
- Public sites already apply a limited approved/published upcoming filter (`lib/sites/queries.ts:113-163`).
- Several dashboard lists are unbounded (`lib/queries/announcements.ts:87-171`, `lib/stream/media-library.ts:102-125`).

**Options**

1. Mobile queries existing tables directly with RLS.
2. Versioned server DTOs backed by views/queries and explicit command endpoints.
3. Duplicate published content into a separate mobile database.

**Recommendation**

Option 2. A database view/materialized projection or version table may be used per domain, but the shared Postgres authority and IDs remain canonical.

**Verify before implementation**

- Whether announcement edits replace a mutable published projection or create immutable versions; retention of unpublished content; public versus follower-only fields; target semantics and cache SLA.

**Rejected**

- Option 3; option 1 for privileged/internal fields or retryable commands.

## AD-006 — Livestream viewer authorization must not contain ingest credentials

**Status:** Locked

**Decision**

- The persistent stream publish key is an ingest secret and is never returned to a browser or native app.
- Live viewers receive a short-lived, scope-limited playback capability or a CDN/proxy URL that cannot publish.
- Public status returns only display/event/playback data required by the client; chat/view commands resolve church/event server-side from public identifiers.

**Evidence**

- Public status returns `getHlsPlaybackUrl` (`app/api/stream/public-status/route.ts:49-70`).
- That function embeds `settings.streamPath`, which contains the publish key, and ignores `publicAccess` (`lib/stream/playback.ts:57-73`, `lib/stream/relay.ts:43-66`).
- Publish auth accepts the same path key (`app/api/stream/publish-auth/route.ts:46-60`).

**Consequences**

- Existing keys must be rotated after the corrected route/relay deploys.
- Cache keys/logs/analytics must be checked so the old credential is not retained.

## AD-007 — A stream becomes history through an idempotent processing lifecycle

**Status:** Provisional

**Evidence**

- End flow marks the active session/event ended before relay upload necessarily finishes (`lib/stream/go-live.ts:196-300`).
- Recording completion queries the active session and inserts without a unique completion key (`app/api/stream/recording-complete/route.ts:12-70`).
- New recording rows are marked `ready` immediately (`lib/stream/recordings.ts:70-99`).
- Existing playback is a four-hour signed direct MP4 and there is no public archive listing (`app/live/[slug]/watch/[id]/page.tsx:40-79`).

**Options**

1. Keep direct MP4 and manual metadata; add only a listing.
2. Make upload/finalization idempotent and add processing/rendition/thumbnail/publication states, reconciliation, and adaptive VOD.
3. Make YouTube/Facebook the only archive authority.

**Recommendation**

Option 2. The relay assigns a durable recording/completion ID before or at ingest; callback correlates to a known session/event even after end; object checksum/size is verified; processing produces adaptive renditions/thumbnails/captions; only published/allowed visibility appears in history. Provider archive links may coexist but are not the product authority.

**Verify before implementation**

- Media/CDN/transcode provider and cost, retention/deletion, captions, downloads, source-file retention, failure/reconciliation SLA, and public/unlisted rules.

## AD-008 — Sermon Builder publishes immutable presentation versions

**Status:** Locked invariant; Provisional rendition format

**Decision**

- `sermons` remains the editable FaithForm document.
- Explicit publication creates an immutable version linked to `sermons.id` with a normalized slide/page manifest, content hash, scripture/theme/font/asset snapshots, semantic accessibility text, and generated rendition metadata.
- Faithful lists and renders published versions read-only. It does not call editor/generation endpoints or reconstruct from mutable live theme/scripture data.
- Existing PDF/PPTX export remains a dashboard feature; it may become one rendition, not the only mobile contract.

**Evidence**

- A sermon stores structured JSON/theme/status rather than immutable rendered pages (`supabase/migrations/0006_sermon_builder.sql:50-80`, `types/sermon.ts:1-121`).
- PPTX is rebuilt on request (`app/api/sermon/[id]/export/pptx/route.ts:40-134`).
- Website `site_media` is separate external-media metadata (`supabase/migrations/0042_church_sites.sql:175-199`).

**Options for mobile rendition**

1. Native semantic manifest plus preview images/PDF fallback.
2. PDF only.
3. PPTX download/third-party viewer.

**Recommendation**

Option 1: a versioned neutral manifest with exact visual assets and semantic reading order, plus server-rendered images/PDF fallback. This supports fidelity, accessibility, offline integrity, and both platforms without duplicating the editor.

**Verify before implementation**

- Scripture/font/image licenses, animation needs, supported aspect ratios, offline downloads, text reflow versus exact slide mode, version retention, and site/public visibility.

## AD-009 — Announcement delivery uses a transactional outbox and user preferences

**Status:** Locked invariant; Provisional provider

**Decision**

- Publication writes canonical state and an outbox entry in the same transaction.
- Device installations are account/device scoped; preferences are account+church/topic scoped.
- Workers deliver through APNs/FCM, record attempts/provider results, retry safely, invalidate dead tokens, and deep-link by stable content ID.
- Push is a hint, never the content source: apps always fetch authorized current state.

**Evidence**

- `push_to_app` exists but the actual publish action hardcodes it false (`supabase/migrations/0001_schema.sql:74-85`, `app/dashboard/announcements/actions.ts:136-154`).
- A durable announcement email queue already models claim/attempt/status concepts (`supabase/migrations/0048_announcement_email_queue.sql:16-46`).
- No device token/preference/APNs/FCM code exists.

**Options**

1. Direct provider call inside publish request.
2. Transactional database outbox with worker.
3. Polling only.

**Recommendation**

Option 2. Choose direct APNs/FCM or a vendor only after privacy, cost, delivery, and operational review.

**Verify before implementation**

- Targeting/pinning/expiry semantics, notification categories, quiet hours, consent defaults, provider choice, collapse/update behavior, and delivery data retention.

## AD-010 — Stripe owns money movement; the shared ledger is webhook-reconciled

**Status:** Locked

**Decision**

- Stripe Connect remains the payment provider. FaithForm/Faithful servers create short-lived payment/setup operations with provider idempotency; native apps use the supported Stripe SDK or hosted surface.
- A client “success” is provisional. Verified Stripe webhooks atomically claim events and authoritatively reconcile `giving_donations`/`giving_subscriptions`.
- Donor history, statements, subscription management, and portal URLs require a verified donor/account session—not email knowledge.
- Refunds/corrections remain FaithForm financial actions; native apps do not mutate ledger status.

**Evidence**

- Existing Connect/ledger/event tables (`supabase/migrations/0013_stripe_giving.sql:8-145`).
- Signature verification exists (`app/api/webhooks/stripe/route.ts:9-38`).
- Current event guard is read-before-process and marks afterward (`lib/stripe/webhooks.ts:562-683`).
- Email-only portal creation returns a real URL (`app/api/give/portal/route.ts:14-75`).

**Consequences**

- Fix the portal and event claim before native giving.
- Never put Stripe secret keys or service-role credentials in either native app.

## AD-011 — Funds remain the base designation; campaign semantics extend rather than fork giving

**Status:** Provisional

**Evidence**

- `giving_funds` has name, slug, sort/default/active but no goal/window (`supabase/migrations/0016_giving_enhancements.sql:16-29`).
- Donations already reference `fund_id` (`supabase/migrations/0016_giving_enhancements.sql:53-69`).

**Options**

1. Add campaign fields to funds.
2. Add a campaign entity referencing a fund.
3. Create separate campaign donations.

**Recommendation**

Choose 1 for simple time-bounded/goal metadata or 2 if multiple campaigns may designate the same accounting fund. In both cases, existing `giving_donations` remains the only ledger and retains `fund_id`; a campaign reference is metadata, not a second donation table.

**Verify before implementation**

- Accounting/reporting expectations, multiple currencies, goal calculation/refunds, recurring gifts after campaign end, privacy of public totals, activation/publication states.

**Rejected**

- Option 3.

## AD-012 — Mobile uses versioned server contracts, not direct internal-table coupling

**Status:** Locked

**Decision**

- Public/mobile reads and all mutations go through a versioned server contract with explicit DTOs, auth scopes, typed errors, stable cursors, idempotency, cache validators, and correlation IDs.
- Shared schemas/fixtures generate or validate TypeScript, Swift, and Kotlin models.
- Additive changes remain backward compatible within a version; breaking changes require a new version and measured deprecation window.
- Direct Supabase Auth use may be permitted for session acquisition/refresh, but domain access is through the mobile contract unless a specifically reviewed narrow RLS-backed path is proven safe.

**Evidence**

- Current API surface is ad hoc route handlers/server actions; no OpenAPI or native generated client exists.
- Compatibility fallbacks acknowledge migration drift (`lib/auth/church.ts:46-57`, `lib/auth/feature-grants.ts:8-23`).

**Consequences**

- Internal column/table changes do not immediately break two store-distributed apps.
- Client-supplied tenant IDs are never an authorization decision.

**Rejected**

- Embedding the Supabase service role; unrestricted direct-table CRUD; separate platform-specific server APIs.

## AD-013 — SwiftUI and Compose share specifications, not UI code

**Status:** Locked

**Decision**

- iOS is fully native SwiftUI; Android is fully native Jetpack Compose.
- Both consume the same API semantics, neutral design tokens, content fixtures, component-state behavior, accessibility intent, and parity acceptance tests.
- Each implements native navigation/back, permission dialogs/settings recovery, typography scaling, VoiceOver/TalkBack, reduced motion, payment sheet, media/PiP, secure storage, push, location/background, and deep-link conventions.

**Evidence**

- FaithForm’s semantic colors/fonts/radii/shadows are defined in web CSS/Tailwind (`app/globals.css:5-60`, `tailwind.config.ts:10-70`).
- Button/component state and minimum sizes are web primitives (`components/ui/button.tsx:6-40`).
- No native targets exist.

**Canonical design location**

Add a repository-owned platform-neutral area such as `design/faithful/` containing versioned semantic tokens, component/state specifications, motion durations/curves, icon/image references, accessibility semantics, and golden fixtures. Generate or verify native constants from it. This path is a recommendation, not an implementation in this audit.

**Rejected**

- Kotlin Multiplatform UI, React Native, or a webview solely to force pixel identity.

## AD-014 — Cache by authority and visibility; version invalidation is explicit

**Status:** Provisional

**Decision**

- Public/published read models use explicit `ETag`/version and bounded cursor responses, with domain-defined `Cache-Control`/stale rules.
- Authenticated/private data is cached encrypted where appropriate and partitioned by account+church+environment. Logout, membership revocation, account deletion, and visibility change purge or invalidate affected entries.
- Media uses CDN/signed viewer URLs and immutable rendition keys; ingest secrets never enter cache keys.
- Offline writes are durable commands with client idempotency and expiry, never blind row replication. Attendance attempts expire with the occurrence window; payment creation is not queued indefinitely.

**Evidence**

- Public sites use a five-minute revalidation TTL (`app/sites/[slug]/page.tsx:1-12`).
- Live status explicitly fetches `no-store` every five seconds (`components/live-streaming/public-watch-client.tsx:46-103`).
- Replay uses a four-hour signed URL (`app/live/[slug]/watch/[id]/page.tsx:58-79`).
- No mobile/offline implementation exists.

**Options for update delivery**

1. Poll every screen.
2. Push/realtime invalidation plus versioned fetch/backfill.
3. Supabase realtime table subscriptions for everything.

**Recommendation**

Option 2. Use push/realtime only as an invalidation hint and always backfill via the authorized versioned feed. Choose scoped Supabase realtime only where measured latency/concurrency justifies it.

**Verify before implementation**

- Freshness SLOs per domain, CDN/provider capabilities, concurrent live viewers, download/storage budgets, privacy classification, and revocation latency.

## AD-015 — Authorization is defense in depth with tenant-bound storage and server commands

**Status:** Locked

**Decision**

- Every domain table enables RLS with least-privilege select/write policies and query-supporting tenant indexes.
- Every server command independently resolves the authenticated subject, tenant/relationship/role, and target-row ownership; client church IDs are hints at most.
- Service-role use is server-only and narrowly wrapped. Public service-role routes validate resource relationships and apply abuse controls.
- OAuth, refresh, stream-publish, and other integration tokens are readable/writable only by server/worker services; authenticated clients receive status and public metadata, never raw token columns.
- Storage object keys begin with a tenant/domain owner segment enforced by storage RLS, not merely by server action convention.
- Secrets are fail-closed, rotated, redacted, and never embedded in URLs intended for public caching/logging.

**Evidence**

- Core tables use tenant RLS helpers (`supabase/migrations/0002_rls_policies.sql:1-220`).
- Logo/cover policies currently allow authenticated cross-folder writes/deletes (`supabase/migrations/0015_onboarding.sql:73-96`, `supabase/migrations/0038_church_profile.sql:174-196`).
- Scheduled stream cancellation authenticates a church admin but sends a caller-controlled event ID to a service-role update that is not church-scoped (`app/dashboard/live-streaming/actions.ts:299-312`, `lib/stream/events.ts:210-252`). Chat moderation repeats this pattern for a caller-controlled message ID (`app/dashboard/media/actions.ts:14-31`, `lib/stream/chat.ts:55-65`).
- `church_integrations` stores provider tokens while an authenticated-admin row policy and RPC expose those token columns (`supabase/migrations/0009_announcement_integrations.sql:20-63`, `supabase/migrations/0011_integration_tokens_rpc.sql:3-30`).
- Public chat/view routes use service-role paths without sufficient relationship checks (`app/live/[slug]/actions.ts:10-34`, `app/api/stream/view/route.ts:25-73`).
- Rate limiting fails open and uses a non-atomic increment (`lib/security/rate-limit.ts:20-82`).

**Consequences**

- Add RLS/authorization tests for own tenant, other tenant, anonymous, revoked membership, and worker roles.
- Index recommendations require exact query/plan evidence; security indexes are part of policy performance, not an excuse for speculative indexing.

## AD-016 — Background work is durable, idempotent, observable, and reconciled

**Status:** Locked invariant; Provisional platform

**Decision**

- Push, email, media processing, recording completion, webhook handling, scheduled stream work, receipts, and deletion/export use durable records with atomic claims, idempotency keys, bounded retries, next-attempt time, terminal/dead-letter state, and reconciliation.
- Provider delivery is never considered complete solely because an HTTP request was sent.
- Jobs emit privacy-safe correlation, attempt, latency, outcome, and backlog metrics.

**Evidence**

- Announcement email queue has status/attempt/next-attempt fields (`supabase/migrations/0048_announcement_email_queue.sql:16-46`).
- Stripe events are marked only after processing (`lib/stripe/webhooks.ts:562-683`).
- Receipt state is claimed before email send (`lib/stripe/webhooks.ts:174-226`).
- Scheduled stream endpoints depend on external cron not represented in `vercel.json` (`DEPLOY.md:146-151`, `vercel.json:25-34`).

**Options**

1. Continue request/cron handlers with database outboxes/leases.
2. Add a managed queue/worker platform.
3. Fire-and-forget provider calls.

**Recommendation**

Use option 1 initially if load/reliability targets fit Vercel and Postgres; choose option 2 only from measured duration/concurrency/retry requirements. Reject option 3.

**Verify before implementation**

- Expected volumes, maximum durations, concurrency, provider limits, Vercel plan, worker ownership, and operational on-call capacity.

## AD-017 — Privacy minimization governs location, People, financial, and analytics data

**Status:** Provisional pending policy/legal approval

**Decision recommendation**

- Store attendance result and minimal validation evidence, not continuous location history.
- Separate opt-in automatic attendance from general location permission; show current consent, last result, and revocation.
- Never include precise location, donor identity, message bodies, payment data, stream keys, or tokens in analytics/logs.
- Account deletion detaches/anonymizes retained attendance/financial records according to approved obligations and deletes device tokens/private profile data.
- Media view `viewer_key` remains opaque and non-People-linked.

**Evidence**

- Current media view design intentionally uses an opaque non-personal key (`supabase/migrations/0047_media_library.sql:68-83`).
- There is no existing location/consent/deletion model.

**Options for geofence evidence**

1. Retain raw coordinates/trails.
2. Retain only server validation outcome, coarse accuracy/rule version, timestamp, source, and short-lived diagnostic evidence.
3. Retain nothing beyond counted attendance.

**Recommendation**

Option 2 with the shortest practical diagnostic retention, then reduce to the audit outcome. Option 3 may be chosen if anti-fraud/support requirements permit. Reject continuous trails.

**Verify before implementation**

- Jurisdictions, minors, church policy, disclosure/consent text, retention periods, export/deletion obligations, financial/attendance record obligations, and incident response.

## AD-018 — Performance changes require bounded contracts and measured query plans

**Status:** Locked

**Decision**

- Every mobile collection has a bounded default/max and stable cursor, generally ordered by `(published_at,id)` or `(created_at,id)` as appropriate.
- Aggregates run in SQL/materialized projections rather than loading all history into application memory.
- An index is added only for a verified filter/join/order pattern and is validated with production-like `EXPLAIN (ANALYZE, BUFFERS)` plus write/storage cost.
- SLOs cover API latency/error, cache hit/freshness, stream startup/rebuffer, job lag/retry, push delay, attendance confirmation, and payment reconciliation.

**Evidence**

- People counts load all members and all present entries (`lib/queries/members.ts:18-67`).
- Attendance active-member counts do the same (`lib/queries/attendance.ts:268-310`).
- Sermons use offset pagination (`lib/queries/sermons.ts:68-100`).
- Basic tenant/date indexes already exist (`supabase/migrations/0003_indexes.sql:4-35`).

**Consequences**

- Do not prescribe speculative indexes in implementation prompts.
- Load tests use synthetic production-like data, never copied congregation/payment data.

## Decision checklist for every later prompt

Before merging a later implementation, confirm:

1. It writes the owner named in `02_SOURCE_OF_TRUTH_MAP.md` and creates no parallel authority.
2. It preserves `members.id` as People identity and does not treat email as authentication.
3. Attendance sources converge through the one occurrence command.
4. Faithful reads only published/versioned content.
5. No live ingest, service-role, payment, provider, or signing secret reaches a native/public client.
6. Every retryable effect has atomic idempotency and reconciliation.
7. SwiftUI/Compose share contracts/tokens/fixtures, not UI code or permission behavior.
8. Cache/offline/revocation and privacy/retention behavior is explicit.
9. RLS/server authorization and cross-tenant tests pass.
10. Performance/index claims are backed by bounded queries, plans, and metrics.
