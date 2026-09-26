# FaithForm production-hardening audit — progress log

Living document. Updated after every verified batch so the work survives context
compaction. Newest entries at the bottom of each section.

## Ground rules

- Production is never touched. The app under test runs from a git worktree with
  **no `.env.local`** (the production keys live only in the main checkout), against
  a local Supabase stack in Docker.
- Every fix: reproduce → root cause → regression test → smallest fix → verify in
  browser/API → targeted tests → full suite. Commit per verified batch.
- Branches: `audit/production-hardening` (session 1, 15 commits, not pushed —
  push was blocked by the permission check); `audit/overnight` (this pass,
  worktree, built on top of it).

## Setup learned (commands)

- Worktree: `<scratch>/ff` on branch `audit/overnight`
  (`git worktree add -b audit/overnight <scratch>/ff audit/production-hardening`).
- Local Supabase: `<scratch>/sb` (`npx supabase@2.118.0 init`, config: project_id
  `fflocal`, Postgres 15 like prod, studio/analytics/realtime/edge off,
  redirect URLs for localhost + `faithful://`). Start: `cd <scratch>/sb && npx
  supabase@2.118.0 start`. Its own migration runner is NOT used: the repo has
  legacy duplicate prefixes (0003/0010/0011/0019). Migrations are applied in
  filename order with psql, inserting the seed church before 0007 (see
  `scripts/run-groups-database-tests.mjs`).
- Scratch Postgres for DB tests (session 1): Postgres 17 at 127.0.0.1:55432,
  needs `LC_ALL=en_US.UTF-8` and a short socket dir (`-k /tmp/ffpg`).
- DB suites: `FAITHFORM_TEST_DATABASE_URL=postgres://postgres@127.0.0.1:55432/postgres
  pnpm test:groups-database` (full chain, fresh DB per run);
  `pnpm test:concurrency` needs an EMPTY database (it builds in place).
- CI-like env for build: `NEXT_PUBLIC_SUPABASE_URL=https://ci-faithform.invalid
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_ci_only_not_a_real_key
  SUPABASE_SECRET_KEY=ci-supabase-secret-000000000000001
  NEXT_PUBLIC_SITE_URL=https://ci-faithform.invalid`.

## Session 1 (code audit, already committed on audit/production-hardening)

Fixed and regression-tested: storage path traversal (P0); team-invite account
takeover (P0); fund church-id override (P0); manual attendance cross-church (P0);
stream_recordings writable by any admin (P0, 0107); migration 0100 syntax (P1);
Next.js RCE advisories; Stripe receipt forgery / partial refund / same-second
overwrite (P1); OAuth state expiry + callback re-authorization + open redirect;
second Go Live ending YouTube; push worker duplicates/timeouts; chat sync race
(0109) + empty-channel on read error; kids checkout ticket; group attendance
cross-group; stream keys in snapshot; reconciler starvation; 0108 slide-version
church check + visitor_accounts writes; impersonation cookie ownership; mobile
sign-out revoke; mobile giving rate limit; CSV injection; announcements writes;
misc guards. 1,722 tests passing at end of session 1.

## Areas browser-tested (this pass)

- Setup (self-serve church creation) x2, incl. double-click (one church created),
  Unicode/emoji church name, mixed-case email (normalized). Lands on dashboard.
- Sign-out (cookie cleared, /dashboard redirects). Collapsed sidebar reveals
  Sign out on hover/focus (by design).
- Route sweep as church admin: all 60+ dashboard/admin/public routes render
  (200 or correct redirect); `/admin` refuses a non-platform admin.
- IDOR sweep as Church B admin against Church A ids: 21 detail pages and APIs
  (households, groups, announcements edit, sermon pages/exports, call log,
  donor, recordings, member files, giving statements/exports) — no Church A
  marker in any response; exports contain only the caller's church.
- Cross-church writes via REST (sermon PATCH/DELETE, refund, statements):
  refused, DB unchanged.
- Server-action battery (29 id-taking actions, called as Church B with Church A
  ids): Church A data fingerprint unchanged before/after.
- People: add person with HTML/script payload + emoji — stored, rendered as
  text, no injected element in DOM.
- Team: invite Volunteer (temp password shown when email is off), Change
  access -> Make new password (reset rules), sign-in with temp password ->
  forced set-password -> dashboard.
- Volunteer permissions: 28 gated routes (leaks found + fixed), 13 admin-only
  settings actions refused, settings fingerprint unchanged.
- Kids check-in end to end in the browser: add room (double-click -> 1 room),
  find family (allergy note shown), check in (double-click -> 1 session),
  pickup code shown; Pick up: wrong code -> clear message; right code ->
  guardian -> release (double-click) -> recorded method=code, released to
  guardian. Forged releases (code without ticket, override w/o reason, adult not
  on list) all refused.
- Groups: create with Church A's category -> refused; with Church A's person ->
  silently skipped; own person added as leader.
- Announcements composer: post to app (members only) with HTML in title/body ->
  saved, rendered as text, one notification queued for Church B members.
- Mobile API as app user (Maria): bootstrap, consent, profile/follow/join
  (non-discoverable church answers "not found" by design), follower does not
  see members-only item, admin approval (volunteer refused), member sees it;
  12 cross-church id probes via Church B's slug all refused; sign-out revokes
  that session only.
- Cron endpoints (10): 401 without/with wrong secret, run with right secret.
- Platform admin: /admin pages render; step into Church A (sees A's people),
  "Leave this church"; leftover acting-as note + another user's session ->
  note deleted by middleware, other user sees only own church.
- Onboarding invite flow end to end: admin creates church+invite -> invite
  link -> 6-step wizard (email field read-only; tampered email ignored,
  account created for the invitee) -> dashboard; church onboarding_completed,
  invite accepted, invitee is admin; reused link -> dashboard.
- Live: go live (no relay) -> session waiting for video, second Go Live refused
  (session-1 fix), end -> recording honestly "nothing recorded", second end
  refused clearly.
- Website: create (repeat refused), publish, public site renders; unpublished
  Church A site 404; give/live public pages render.
- Attendance: service time -> occurrences via cron; mark present counted, repeat
  "already counted", Church A person rejected, Church A admin refused Church B's
  service (session-1 fix at runtime).
- AI-backed endpoints without provider keys degrade with plain messages;
  scripture lookup works offline.
- Giving settings: duplicate/similar fund names refused, 300-char name trimmed
  to 80, Church A funds untouched by Church B actions, slug squatting refused.
- Dev server restarts itself at its memory threshold (dev-mode only) — cause of
  earlier unanswered requests; not a product bug.
- Webhooks/relay (15): forged/absent signatures refused (Stripe 400, others 401,
  chat webhook 503 not_configured locally).

## Bugs found / fixed (this pass)

1. P3 — church slug dropped accented letters ("Iglesia Ñoño" -> "iglesia-o-o").
   Fix: NFD + strip marks in `generateChurchSlug` and both giving slugify fns
   (new slugs only; existing addresses untouched). Test: church-setup.test.ts.
2. P2 — `saveMemberCareDetails` answered `{ok:true}` for another church's
   member (nothing written) — false success. Same in check-in
   `updateMemberCareDetails`, `moveSession`, recording `chooseThumbnail`.
   Fix: `.select("id")` and report zero rows. Test: zero-row-writes.test.ts.
3. P3 — check-in room ids (default room, move) were not checked to belong to the
   church. Fix: `lib/checkin/owned-location.ts` used by all three actions.
4. P1 — **gated pages sent their data behind the "No access" screen.** A
   Volunteer (Attendance + Kids Check-in) received, in the page payload: the
   whole People directory (phones, emails), families incl. a child's medical
   notes, a call transcript, sermon text, a donor phone. Cause: `<FeatureGate>`
   is in the layout; App Router renders page and layout in parallel, so the
   page still ran. Fix: `lib/features/page-gate.ts` `pageFeatureBlocked()` as
   the first statement of all 62 async pages under a gated layout (8 sync pages
   are redirects). Test: feature-gated-pages.test.ts walks the tree, fails on
   the old code. Verified: Volunteer sweep clean; admin still sees data.
5. P2 — forced password change could be skipped: flag in user_metadata, which
   the user can edit via the auth API (reproduced). Fix: flag authoritative in
   app_metadata (set on invite/reset, cleared on set-password with session
   refresh so no redirect loop); user_metadata honoured only when app flag
   absent (older invites). Verified end to end in the browser: temp password ->
   /set-password -> own password -> /dashboard; self-clear attempt stays at
   /set-password. Also: raw auth error text no longer returned.
7. P2 — platform admin "Add Church" double click created two identical churches
   with an open invite each (reproduced in browser). Fix: createChurch returns
   the church the same request already made (same name, <10 min, no staff,
   same open invite). Verified: double click -> 1 church, 1 invite. Test:
   admin-create-church-repeat.test.ts.
8. P3 — choosing a main giving fund with a stale/foreign id cleared the
   church's main fund and set nothing (reproduced: Church B left with no main
   fund). Same clear-first shape in updateCampus (primary campus) and
   setDefaultAdultLocation. Fund rename/remove/default for a foreign id
   answered "{}" (success). Fix: set-then-clear for funds (no unique index);
   verify target first for campus/room; zero-row writes reported. Verified at
   runtime; test set-then-clear-defaults.test.ts.
6. P3 — Volunteer refusals said "Something went wrong" (settings discovery,
   invitations) or threw unhandled (fund publication). Now "Only church admins
   can…". Verified via actions.

## Remaining areas

- [x] Local stack up, migrations applied, two churches seeded
      (Alpha Grace Church / alice@alpha.test; Iglesia Beta / bob@beta.test;
      passwords LocalAudit-A1! / LocalAudit-B1! — local stack only; seed ids in
      table `audit_seed`, seed script `<scratch>/seed.sql`)
- [ ] Auth: login, logout, magic link, password reset, set-password, stale session
- [ ] Onboarding / setup flow (new church)
- [ ] Dashboard home, settings, team (roles, invite, reset)
- [ ] People / members / households / files / care
- [ ] Groups (create/edit/archive/members/requests/gatherings/attendance)
- [ ] Messaging (dashboard side, degrade without Stream Chat)
- [ ] Announcements (compose, publish, app visibility, delete)
- [ ] Attendance / services / check-in / kiosk / checkout
- [ ] Live streaming / recordings / media library / publishing
- [ ] Giving (degrade without Stripe), donor portal
- [ ] Website builder, church app settings
- [ ] Sermons / sermon builder
- [ ] Platform admin (/admin), impersonation
- [ ] Mobile API (bearer auth) incl. cross-church ID manipulation
- [ ] Cron / webhook endpoints (auth, idempotency)
- [ ] Second adversarial pass + full suite from clean state

## Tooling notes (this pass)

- Local stack: `<scratch>/sb` Supabase on ports 563xx (API 56321, DB 56322,
  mail 56324). ATLAS/athena/faithform-local containers belong to other
  projects — never touch them. App: worktree `<scratch>/ff`, dev server on 3100
  via temporary `.claude/launch.json` entry "faithform-audit-local" in the MAIN
  checkout (remove at the end). Env: `<scratch>/ff/.env.development.local`
  (fake secrets, no provider keys).
- `next start` (production mode) refuses non-HTTPS Supabase/site URLs, so the
  audit runs in dev mode; dev logs are flooded by a known sync-cookies warning —
  search logs for `⨯` for real errors.
- Helpers in `<scratch>`: `cookie.mjs` (session cookie for any local user),
  `sweep.sh` (route status), `idor.sh` (Church A marker leak check),
  `act.mjs` + `actions-map.mjs` (server actions by name; JSON args only —
  form-based actions are tested through the browser UI), `fingerprint.sql`
  (Church A data hash), `lq` (psql to local DB).
- Supabase access tokens stay valid until expiry (1h) after sign-out (local
  JWT verification) — known limitation, logged under risks.

## Unresolved risks (carried from session 1)

- Staff feature permissions not enforced in RLS (viewer can read giving, call
  transcripts, children's medical notes through their own session).
- 0106 made all unlisted recordings public, irreversibly.
- No error tracking; backups/PITR unverified.
- No CAPTCHA on public giving; donor magic link consumed by GET; kiosk idle lock;
  weak never-expiring temp passwords; sermons cascade on auth-user delete;
  geofence trusts device coordinates.
