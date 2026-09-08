# Prompt 2 Deployment and Rotation Runbook

Date: 2026-08-19  
Current state: source-ready; no external deployment or rotation performed

## Owners and approvals

Assign named people before scheduling the change:

| Responsibility | Required owner |
| --- | --- |
| Change authorization, go/no-go, rollback decision | Release owner |
| Supabase backup, migration, grants/RLS, live drift | Database owner |
| Vercel environment and application deploy | Application owner |
| Relay deployment, legacy-key retirement, encoder re-pair | Media/streaming owner |
| Stripe fixtures, webhook endpoint, financial reconciliation | Finance/Stripe owner |
| Resend delivery and cron observation | Messaging owner |
| Google/Facebook/YouTube or other OAuth token rotation | Integration owner |
| Exception signoff and security verification | Security owner |

Do not proceed without an approved maintenance window, an accessible backup/restore point, the previous known-good application and relay artifacts, and an explicit decision that no live stream or time-critical donation campaign is in progress.

## Required production environment

The application validates the following production values. Secrets must be independent, at least 32 characters where required, non-placeholder, and stored only in the platform secret store.

```text
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
SUPABASE_SECRET_KEY
NEXT_PUBLIC_SITE_URL
DONOR_PORTAL_SESSION_SECRET
INTEGRATION_OAUTH_STATE_SECRET
N8N_WEBHOOK_SECRET
RATE_LIMIT_KEY_SECRET
STREAM_RELAY_WEBHOOK_SECRET
STREAM_RELAY_PLAYBACK_SECRET
STREAM_INGEST_SIGNING_SECRET
STREAM_PLAYBACK_SECRET
STREAM_HLS_UPSTREAM_URL
STREAM_WS_INGEST_UPSTREAM_URL
CRON_SECRET
STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
RESEND_API_KEY
```

Use `https://` for public/site/HLS endpoints and `wss://` or `https://` for the stream ingest upstream. Do not copy one secret into multiple roles.

## Phase 1: disposable database rehearsal

Use only a database created for destructive testing. The runner refuses targets not explicitly marked `disposable` or `nonproduction`.

```bash
FAITHFORM_DB_TARGET=disposable DATABASE_URL='<disposable database URI>' pnpm db:rehearse -- --all
FAITHFORM_DB_TARGET=disposable DATABASE_URL='<disposable database URI>' pnpm test:database-security
DATABASE_URL='<read-only disposable URI>' pnpm security:drift
```

Pass conditions:

- Every migration is recorded by full filename and checksum.
- The database security suite passes, rolls back its role/RLS fixtures, and explicitly removes its randomized two-connection concurrency fixtures.
- Expected functions, role grants, table grants, policies, and buckets match `security/baseline-manifest.json`.
- No raw integration token is available to anonymous/authenticated clients.
- Magic-link replay, cross-tenant storage writes, and rate-limit overrun are denied.

## Phase 2: representative upgraded non-production environment

First inspect the environment with a read-only database identity:

```bash
DATABASE_URL='<read-only non-production URI>' pnpm security:drift
```

Review the exact recorded migration history. With database-owner approval, apply only the new additive migration:

```bash
FAITHFORM_DB_TARGET=nonproduction DATABASE_URL='<non-production URI>' pnpm db:rehearse -- --only 0050_security_baseline.sql
FAITHFORM_DB_TARGET=nonproduction DATABASE_URL='<non-production URI>' pnpm test:database-security
DATABASE_URL='<read-only non-production URI>' pnpm security:drift
```

Deploy the application and relay using non-production secrets, then complete these scenarios:

1. Donor portal: valid, unknown email, wrong church, wrong donor, expired link, replayed link, revoked donor, signed-out session, and Stripe customer mismatch.
2. Streaming: public live playback, protected denial, staff playback, expired/tampered capability, browser publish, relay capability resolution, encoder pair/poll/complete, cross-tenant cancel/moderate denial, and cache headers.
3. Anonymous abuse: chat/view/portal/encoder payload caps, quota `N` success, request `N+1` denial, and concurrent quota attempts.
4. Stripe: signed test-mode event, duplicate simultaneous delivery, handler failure, lease expiry/recovery, stale event, metadata mismatch, refund/dispute, and unique donation/subscription reconciliation.
5. Email: force Resend failure, verify durable pending state, run `/api/give/receipts/retry` with the cron secret, and confirm one logical receipt.
6. Integrations/storage: safe status projection only; own-tenant admin writes succeed while other tenant, non-admin, anonymous, and revoked membership writes fail.

Do not promote unless all scenarios are recorded in `P2_VERIFICATION_MATRIX.md` or a linked change ticket.

## Phase 3: production migration and application deployment

The database owner must use the approved deployment pipeline. Do not paste production credentials into terminal history or repository files.

1. Freeze relevant releases and verify no live stream is active.
2. Capture a database backup/restore point and current read-only drift report.
3. Verify the SHA-256 checksum of `supabase/migrations/0050_security_baseline.sql` matches the reviewed artifact.
4. Apply `0050_security_baseline.sql` transactionally through the approved migration mechanism.
5. Run the live read-only drift report and verify the exact functions, execution grants, `church_integrations` grants, storage policies, and bucket state.
6. Configure the complete environment manifest. Confirm each role-specific secret is distinct.
7. Deploy the application artifact that passed hosted CI.
8. Deploy the matching relay artifact with the bootstrap option so the loopback auth-bridge service is installed before MediaMTX. The bridge adds `STREAM_RELAY_WEBHOOK_SECRET` as a header and keeps it out of the auth callback URL. MediaMTX must use the stable `live/{churchId}` path and authorize the short-lived query/password capability. Direct HLS reads must require the distinct `STREAM_RELAY_PLAYBACK_SECRET`; only loopback RTSP fan-out is exempt. The WebSocket relay must call `/api/stream/ingest-capability` using the relay header; no component may fall back to the historical static key. Confirm the relay log sanitizer is active before a test publish.
9. Confirm the receipt cron is installed from `vercel.json` and observe one authorized execution.
10. Perform the minimum production smoke tests below before rotating external credentials.

Minimum smoke tests:

- Health/navigation works; intentionally invalid configuration produces a generic fail-closed response.
- Unknown and known donor email requests return the same generic public response.
- A controlled donor can open only their own church/customer portal and a consumed link cannot be replayed.
- Public viewer playback works without any publish key in HTML, JSON, URLs, logs, or browser storage.
- Cross-tenant event mutation and storage writes fail.
- A signed low-value Stripe test/live-mode event follows the organization's approved financial test procedure and reconciles once.
- Receipt retry endpoint rejects a missing/wrong cron secret and succeeds with the platform invocation.

## Legacy stream-key retirement and encoder cutover

Perform this only after application and relay smoke tests pass and while no event is live.

1. Confirm `0050_security_baseline.sql` changed each stream integration to `credential_mode=capability_v1`. This one-time guarded update replaces the prior static value with a server-only configuration marker; the marker is not accepted by publish auth.
2. Confirm the application publish-auth route rejects a legacy `live/{churchId}/{oldKey}` path and accepts only a valid ingest capability bound to the path church.
3. Deploy the stable-path MediaMTX configuration and the capability-resolving WebSocket relay.
4. Update/re-pair every authorized encoder agent. Registration must return only the device credential and safe ingest host; a fresh bounded capability arrives only with a start command.
5. Start a private controlled event and verify relay ingest, playback, reconnect within the capability lifetime, and exact command completion.
6. Prove the previous static key and a credential-bearing legacy path are rejected.
7. Prove direct HLS without the app-to-relay playback credential is rejected while the scoped application playback proxy works.
8. Prove expired, altered, and wrong-church ingest capabilities are rejected and a viewer capability cannot publish.
9. Inspect browser/native storage, responses, relay logs, callback URLs, process telemetry, and cache entries. Record that the historical key is absent everywhere, the relay webhook secret is absent from URLs, and capabilities, signed upload URLs, provider destination values, and tenant identifiers are absent from logs.

If cutover fails, keep public streaming offline and repair the capability path. Do not restore legacy static-key authentication or resurrect a value that may have been exposed.

## Integration and webhook secret rotation

For each provider, inventory the active credential and callback first. Rotate one integration at a time:

1. Create the replacement credential with minimum scopes.
2. Store it in the server-side integration path and reconnect through an authorized admin flow.
3. Verify browser clients receive only safe status metadata.
4. Exercise the provider operation and observe sanitized logs.
5. Revoke the old credential at the provider.

Rotate Stripe webhook secrets by creating/validating the replacement endpoint secret, updating the platform secret, deploying, delivering a signed fixture, and then disabling the prior secret. Rotate Resend, cron, relay, OAuth-state, donor-session, playback, ingest-signing, rate-limit, and automation secrets under their owning systems. Rotating `DONOR_PORTAL_SESSION_SECRET` intentionally invalidates outstanding donor sessions; communicate that behavior.

## Monitoring and rollback

Monitor generic failure categories, webhook claim/retry/terminal counts, pending donation receipts, rate-limit denials, relay capability rejection, encoder reconnects, and integration reconnect status. Never add raw tokens, email addresses, payment payloads, signatures, or publish keys to diagnostic logs.

Rollback principles:

- Prefer roll-forward. The migration is additive; keep its restrictive grants/policies and security columns in place.
- Never restore anonymous direct chat writes, authenticated raw integration table/RPC access, or persistent publish keys in browser responses.
- If the application must roll back, disable donor portal, public chat/view mutations, affected integration screens, Stripe webhook processing, or streaming as needed until a compatible secure artifact is deployed.
- If the relay must roll back after capability cutover, keep ingest offline and roll forward to a compatible capability-aware relay. Never re-enable the revoked static-key path.
- If Stripe handling is paused, retain webhook records and provider retries, then reconcile by event ID before resuming. Do not mark receipts sent manually without provider evidence.
- If database behavior is wrong, capture evidence and use a reviewed forward migration. Do not drop security tables/functions or broadly re-grant roles as an emergency shortcut.

## Completion record

The release owner closes Prompt 2 production rollout only after attaching:

- hosted CI result and artifact identifier;
- pre/post database drift reports and migration checksum;
- database security suite result from disposable and upgraded non-production environments;
- deployed donor, streaming, storage, integration, rate-limit, Stripe, and email smoke evidence;
- secret/key rotation inventory with old credentials revoked;
- owner/date approval for the temporary `image-size` risk treatment;
- updated `P2_VERIFICATION_MATRIX.md` showing production gates complete.
