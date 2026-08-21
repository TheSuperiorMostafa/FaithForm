# Prompt 2 Verification Matrix

Date: 2026-08-19

## Status legend

- **PASS — source/local:** implemented and verified without an external environment.
- **PENDING — non-production:** needs an authorized disposable or representative deployed environment.
- **PENDING — production:** needs authorized rollout, rotation, or live verification.
- **N/A:** deliberately outside Prompt 2.

No pending row should be interpreted as passed.

## Security gates

| Gate | Source/local evidence | Source status | Non-production gate | Production gate |
| --- | --- | --- | --- | --- |
| Donor portal does not trust email/request donor identity | `lib/giving/portal-session.ts`, `lib/giving/portal-billing.ts`, portal routes; portal unit and authorization regression tests | PASS — source/local | Valid/unknown/wrong-church/wrong-donor/customer mismatch smoke tests pending | Controlled production smoke pending |
| Magic link is single-use, exact-tenant, expiring, and revocable | Atomic `consume_donor_portal_token` migration; session tests; DB suite scenarios | PASS — source/local | Live DB replay/expiry/revocation suite pending | Post-migration controlled replay check pending |
| Public donor responses do not enumerate accounts/providers | Generic send-link response and bounded route; regression test | PASS — source/local | Response/timing observation pending | Controlled production observation pending |
| Persistent stream publish key is absent from browser/native/public outputs | Stable non-secret path; playback/ingest capability libraries; public status/browser publish/encoder/dashboard regression tests | PASS — source/local | Browser/native/network/log inspection pending | Inspection after deploy and legacy-key retirement pending |
| Viewer capability cannot publish and capabilities expire/tamper-fail | `tests/unit/capabilities.test.ts`; separated playback/ingest secrets | PASS — source/local | Relay/browser end-to-end denial pending | Post-rotation proof pending |
| HLS authorization is exact, direct-relay reads are denied, and responses are non-cacheable | HLS proxy checks capability/event/church/audience/status; MediaMTX read auth requires a separate playback credential; responses are `no-store` | PASS — source/local | Public/protected/staff/direct-relay/cache smoke pending | Controlled production smoke pending |
| Stream cancellation/moderation are tenant-bound | Exact `id` + `church_id` predicates and authorization regression test | PASS — source/local | Two-tenant denial test pending | Controlled denial check pending |
| Anonymous chat/view writes validate relationship, bounds, and quota | Server-only chat/view handlers; direct anon grant removal; atomic limiter; regression/policy tests | PASS — source/local | DB grants plus concurrent abuse tests pending | Rate/telemetry smoke pending |
| Media view replay amplification is idempotent | `media_views.idempotency_key` unique index and deterministic server key | PASS — source/local | Concurrent duplicate DB test pending | Metric observation pending |
| Encoder pairing/commands are bounded, tenant-bound, and never return a persistent key | Pairing CAS/random code; exact completion predicate; registration returns no stream key; start poll mints a bounded capability | PASS — source/local | Relay/encoder capability end-to-end tests pending | Re-pair and old-key denial proof pending |
| Raw integration credentials are service-role only | Migration revokes table/raw RPC; safe status projection; policy tests | PASS — source/local | Live grants/function and browser response checks pending | Live drift and provider reconnect pending |
| Storage writes bind admin and first path segment to tenant | Nine explicit storage write policies; policy tests; DB suite | PASS — source/local | Own/other/anon/non-admin/revoked cases pending | Live drift and controlled write pending |
| Stripe signature uses raw bytes and errors are sanitized | Webhook route/source test | PASS — source/local | Signed Stripe CLI/test fixture pending | Endpoint delivery observation pending |
| Stripe claims are atomic, leased, retryable, and ordered | Claim/complete SQL and wrapper; concurrency/backoff/stale-state source/unit tests | PASS — source/local | Concurrent duplicate, failure, lease recovery, stale event fixtures pending | Production event/reconciliation observation pending |
| Stripe tenant reconciliation is server-authoritative | Account mapping and metadata agreement; donor/fund exact-church predicates; tests | PASS — source/local | Mismatch/cross-tenant fixtures pending | Controlled production reconciliation pending |
| Receipts are durable and idempotent | Durable receipt claims, Resend idempotency key, bounded retry/terminal state, cron route | PASS — source/local | Forced provider failure + retry cron test pending | Cron install and one controlled delivery pending |
| Production config fails closed | `lib/env/production.ts`, middleware `503`, configuration tests | PASS — source/local | Missing/duplicate/insecure secret deploy tests pending | Secret inventory and post-deploy check pending |
| Rate limiting is atomic, private, proxy-aware, fail-closed | Atomic RPC, HMAC keys, trust policy, unit tests | PASS — source/local | Sequential/concurrent quota DB tests pending | Denial telemetry check pending |
| Dependency gate has no unresolved high/critical findings | `pnpm audit:prod`; lockfile patch verifier; dependency patch test | PASS — source/local | Hosted clean-install gate pending | Security-owner treatment signoff pending |
| Migration is ordered/additive and baseline constructs exist | `pnpm test:migrations`; no table/schema drops; full filename/checksum rehearsal ledger | PASS — source/local | Fresh and upgraded DB application pending | Approved migration/checksum record pending |
| Live database grants/policies/functions/buckets match manifest | `pnpm security:drift` source manifest passed; correctly reported missing `DATABASE_URL` | PASS — source/local | Read-only live drift pending | Pre/post production drift pending |
| Repository secret scan | `pnpm scan:secrets`: 780 files scanned, pass | PASS — source/local | Hosted CI run pending | Deployment secret/log inspection pending |
| Type, lint, tests, and production build | Typecheck pass; lint 0 errors/44 warnings; 39 tests pass; Next production build pass | PASS — source/local | Hosted CI run pending | Release artifact must match hosted CI pending |
| External secrets, OAuth tokens, stream keys, and webhooks rotated | Runbook only; no credentials accessed | PENDING — production | Rehearsal with non-production credentials pending | Authorized rotation/revocation inventory pending |

## Command evidence

These are the repeatable source/local checks:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:migrations
pnpm scan:secrets
pnpm security:drift
pnpm audit:prod
pnpm build
```

These require explicitly authorized database targets:

```bash
FAITHFORM_DB_TARGET=disposable DATABASE_URL='<disposable URI>' pnpm db:rehearse -- --all
FAITHFORM_DB_TARGET=disposable DATABASE_URL='<disposable URI>' pnpm test:database-security
FAITHFORM_DB_TARGET=nonproduction DATABASE_URL='<non-production URI>' pnpm db:rehearse -- --only 0050_security_baseline.sql
FAITHFORM_DB_TARGET=nonproduction DATABASE_URL='<non-production URI>' pnpm test:database-security
DATABASE_URL='<read-only URI>' pnpm security:drift
```

## Current signoff

| Role | State |
| --- | --- |
| Source implementation | Ready for review |
| Security review of code/local patch | Pending named owner |
| Database rehearsal | Pending access/owner |
| Non-production deployment | Pending access/owner |
| Production change authorization | Pending |
| Production security completion | Not claimed |
