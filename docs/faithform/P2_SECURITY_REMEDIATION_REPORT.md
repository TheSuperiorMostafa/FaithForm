# Prompt 2 Security Remediation Report

Date: 2026-08-19  
Source baseline: `main` at `0ac6667`  
Scope: Prompt 2 security remediation and reproducible production baseline only

## Executive status

| Layer | Status | Meaning |
| --- | --- | --- |
| Source implementation | Complete | Code, migration, dependency lock, tests, CI configuration, drift tooling, and runbooks are present in the repository. |
| Local source verification | Complete | Unit/security/policy tests, migration checks, secret scan, typecheck, lint, production build, and the production dependency gate passed. |
| Disposable database rehearsal | Pending external access | The repository has a guarded migration runner and database security suite, but no authorized disposable database was available. |
| Representative non-production validation | Pending external access | Migration application, live grants/RLS checks, Stripe test-mode fixtures, relay/encoder capability cutover, and deployed smoke tests require approved environments and owners. |
| Production rollout and rotation | Pending authorization | No production database, Vercel project, relay, encoder, Stripe account, Resend account, or integration provider was changed. |

This report means the source remediation is ready for controlled rehearsal. It does **not** claim that any external environment is remediated.

## Security architecture lock

The implementation keeps the existing FaithForm architecture: Next.js application, Supabase, Stripe, Resend, the stream relay, and encoder clients. It introduces no new public domain or provider. Security-sensitive browser operations use short-lived capabilities or server-side projections. Every publisher—including the paired native encoder—uses an expiring ingest capability on a stable non-secret path; persistent credentials remain server-only and do not authorize ingest.

The locked boundaries are:

1. Browser requests never supply donor identity, tenant identity, Stripe customer identity, or a persistent stream publish key as authority.
2. Tenant-changing operations require an authenticated membership and an exact `church_id` predicate.
3. Anonymous writes pass through bounded server handlers, atomic rate limits, and an authoritative publication relationship check.
4. Raw integration credentials and privileged RPCs are service-role only. Browser-visible integration state is an allowlisted projection.
5. Provider callbacks are signature-verified, tenant-reconciled against server records, leased atomically, ordered, and idempotent.
6. Production configuration fails closed when required secrets are missing, weak, duplicated, placeholder-like, or paired with insecure URLs.

## Remediation ledger

| Area | Root cause | Remediation and principal evidence | Automated evidence | External work remaining |
| --- | --- | --- | --- | --- |
| Donor portal authorization | Email and request input could be treated as donor authority. | Signed root-scoped portal cookie binds version, session, church, donor, and expiry. Billing customer is resolved only from the verified session's exact church/donor subscription in `lib/giving/portal-session.ts` and `lib/giving/portal-billing.ts`. Link requests are generic and do not create or enumerate donors. | `tests/unit/portal-session.test.ts`, `tests/unit/portal-billing.test.ts`, `tests/security/authorization-regressions.test.ts` | Apply migration; run valid, wrong-church, wrong-donor, expired, revoked, and unknown-email scenarios in non-production. |
| Magic-link replay/revocation | Token lookup and consumption were not one replay-safe database mutation. | `consume_donor_portal_token` atomically verifies exact church/donor, unused state, expiry, donor revocation, and session revocation before consuming. Sign-out revokes the server-side session. | Source/policy tests plus live DB replay/revocation scenarios and a randomized two-connection race in `scripts/run-database-security-tests.mjs` | Execute DB suite against disposable and upgraded non-production databases. |
| Stream publish secret exposure | Persistent ingest material crossed browser and paired native-encoder boundaries, was embedded in the media path, and machine auth supported URL credentials. | Viewer playback uses a separate short-lived HMAC authority. Browser, WHIP, simulated, WebSocket, and paired encoder publishing use scoped expiring ingest capabilities on `live/{churchId}`. MediaMTX authorizes the capability and rejects credential-bearing legacy paths. A loopback auth bridge moves the relay credential into a header, and relay subprocess/client diagnostics are allowlisted/redacted. The migration retires each old stream token once behind an idempotent capability-mode marker. Public status, HLS, encoder registration, dashboard, and relay-facing outputs no longer serialize the persistent key. | `tests/unit/capabilities.test.ts`, `tests/security/authorization-regressions.test.ts`, `tests/security/configuration-and-webhooks.test.ts`, `tests/policies/security-migration.test.ts` | Deploy migration, app, auth bridge, relay, and encoder agent together in a maintenance window; re-pair encoders; prove the old static key and expired/tampered capabilities fail; inspect sanitized logs. |
| Playback authorization/cache leakage | A playable URL could outlive or bypass the exact live/replay relationship, including by reading the relay directly. | HLS proxy validates capability audience, church, event, expiry, and active public/staff eligibility. MediaMTX read auth requires a distinct app-to-relay playback credential, with only loopback RTSP fan-out exempt. Public status excludes protected events. Sensitive responses are `no-store`. | Capability and authorization regression tests; production build | Non-production public/private/staff playback, direct-relay denial, and cache inspection. |
| Tenant stream mutation IDOR | Some event cancellation and chat moderation mutations did not include tenant ownership at the final write. | Exact `id` plus authenticated `church_id` predicates are required in stream events and chat moderation. | `tests/security/authorization-regressions.test.ts` | Cross-tenant deployed smoke test with two churches. |
| Public chat/view abuse | Anonymous database writes and weak relationship checks permitted bypass or amplification. | Anonymous direct chat writes are revoked. Chat/view handlers validate bounded payloads, exact live/replay/church/public relationships, and use atomic privacy-preserving rate-limit keys. Media views have deterministic idempotency and a unique index. | Security/policy tests and migration verification | Run DB grant/RLS suite and load/abuse tests in non-production. |
| Encoder command/pairing abuse | Command completion and pairing needed stronger relationship and collision controls. | Completion binds device, church, and pending state. Pairing uses a compare-and-set update and cryptographic random code. Public registration is bounded and rate-limited. | Security tests, typecheck, build | Exercise pair/poll/complete/replay flows with a non-production relay and encoder. |
| Integration credential exposure | Authenticated clients could reach credential-bearing table/RPC data. | Raw table access and raw-token RPC execution are revoked from anonymous/authenticated roles. Server code uses the admin client. The safe status RPC allowlists display metadata and omits tokens, provider URLs, and raw reconnect details. | `tests/policies/security-migration.test.ts`, `tests/security/authorization-regressions.test.ts` | Verify live grants/functions and rotate provider tokens after rollout. |
| Cross-tenant storage writes | Public asset buckets did not consistently bind write paths to an admin's tenant. | Insert/update/delete policies require admin membership and require the first object path segment to equal that admin church for logos, covers, and social graphics. Bucket reads remain public by design. | Policy tests and live rollback-only DB suite | Verify own-tenant success, other-tenant denial, anonymous denial, and revoked-membership denial in Supabase. |
| Stripe webhook races/duplicates | Check-then-handle processing, metadata trust, and unordered provider updates could duplicate or misattribute effects. | Leased atomic claims support retries and crash recovery. Stripe account mapping is authoritative; metadata must agree. Donor/fund relations are tenant-bound. Provider event time prevents stale overwrites. Donation/subscription reconciliation tolerates insert races with unique provider keys. Persisted failures contain safe categories only. | `tests/security/configuration-and-webhooks.test.ts`, `tests/security/webhook-state.test.ts`, unit tests | Run signed Stripe CLI/test-mode duplicate, concurrency, stale-event, tenant-mismatch, failure, replay, and recovery fixtures. |
| Receipt/dunning delivery | Mark-before-send and retry ambiguity could lose or duplicate email. | Donation receipts use durable claims, bounded backoff, terminal state, a retry cron, and provider idempotency keyed by donation ID. Dunning uses the failed invoice ID and records success only after provider acceptance. Raw addresses/provider payloads are not logged. | Webhook/configuration tests and source tests | Deploy cron, provoke provider failures in non-production, confirm one logical email and successful recovery. |
| Rate limiting/configuration | Process-local/fail-open controls and untrusted forwarding could be bypassed. | Atomic database limiter, HMAC-derived privacy keys, explicit trusted-proxy handling, and fail-closed behavior. Production validation requires distinct strong secrets and secure URLs; middleware returns a generic `503` on invalid configuration. | `tests/unit/rate-limit.test.ts`, `tests/security/configuration-and-webhooks.test.ts` | Configure production secret store, apply limiter RPC, then verify missing-secret and quota behavior in a deployed non-production environment. |
| Vulnerable dependency baseline | Framework and transitive packages included known high/critical findings. | Next.js and ESLint config moved to Maintenance LTS `15.5.21`; direct/transitive versions are locked. Unused dependencies were removed. Two unfixed `image-size` parser DoS paths are locally patched and enforced by lockfile and tests. | `pnpm audit:prod`, `tests/security/dependency-patch.test.ts` | Security owner must approve the temporary treatment and replace/remove the affected path when an upstream fix or viable library replacement is available. |
| Migration/CI drift | Versioned schema state and deployed grants/policies could diverge without a reproducible gate. | Additive migration `0050_security_baseline.sql`, full-filename/checksum rehearsal ledger, source baseline manifest, live read-only drift report, secret scan, frozen lockfile install, and CI verification scripts. | `pnpm test:migrations`, `pnpm security:drift`, `pnpm scan:secrets`; workflow in `.github/workflows/ci.yml` | Run the migration and live drift report in authorized databases; require a hosted CI pass before promotion. |

## Migration safety

`supabase/migrations/0050_security_baseline.sql` is additive and rerunnable where practical. It does not drop tables or schemas. It intentionally drops/replaces only named policies and adjusts grants required to close the credential/chat exposures. Application rollback must not re-grant browser credential access, anonymous chat writes, or restore persistent publish keys to browser responses.

The legacy migration set contains repeated numeric prefixes. The source migration verifier locks and reports the known set. The guarded rehearsal runner records the full filename and SHA-256 checksum, avoiding prefix ambiguity. Existing environments must be inspected with the read-only drift report before selecting the single `0050` upgrade migration.

## Verification performed locally

- Test suite: 39 passing tests; zero failures.
- TypeScript: passed with no type errors.
- Lint: passed with zero errors; 44 warnings remain.
- Next.js production build: passed on Next.js `15.5.21`.
- Migration source gate: passed; `0050` is ordered after 53 legacy migrations and required constructs were found.
- Secret scan: passed across 780 repository files.
- Source drift manifest: passed; live database inspection was explicitly skipped because `DATABASE_URL` was not supplied.
- Production dependency gate: passed with zero unresolved high/critical advisories. Raw registry output still reports two high `image-size` advisories, both matched to the reviewed local patch and recorded in the dependency risk register.

## Deliberately not claimed

- No production or non-production migration was applied.
- No external secret, stream key, OAuth token, API key, or webhook secret was rotated.
- No hosted CI run, deployed smoke test, Supabase Advisor result, Stripe fixture, provider reconnect, or relay/encoder test was performed.
- Findings outside Prompt 2 in the Prompt 1 audit are not silently closed by this work. In particular, broader product gaps and later-prompt work remain governed by the existing architecture and sequence documents.

The exact rollout and rollback sequence is in `P2_DEPLOYMENT_AND_ROTATION_RUNBOOK.md`; evidence-to-gate mapping is in `P2_VERIFICATION_MATRIX.md`.
