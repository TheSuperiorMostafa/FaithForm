# Prompt 14 — Groups and Messaging

*One church communication platform: groups, their people, their gatherings, and
their conversations — owned by FaithForm, carried by Stream.*

This document is the architecture record and the implementation plan. It was
written after reading the repository, not before, and every decision below
cites the convention it extends. Anything that changes a locked decision from
`05_ARCHITECTURE_DECISIONS.md` says so explicitly.

---

## 1. What the repository already decided (and this feature inherits)

| Concern | Existing authority | How Groups uses it |
| --- | --- | --- |
| Tenant root | `churches` | Every new row carries `church_id`; every command re-derives it server-side. |
| Staff access | `church_users` + `church_features` + per-user grants (`lib/features/catalog.ts`) | New feature key **`groups`**. Staff administer all groups of their church; nobody else uses the dashboard. |
| App identity | `visitor_accounts`, `visitor_church_relationships` (`following`/`pending`/`joined`) | A person may use Groups while their relationship grants published content (`following`, `pending`, `joined`); `blocked` sees nothing. |
| People | `members` + `visitor_people_links` (migration 0083) | Group membership is anchored to People so attendance works. Joining a group runs the same People connection 0083 runs on joining a church. |
| Attendance | `service_occurrences` → `record_attendance` → `attendance_facts` (0055/0056) | A group gathering *is* an occurrence (`service_occurrences.group_id`). Leaders mark present through the one command. No second ledger. |
| Mobile boundary | `/api/mobile/v1`, `lib/mobile/v1/contract.ts`, generated Swift/Kotlin | Every Groups/Messaging read and command is a contract endpoint. Native clients never touch tables. |
| Background work | Outbox + lease + `FOR UPDATE SKIP LOCKED` (`notification_outbox`, 0054) | Stream synchronization is a durable outbox of **reconcile intents**, claimed the same way. |
| Push | APNs/FCM credentials server-side (`lib/faithform/push/*`) | Chat pushes are delivered by Stream using the same credentials; FaithForm owns device registration and preferences and mirrors them. |
| Audit | Append-only event tables per domain (`visitor_relationship_events`, `attendance_corrections`, …) | `group_audit_events` and `messaging_moderation_actions`. |
| Storage | Tenant-foldered public buckets (`church-covers`) | Group covers live under `church-covers/<church_id>/groups/…`, written by the server only. |

## 2. Ownership

**FaithForm / Postgres owns:** groups, types, schedules, memberships and roles,
join requests, invitations, bans, gatherings and RSVPs, attendance (through the
existing authority), church messaging and DM policy, safety profiles,
notification preferences, reports and moderation history, restrictions,
analytics, audit, and every Stream binding.

**Stream owns:** messages, threads, reactions, attachments, read state and
unread counts, typing and presence, message search, edits and deletes, native
flags, blocks and mutes as delivery primitives, and chat push delivery.

**The rule that makes this safe:** a Stream channel never decides who belongs
to a group. FaithForm decides; a reconciler makes Stream agree. Clients cannot
create channels, add or remove members, update channels, change roles, search
users, or edit their own chat profile — those Stream permissions are removed
from every client role (`scripts/configure-stream-chat.mjs`).

## 3. Identity mapping

| FaithForm | Stream | Form | Why |
| --- | --- | --- | --- |
| church | team | `ch_` + base32(sha256(`faithform:church:<uuid>`))[0..24] | Opaque and stable. The church uuid is never a public handle (P3: the slug is). |
| auth user (app member **or** staff) | user | `ff_` + base32(sha256(`faithform:user:<uuid>`))[0..26] | One chat identity per sign-in, on web and phone alike. Opaque. |
| group | channel `ff_group:grp_<uuid-hex>` | 36 chars | Stream ids are capped at 64 characters, so `church_<uuid>_group_<uuid>` does not fit. The group uuid is already the group's public handle in the mobile contract. |
| direct conversation | channel `ff_dm:dm_<hash>` | base32(sha256(church, sorted pair))[0..30] | Deterministic, so a retried creation lands on the same channel. |

Deterministic ids are what make partial failure recoverable: a reconciler that
retries after "channel created, database write lost" converges on the same
channel instead of creating a second one. Binding tables
(`messaging_user_bindings`, `group_chat_bindings`, `messaging_dm_channels`)
record provisioning state and give webhooks a reverse lookup.

**Multi-tenancy** (`multi_tenant_enabled`) is required. A user's `teams` are
derived server-side from their usable church relationships and staff
memberships; a channel's `team` is its church. Stream then refuses any
cross-team read or write for every non-global role, which is a second,
independent tenant boundary under FaithForm's own.

Staff get `teams_role: { <church team>: "ff_church_staff" }` — a custom role
that may read and post in **group** channels of their church without being a
member (so the dashboard can participate without joining 40 member lists) and
that has **no grants on direct messages**. Staff never hold Stream's `admin`
role, which would read every DM in the team.

## 4. Data model (migrations 0091, 0092)

`0091_groups.sql`

- `group_types` — church-configurable categories, seeded lazily.
- `groups` — identity, cover, type, `status` (`active`/`archived`),
  `visibility` (`public`/`unlisted`/`private`), `enrollment`
  (`open`/`approval_required`/`invitation_only`/`closed`), capacity, campus,
  meeting place, `location_visibility` (`public`/`members` — a home address is
  members-only by default), online meeting URL, chat settings, `safety_profile`
  (`standard`/`youth`), member/leader counts maintained by trigger, `version`.
- `group_meeting_schedules` — weekly / biweekly / monthly-by-weekday, IANA zone.
- `group_memberships` — dual subject (`account_id` and/or `member_id`),
  `origin`, `group_role` (`member`/`leader`/`manager`), `status`
  (`active`/`left`/`removed`), per-group `notification_level`.
- `group_join_requests`, `group_invitations` (hashed, expiring, revocable,
  multi-use), `group_bans`.
- `group_events` — gatherings, generated from schedules or created by leaders;
  `occurrence_id` links the attendance authority.
- `group_event_rsvps`, `group_attendance_records` (roster snapshot, guest count).
- `group_audit_events` — append-only.
- `service_occurrences.group_id` / `group_event_id` — additive, nullable.

Commands are SQL functions so each decision and its write commit together:
`group_join`, `group_leave`, `group_decide_request`, `group_add_member`,
`group_remove_member`, `group_set_role`, `group_accept_invitation`,
`connect_group_member_people`, `ensure_group_event_occurrence`,
`record_group_attendance`, `generate_group_events`, plus analytics functions.

`0092_group_messaging.sql`

- `church_messaging_settings` — messaging on/off, **DM policy (default
  `disabled`)**, member media/links/GIFs, youth defaults.
- `messaging_user_bindings`, `group_chat_bindings`, `messaging_dm_channels`.
- `messaging_notification_preferences` — per account and church: `all`,
  `mentions`, `off`.
- `messaging_blocks`, `messaging_reports`, `messaging_moderation_actions`,
  `messaging_restrictions`.
- `messaging_sync_jobs` (outbox) with `claim_messaging_sync_jobs` /
  `complete_messaging_sync_job`, and triggers that enqueue on every change that
  could make Stream disagree.
- `messaging_webhook_receipts` — idempotency on `X-Webhook-Id`.
- `group_activity_daily` — message *counts* per group per day (never content).
- `group_staff_reads` — when a staff member last viewed a group's messages.

**RLS:** enabled on every table, `anon`/`authenticated` revoked, and only the
reads the dashboard needs are granted back — staff of the church holding the
`groups` feature (`user_has_feature(church_id, 'groups')`). No table has a
client write policy. Visitors read nothing directly.

## 5. Behaviour that is decided here

**Enrollment.** `public` groups are listed in Discover; `unlisted` are reachable
by link; `private` are invisible and indistinguishable from nonexistent to
non-members. `open` joins at once, `approval_required` creates a request,
`invitation_only` needs a valid invitation, `closed` refuses. Capacity is
checked under a row lock at join *and* at approval. A ban is terminal until a
staff member lifts it. Leaving is always possible.

**Roles.** `member`; `leader` (listed publicly; manages requests, members,
gatherings, attendance, and moderates chat); `manager` (everything a leader can,
plus group settings and leader roles; not listed as a leader). Church staff with
the `groups` feature can do everything, including archive and delete. A leader
cannot remove or demote a manager; nobody can promote themselves.

**Archive.** Archived groups leave Discover, refuse joins, cancel future
gatherings, and their chat is **frozen, not deleted**: existing members keep
read-only history. Unarchiving thaws it. Permanent deletion is staff-only, only
for archived groups, and deletes the channel.

**Leaving the church ends group membership.** A relationship that becomes
`left` or `blocked` removes that person from every group of that church (by
trigger), which revokes chat through the ordinary reconciler.

**Direct messages.** Church policy: `disabled` (default — the safest choice,
consistent with every other FaithForm default being off), `leaders_only`
(leaders and staff may start conversations with people in their groups),
`leaders_and_members` (either side of a leader–member pair may start),
`group_members` (anyone sharing a group), `everyone` (anyone in the church).
**Youth rule:** anyone who is a *member* of a group whose safety profile is
`youth` cannot start or receive direct messages at all — group chat only.
Blocking in either direction refuses creation and freezes an existing
conversation. A policy change re-evaluates existing conversations.

**Notifications.** Global: all / mentions / off. Per group: default / all /
mentions / muted. Effective level = off if global is off, else the group level
if set, else global. Stored in FaithForm, pushed to Stream push preferences.

**Group gatherings and attendance.** A gathering gets a `service_occurrences`
row (`group_id` set) whose policy snapshot enables only `manual` and `admin`,
whose window opens a day before and closes 30 days after. It is excluded from
every church-wide check-in picker (geofence, QR, kiosk, Services) and from
church service reports, so a Wednesday small group can never capture a Sunday
check-in or inflate Sunday numbers. Present members are counted facts through
`record_attendance`; absent = the roster snapshot minus present; guests are a
headcount (no shadow People records).

**Rich cards.** A message carries `ff_card: { kind, id }` only. Clients resolve
it through `/api/mobile/v1/messaging/cards`, which re-authorizes every time;
deleted or no-longer-visible resources render as unavailable. Implemented kinds:
group gathering, church event/announcement, sermon. Polls use Stream's native
polls. Prayer requests are a message variant.

## 6. Failure model

| Failure | Behaviour |
| --- | --- |
| DB write succeeds, Stream call fails | The trigger already enqueued a reconcile job; the worker retries with exponential backoff (cap 1 h) and dead-letters after 12 attempts, visible in the dashboard. |
| Stream succeeds, DB write fails | Deterministic ids: the retry converges on the same channel; the reconciler diffs desired vs actual membership. |
| Partial member removal | Reconciliation is a diff, not a delta — the next run removes what is left. |
| Webhook delivered twice / out of order | `messaging_webhook_receipts` dedupes on `X-Webhook-Id`; handlers only record counts or enqueue reconciles, which read current FaithForm state. |
| Stream unavailable | FaithForm keeps working. Group pages render; chat shows "Messages are reconnecting"; commands still commit and sync later. |
| Token expiry | 60-minute tokens; clients use token providers that call FaithForm again. |
| Removed while offline / group deleted while open | Stream refuses the channel on reconnect; the app re-fetches the group, gets 404 or non-member, and says so. |
| Messaging not configured | Commands still work; the token endpoint returns `unavailable`; jobs wait. Production env validation fails loudly when Stream is enabled but keys are missing. |

## 7. Client integration (IA decision)

**Five tabs stay five.** iPhone and Android show Home, **Groups**, Check in,
Watch, Give. Account moves from the tab bar to a person button in the top bar of
every tab. The existing rationale for five tabs (Account must never fall behind
"More") is honoured more strongly, not less: Account is one tap from every
screen. Groups earns a tab because it is where people go every day, and it
carries the unread badge.

Groups tab: **My Groups · Discover · Messages** (Messages only when the church
allows direct messages). Group page: hero, then **Overview · Chat · Events ·
Members**. Chat uses StreamChatSwiftUI (iOS 5.11) and Stream Compose (Android
6.18, the last line built on the app's Kotlin 2.0.21 toolchain), themed with
FaithForm tokens and a custom composer (photos via the system picker — no photo
library permission). Web uses `stream-chat-react` 14 inside the dashboard.

## 8. Implementation order

1. Migrations 0091/0092 + static policy tests + real-Postgres tests.
2. `lib/messaging` (provider interface, Stream provider, ids, config, sync
   worker, webhooks) and `scripts/configure-stream-chat.mjs`.
3. `lib/groups` domain services and pure policy modules.
4. Mobile contract + routes; dashboard actions and route handlers; crons.
5. Dashboard Groups, Messages, Moderation, Insights, Settings.
6. iOS, then Android.
7. End-to-end flows A–E, security review, visual review, full suites, builds.

Verification results and exact counts are recorded at the end of this file when
the work is complete.

## 9. Verification (2026-09-19)

| Suite | Result |
| --- | --- |
| `pnpm test:groups-database` (full 98-migration chain on real Postgres) | 33 / 33 pass |
| `pnpm test` (unit, security, policies) | 1,370 / 1,370 pass |
| `pnpm typecheck` | clean |
| `pnpm contract:check` | current across JSON Schema, Swift, Kotlin |
| ESLint on all new/changed Groups & messaging code | clean |
| `pnpm check:features` | 2 pre-existing findings (`app/auth/callback/route.ts`, `app/dashboard/app/actions.ts`, unchanged since 9f925ca); none in new code |

Not built in this pass (stopped at the owner's request to finalize): the
dashboard Groups UI, the iOS and Android Groups/chat screens, and the new
database tests for `group_set_lifecycle` and the church-wide attendance
exclusions (both are applied by the migration chain above, but not asserted).
