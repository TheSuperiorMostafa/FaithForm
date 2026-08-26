# Prompt 4 — The Faithful mobile contract

Boundary: `/api/mobile/v1`. Canonical source: `lib/mobile/v1/contract.ts`.

## Versioning

The version lives in the **path**, not a header. `apiMajor` is `1`; a breaking
change means `/api/mobile/v2`, not a flag. `apiVersion` (`2026-08-24`) is a
dated build marker that moves on additive changes and lets support tie a report
to a deployment.

**Additive is safe; anything else is not.** Within v1 a field may be added, an
enum may gain a value, and an endpoint may be added. Nothing may be renamed,
removed, retyped, or have its meaning changed. Both native clients ignore
unknown fields and decode unrecognised enum values to `unknown`, and a fixture
with unknown fields at three nesting levels proves it in all three languages.

`minimumSupportedClientBuild` gates old builds. A client sends
`X-FaithForm-Client-Build`; below the minimum it receives
`client_version_unsupported` (410). **Absent is tolerated**, not treated as too
old — a client that never learned to send the header must still reach the server
to be told to upgrade.

Deprecation is announced in-band: `meta.deprecation` carries `sunsetOn` and a
`replacement` path, so a client can warn before the endpoint disappears.

## Envelopes

Success and failure share one `meta` block, so a client parses correlation
before it knows the outcome.

```json
{ "ok": true,  "data": { … }, "meta": { … } }
{ "ok": false, "error": { "code", "message", "retryable", "fields?", "retryAfterSeconds?" }, "meta": { … } }
```

`meta` = `apiVersion`, `apiMajor`, `requestId`, `minimumSupportedClientBuild`,
optional `deprecation`.

## Authentication

Supabase Auth issues and refreshes credentials. **All product access goes
through this contract** — a native client never queries Supabase tables.

`Authorization: Bearer <supabase access token>`, verified server-side with the
*publishable* key (`lib/mobile/v1/handler.ts`). **No service-role credential
exists in either app.** The account is resolved from the token; a client-supplied
church or record id never grants anything.

`session_expired` (401) is distinct from `unauthenticated` (401) so a client
refreshes and retries instead of dumping the person back to sign-in. Refresh is
single-flight on both platforms — verified with 12 concurrent callers producing
exactly one refresh.

## Errors

23 codes, each mapping to exactly one status. Full table in
`lib/mobile/v1/errors.ts`; the mapping is asserted in all three languages.

`retryable` is computed server-side (`rate_limited`, `unavailable`,
`internal_error`) so retry policy is not hard-coded into released clients.

**Redaction is structural.** Only `MobileError` and Prompt 3's `VisitorError`
carry a client-visible message. Everything else becomes `internal_error` /
"Something went wrong." A domain code with no mobile meaning degrades to
`internal_error` rather than leaking its name. Nothing logs the error object —
only the request id — because it may embed a query, a row, or a provider payload.

## Cursors

Opaque base64url JSON, `{ k: <list kind>, v: [...] }`. Keyset, never offset.

The `k` field means **a cursor minted for one list cannot be replayed against
another** — the decoder rejects a kind mismatch. Malformed, oversized (>512 B),
and foreign cursors all raise `invalid_cursor`.

Limits: default 20, maximum 50. Every collection is bounded; there is no
unbounded list in the contract.

## ETags and conditional requests

Strong ETags over semantic content (SHA-256 of the payload, truncated), so two
servers with clock skew agree and an unchanged payload keeps its tag across a
deploy. Volatile fields are excluded — `serverTime` is not part of the bootstrap
ETag, or revalidation would never succeed.

`If-None-Match` handles exact, weak (`W/`), comma-list, and `*` forms.
Comparison is constant-time so the tag is not a probing oracle. A match returns
**304 with no body**; both clients keep what they hold.

## Idempotency

`Idempotency-Key` on retryable commands: 8–120 URL-safe characters, required for
`POST /account/requests`. A phone that loses a response and retries joins the
existing request rather than starting a second one — Prompt 3's storage enforces
that with a unique key per `(account, kind, idempotency key)`.

## Correlation

`requestId` is a fresh UUID per request, in both the body and `X-Request-Id`.
Derived from nothing about the caller, so it identifies a request without
identifying a person, device, or church — safe to paste into a support ticket.

## Cache semantics

| Policy | Header | Used by |
|---|---|---|
| `private-no-store` | `no-store` | mutations, export, sign-out |
| `private-revalidate` | `private, no-cache, must-revalidate` | bootstrap, relationships |
| `public-short` | `public, max-age=60, stale-while-revalidate=300` | health |

Every response sends `Vary: Authorization`, so a shared cache cannot serve one
account's response to another even if a policy is later loosened by mistake.
**Errors are always `no-store` and never carry an ETag**, even on a cacheable
route.

Client-side, a cache entry's identity is `environment | account | church |
authorizationVersion`. `authorizationVersion` increments on block, leave, link
revocation, consent withdrawal, sign-out, and deletion — so revoked data is
unreadable rather than merely stale.

## Endpoint ownership

Prompt 4 owns the boundary and identity/bootstrap only:

| Endpoint | Method | Cache |
|---|---|---|
| `/api/mobile/v1/health` | GET | public-short, anonymous |
| `/api/mobile/v1/account/bootstrap` | GET | private-revalidate, ETag |
| `/api/mobile/v1/account/relationships` | GET | private-revalidate, ETag, cursor |
| `/api/mobile/v1/account/profile` | PATCH | private-no-store |
| `/api/mobile/v1/account/consent` | POST | private-no-store |
| `/api/mobile/v1/account/selected-church` | PUT | private-no-store |
| `/api/mobile/v1/account/sign-out` | POST | private-no-store |
| `/api/mobile/v1/account/requests` | POST | private-no-store, **idempotency required** |
| `/api/mobile/v1/account/export` | GET | private-no-store |

Prompts 5–11 own discovery, announcements, watch, sermons, and giving. **No
endpoint for those exists yet**, deliberately.

## What is absent, by construction

Staff roles, feature grants, People identifiers, integration tokens, Stripe
state, stream credentials, internal row ids, email, phone, and coordinates
**do not appear in any schema**. That is enforced by tests that walk JSON keys
across every fixture in all three languages, and by a test that greps the
generated JSON Schema. Absence at the schema level, not concealment by UI.

`selectedChurchSlug` is a **preference**. Setting it proves a non-blocked
relationship exists; it authorizes nothing, and every read re-derives access.

## How later prompts extend this safely

1. **Add a Zod schema** to `lib/mobile/v1/contract.ts` and register it in
   `CONTRACT_SCHEMAS` with `.meta({ id })`. Order fixes generated declaration
   order, which keeps regeneration byte-stable and diffable.
2. **Run `pnpm contract:generate`** and commit the JSON Schema, Swift, and
   Kotlin output together. CI's `pnpm contract:check` fails on stale output.
3. **Add golden fixtures** under `contracts/faithful/v1/fixtures/`. All three
   test suites discover them automatically and read the same bytes.
4. **Add the capability key** to `ENABLED_CAPABILITIES`
   (`lib/mobile/v1/account-service.ts`) and to the native `Destination`. A
   destination is only reachable when the server reports its capability *and* a
   screen is registered — so a half-built feature cannot appear.
5. **Add the route** under `app/api/mobile/v1/`, using `authenticatedRoute` or
   `publicRoute`. Never re-implement correlation, version gating, auth, or
   redaction in a route body.
6. **Never rename or retype** an existing field. If you must, that is v2.
