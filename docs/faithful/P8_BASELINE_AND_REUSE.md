# Prompt 8 — Baseline and Reuse Inventory

*What the repository actually contains for QR, kiosk, mobile, attendance, People,
authorization, rate limiting and the generated contract — established by reading
the code, not by trusting an earlier summary.*

Every claim below cites a file and a line range. Where an earlier note in this
repository disagrees with the source, the source wins and the disagreement is
recorded.

---

## 1. Baseline gates, before any Prompt 8 change

| Gate | Command | Result |
| --- | --- | --- |
| Web tests | `pnpm test` | 484 passed, 0 failed, 0 skipped |
| iOS tests | `pnpm ios:test` | 217 tests, 16 suites, passed |
| Android tests | `gradlew test :app:testDebugUnitTest` | BUILD SUCCESSFUL (212 tests) |
| Generated contract | `pnpm contract:check` | current across 3 artifacts |
| Whitespace | `git diff --check` | clean |

89 files were already modified or untracked from Prompts 3–7. Prompt 8 adds to
that working tree; it does not begin from a clean one.

---

## 2. What exists for QR

### `lib/attendance/v2/qr.ts` (127 lines)

A signed capability, not a stored one.

```
issueQrCapability({occurrenceId, churchId, ttlSeconds?, nowSeconds?}) -> string | null
verifyQrCapability(token, {churchId, nowSeconds?})                    -> QrVerification
consumeQrNonce({churchId, occurrenceId, nonce, accountId}, client?)   -> Promise<boolean>
```

The token is `base64url(JSON).base64url(HMAC-SHA256)`; the body is
`{version: 1, occurrenceId, churchId, nonce, exp}`. The key comes from
`ATTENDANCE_QR_SECRET`, which `secret()` refuses when absent, shorter than 32
characters, or prefixed `replace-me` — so minting returns `null` rather than
signing with something guessable.

**Reusable, unchanged:**

- The signed-capability shape. No People data, no secret, no location in the
  body — verified by `tests/unit/attendance-sources.test.ts:41`.
- Constant-time signature comparison via `timingSafeEqual` with a length guard
  first (`qr.ts:93-99`).
- Verify order: signature, then version, then expiry, then church. A tampered
  body fails before any of its contents are trusted.
- Refusing a weak or placeholder secret.

**Not reusable as-is — five gaps against Prompt 8:**

1. **No key version.** One key, no `kid`, no rotation grace. Rotating
   `ATTENDANCE_QR_SECRET` invalidates every outstanding token instantly.
2. **No issuer, audience, or type.** The body names an occurrence and a church
   and nothing else. If any other feature ever signs with this key, a token
   minted for one purpose verifies for another.
3. **`DEFAULT_TTL_SECONDS = 900`.** Fifteen minutes is not a rotating code; a
   screenshot stays live for a quarter of an hour.
4. **No session.** `getServiceQrCode` mints on demand with no record that a
   check-in display was ever started, no way to stop one, and no bound on how
   long minting stays available.
5. **`consumeQrNonce` marks the nonce globally consumed.** See §6 below.

### `supabase/migrations/0055_attendance_authority.sql:445-456`

```sql
create table if not exists public.attendance_qr_redemptions (
  id, church_id, service_occurrence_id, nonce text not null,
  account_id, redeemed_at
);
create unique index attendance_qr_redemptions_nonce_idx
  on public.attendance_qr_redemptions (service_occurrence_id, nonce);
```

RLS enabled, all grants revoked from `anon` and `authenticated`
(`0055:1122-1147`). Server-only, correctly.

### `app/dashboard/attendance/services/actions.ts:221-233`

`getServiceQrCode(occurrenceId)` exists and returns a token. **Nothing calls
it.** `grep -rn getServiceQrCode` finds one hit: its own definition.
`components/attendance/service-occurrences-board.tsx` mentions `qr` only as a
display label for a source (`:38`). There is no pastor QR display in this
repository today — Prompt 8 builds it from nothing.

### `app/api/dashboard/giving/qr/route.ts`

The reusable rendering pattern: `qrcode@^1.5.4` is already a dependency
(`package.json:90`, types at `:106`), and `QRCode.toBuffer(url, {type:"png"})`
is served with `Cache-Control: private`. No new dependency is needed to render a
QR code server-side.

---

## 3. What exists for kiosk

### `lib/attendance/v2/kiosk.ts` (120 lines)

```
generateKioskCredential()  -> 32 random bytes, base64url
hashKioskCredential(c)     -> sha256 hex
kioskHashesMatch(a, b)     -> timingSafeEqual with length guard
resolveKiosk(credential)   -> KioskContext | null
issueKioskCredential(...)  -> {id, credential} | null   (raw returned once)
revokeKioskCredential(...)
```

**Reusable:** the hash-only storage, the "raw value returned once and never
stored" discipline, the `last_used_at` touch that makes stale-credential cleanup
possible, and the exact-tenant predicate on revoke — a credential id from another
church matches nothing rather than being revoked by a guess (`kiosk.ts:115-117`,
asserted by `tests/security/attendance-authorization.test.ts:291`).

**Gaps against Prompt 8:**

1. **Church/campus-scoped, never occurrence-scoped.** `attendance_kiosk_credentials`
   (`0055:458-479`) has `church_id` and `campus_id` and no occurrence. Prompt 8
   requires a credential that cannot reach another occurrence.
2. **No pairing flow.** `issueKioskCredential` returns a 43-character base64url
   string. Nobody types that into a tablet.
3. **No auto-lock, no session lifetime, no bounded People search.** There is no
   kiosk surface at all — no route, no page, no search.
4. **`hashKioskCredential` is a bare SHA-256.** Adequate for a 256-bit random
   credential; inadequate for anything a human types. A pairing code needs a
   keyed hash, because a six-character code is brute-forceable offline from a
   leaked table.

### `lib/attendance/v2/jobs.ts`

Contains `KioskCleanupResult` (referenced at
`tests/security/attendance-authorization.test.ts:370`) — the stale-credential
sweep already exists and is reusable.

---

## 4. The attendance authority — reuse without exception

`supabase/migrations/0055_attendance_authority.sql:503` defines
`record_attendance(...)` returning `(outcome, reason, fact_id, attempt_id,
occurrence_id)`. Idempotency is checked **before** validation (`:551-560`), so a
retry returns what it returned the first time rather than being re-judged against
a window that may since have closed. Concurrency is closed by a unique index and
`on conflict do nothing`, not by a read-then-write.

`0056_attendance_batch.sql:28` adds `record_attendance_batch`, which loops over
`record_attendance` **inside the database** — one transaction, one round trip, no
second insert path. `lib/attendance/v2/roster.ts:97-150` is the caller;
`MAX_BULK_MEMBERS = 1000` is enforced in TypeScript and again in SQL.

**Prompt 8 §7's manual admin fallback is already built.** `markPresentBulk` and
`markPresent` both terminate in `record_attendance`. Prompt 8 adds no new insert
path; it adds the kiosk and QR callers of the same command.

`0057` fixed `attendance_report` to sum people rather than count source rows.
`0058` added `attendance_detections` with `open_attendance_detection` and
`redeem_attendance_detection` — server-clock dwell. Neither may be edited.

---

## 5. Identity, authorization, and rate limiting

### The People gate — `lib/attendance/v2/check-in.ts:106-138`

`resolveSelfCheckInMember(accountId, churchId)` reads
`visitor_church_relationships` (refusing `blocked` and `left`) and then requires
an active `visitor_people_links` row for **that** church. Its own comment states
the rule Prompt 8 restates: *"Email, phone, device id, visitor relationship and
coordinates establish nothing."*

**Reused verbatim.** QR and kiosk check-ins call this and nothing else. No
Prompt 8 path may match a person by email, phone, name, device, or QR content.

### Dashboard authorization — `lib/auth/church.ts`

`getChurchAuth()` returns `{userId, churchId, role, isAdmin, featurePermissions}`
resolved from the caller's own session. `app/dashboard/attendance/services/actions.ts:38-54`
wraps it as `requireAttendanceStaff()` (plus a feature guard) and
`requireCorrectionRights()` (admin only). Reused for starting a check-in display
and issuing a kiosk pairing code.

### Mobile authorization — `lib/mobile/v1/handler.ts`

`authenticatedRoute` / `optionalAuthRoute` / `publicRoute` own correlation,
client-version gating, bearer-token verification against the **publishable** key,
and error redaction. `toFailure` (`:191-206`) turns anything unrecognised into a
generic `internal_error` and logs only a request id.

**Reused for every new mobile route.** A Prompt 8 route body contains domain work
and nothing else.

### Rate limiting — `lib/security/rate-limit.ts`

`checkRateLimit(key, {limit, windowMs})` hashes the key with
`RATE_LIMIT_KEY_SECRET` (HMAC, never the raw key) and calls
`consume_api_rate_limit` (`0050_security_baseline.sql:312`) — **atomic in SQL**,
not a read-then-write in application code. It **fails closed**: an unavailable
admin client, an unavailable secret, or a store error all return
`{ok: false, retryAfterSeconds: 60}`.

**Reused directly for the short-code fallback.** Prompt 8's requirement that
short-code rate limits be atomic is already satisfied by this function; what
Prompt 8 adds is the set of buckets to spend against it.

`getClientIp` returns the literal string `"untrusted"` unless the deployment
declares a trusted proxy — so an IP bucket silently collapses to one global
bucket off-Vercel. **Recorded as a real limitation**, and the reason the
short-code defence leans on account and session buckets rather than on IP.

---

## 6. The conflict, stated plainly

`lib/mobile/v1/attendance-service.ts:188-213`:

```ts
const consumed = await consumeQrNonce({churchId, occurrenceId, nonce, accountId}, admin);
if (!consumed) return reject("qr_replayed", input.occurrenceId);
```

Backed by `attendance_qr_redemptions_nonce_idx`, unique on
`(service_occurrence_id, nonce)`.

**This is globally consuming.** The first visitor to scan a displayed code takes
the nonce; the second visitor to scan *the same code on the same screen* collides
on the unique index and is told `qr_replayed` — "That code has already been used"
(`results.ts:174`).

Prompt 8 requires the opposite:

> A displayed token is intentionally usable by multiple eligible visitors during
> its brief lifetime. Do not mark it globally consumed after the first scan.
> Per-person attendance uniqueness prevents duplicate counting.

**Resolution.** The uniqueness that matters is already enforced elsewhere: the
unique counted fact in `record_attendance` means one person is counted once per
occurrence regardless of how many codes they scan. A per-nonce global lock adds
nothing to that and actively breaks a congregation of more than one.

Prompt 8 therefore scopes redemption **per account** — unique
`(service_occurrence_id, nonce, account_id)` — in a new table created by
migration 0059. `attendance_qr_redemptions` and its global index are left exactly
as 0055 wrote them (additive migrations only; 0055 may not be edited) and are
documented there as superseded. `consumeQrNonce` is replaced at its single call
site rather than left as dead code.

What the per-account row still buys, honestly stated: an audit trail of which
rotating token a person presented, and a cheap signal for detecting one account
farming many tokens. It is **not** the duplicate-count defence. The unique
counted fact is.

---

## 7. The generated contract

`lib/mobile/v1/contract.ts` is the single source of truth.
`scripts/generate-contract.mjs` emits three artifacts from `CONTRACT_SCHEMAS`
(`contract.ts:710-756`) and `CONTRACT_ENUMS` (`:758-777`):

- `contracts/faithful/v1/schema.json` (JSON Schema 2020-12)
- `apps/faithful-ios/Sources/FaithfulKit/Generated/Contract.swift`
- `apps/faithful-android/core/contract/src/main/kotlin/.../Contract.kt`

`nativeType` is deliberately narrow and **throws** on an unsupported construct
rather than emitting something plausible, so a contract change that the generator
cannot express fails at generation time. `pnpm contract:check` is the CI gate.

Already present and reusable for QR:

- `attendanceSourceSchema = ["manual","admin","geofence","qr","kiosk"]` (`:413`)
- `attendanceResultSchema` (`:463`) — `outcome`, `message`, `occurrenceId`,
  `countedAt`, `confirmationNotBefore`, `detectionId`
- `attendanceAttemptRequestSchema` (`:527`) — already carries
  `qrToken: z.string().max(1024).optional()` and `source: ["geofence","qr"]`
- `attendanceCapabilitySchema` (`:447`) — already carries `qrEnabled`

Prompt 8 extends these additively. No existing field changes meaning.

`app/api/mobile/v1/attendance/attempt/route.ts` requires an `Idempotency-Key`
header (`requireIdempotencyKey`) and passes every parsed field through to
`submitAttempt`. Reused; Prompt 8 adds fields to the same call.

---

## 8. Native baselines

**iOS** — `apps/faithful-ios/Sources/FaithfulKit/` with `Attendance/`,
`Features/`, `Components/`, `Networking/`, `Generated/`, `Session/`, `Storage/`,
`Theme/`, `Navigation/`. Prompt 7's `CoreLocationAdapter.swift` established the
pattern Prompt 8 follows for the camera: a protocol seam with all decisions in
pure, testable Swift, and the platform framework behind `#if os(iOS)`.

**Android** — modules in `settings.gradle.kts`: pure-JVM `:core:contract`,
`:core:network`, `:core:navigation`, `:core:storage`, `:core:attendance`, plus
Android `:core:design` and `:app`. The version catalog
(`gradle/libs.versions.toml`) is the single place a version may be declared;
`RepositoriesMode.FAIL_ON_PROJECT_REPOS` means a module may not add a repository.

`:core:attendance` being pure JVM is what makes Prompt 8's scanner testable: the
QR **decode** can live there and be exercised against a real generated QR image
on the JVM, leaving only camera frame delivery on the untested side of the line.

**Environment facts that gate the Android build:** `JAVA_HOME` must point at
`openjdk@17` — the machine default is Java 8 and AGP refuses it.

---

## 9. Environment registry gap

`lib/env/production.ts:106-124` enumerates the secrets production must have and
asserts they are distinct from one another. The list is:

```
DONOR_PORTAL_SESSION_SECRET, INTEGRATION_OAUTH_STATE_SECRET, N8N_WEBHOOK_SECRET,
RATE_LIMIT_KEY_SECRET, STREAM_RELAY_WEBHOOK_SECRET, STREAM_RELAY_PLAYBACK_SECRET,
STREAM_INGEST_SIGNING_SECRET, STREAM_PLAYBACK_SECRET, CRON_SECRET
```

`ATTENDANCE_QR_SECRET` **is not in it.** The only non-test reference in the
repository is `qr.ts:35`. So today a production deployment passes its own
environment audit with QR signing entirely unconfigured, and QR check-in silently
refuses. Prompt 8 registers it.

---

## 10. Summary — what is reused, changed, and added

**Reused unchanged:** `record_attendance`, `record_attendance_batch`,
`correct_attendance`, `resolveSelfCheckInMember`, `hasAutomaticAttendanceConsent`,
`checkRateLimit` / `consume_api_rate_limit`, the mobile route handler, the error
redaction, `getChurchAuth` and the staff guards, `markPresentBulk`, the contract
generator, the `qrcode` renderer, and the hash-only kiosk credential discipline.

**Changed:** the QR capability format (versioned keys, typed sub-keys, issuer and
audience, seconds-scale rotation), and the single `consumeQrNonce` call site.

**Added:** check-in sessions, rotating short codes, display pairing and a scoped
display capability, occurrence-scoped kiosk sessions with a bounded People
search, native scanners on both platforms, and migration 0059.

**Untouched by rule:** migrations 0055, 0056, 0057, 0058.
