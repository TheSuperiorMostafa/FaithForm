# Prompt 8 — Security and Privacy Model

*What each capability can do, what it cannot, what is logged, what is stored, and
where the honest limits are.*

---

## 1. Every capability in the system

| Capability | Lifetime | Scope | Revocable by | Stored |
| --- | --- | --- | --- | --- |
| Rotating QR token | one window + one grace window (30–240 s) | one check-in session | stopping the display | not stored — signed |
| Short code | same window and grace | same session | stopping the display | keyed hash only |
| Display pairing code | 5 minutes, single use | one session | expiry, or use | keyed hash only |
| Display capability | until the session's hard bound | read one occurrence's frame | stopping the display | not stored — signed |
| Kiosk pairing code | 5 minutes, single use | one kiosk session | expiry, or use | keyed hash only |
| Kiosk credential | until check-in close + 1 h, idle-locked at 5 min | search + check into one occurrence | revoking the kiosk | keyed hash only |

Nothing here is permanent, nothing here is a login, and nothing here carries a
role.

---

## 2. What a QR payload contains

```json
{"v":2,"t":"checkin.qr","s":"<session>","o":"<occurrence>","w":<window>,"n":"<nonce>","e":<expiry>}
```

**Absent, and asserted absent:** People data, member id, email, phone, name,
precise user location, admin token, integration secret, persistent stream key,
and any signing material. The church id is absent too — it comes from the session
row, which is what lets a stopped display take effect immediately.

`tests/unit/attendance-sources.test.ts` decodes a real minted token and asserts
the body contains none of `member`, `email`, `phone`, `name`, `account`, `lat`,
`lon`, and does not contain the signing key.

---

## 3. The signing key never leaves the server

| Surface | Holds a key? | Enforced by |
| --- | --- | --- |
| iOS app | no | native sweep for `ATTENDANCE_QR_SECRET`, `mintCapability`, `keyedHash`, `subKey(` |
| Android app | no | same sweep |
| Browser (projector, kiosk, dashboard panel) | no | client-bundle sweep, plus `verifyCapability` and `createHmac` |
| Server | yes, from the environment | — |

Both sweeps have injected-violation proofs: a signing key added to
`CheckInScanner.swift` must make the sweep fail, and the file is restored
byte-for-byte afterwards.

A client cannot even *read* a token it holds. The native payload filter checks a
four-character prefix and a dot count, and the sweep asserts no base64 or JSON
decoder appears in either scanner — so the occurrence, expiry and church inside a
token are opaque to the device carrying it. That is what makes "the server
decides" true rather than aspirational.

The dashboard, too, never names the variable to a person. An earlier draft told a
pastor to set `ATTENDANCE_QR_SECRET`; the privacy sweep caught it. A pastor is not
the person who edits an environment variable, and the message was both unhelpful
and one more place a deployment detail travelled to a browser. It now says
check-in codes are not set up, and the variable is named in the operations
runbook where the person who can act on it will look.

---

## 4. What is never logged

> Raw QR payloads. Short codes. Pairing codes. Kiosk credentials. People
> identifiers combined with public display data. Camera frames. Authentication
> tokens. Precise location.

Enforced three ways:

1. **`lib/attendance/v2/signing.ts` writes to the console at all** — asserted. It
   is the one file that handles every key.
2. **Every `console.*` call across the twelve server check-in files** is parsed,
   and its arguments must not mention `token`, `code`, `credential`, `pairing`,
   `hash`, `nonce` or `secret`.
3. **No native scanner file uses a logging call at all** — `print(`, `NSLog`,
   `Log.d/i/e/w`, `println(`. The frame path in particular is silent: a log line
   per frame at thirty frames a second is a battery drain and a way for a payload
   to reach a log by accident.

The rate limiter is given `attendance:code:typed:<accountId>` — never the code
itself, because the limiter hashes and stores what it is handed.

Database-side, `redeem_attendance_short_code` and `resolve_attendance_kiosk_session`
raise nothing and log nothing; a refusal is a returned verdict, not an exception
carrying a value.

---

## 5. Identity

> Visitor identity requires an explicit verified `visitor_people_link`; never
> match by email, phone, name, device, or QR content.

Every check-in path resolves the person through
`resolveSelfCheckInMember(accountId, churchId)`, which requires:

- a `visitor_church_relationships` row that is not `blocked` or `left`; **and**
- an active `visitor_people_links` row for that church.

A code that scans perfectly, from a display that is running, submitted by an
authenticated account with no verified link, is refused with `no_people_link`.
The code says *which service*. The session says *who*.

The authority sweep asserts `submitAttempt` contains no `byEmail`, `byPhone`,
`matchByName`, or `deviceId` path.

---

## 6. One counted authority

> QR, kiosk, manual, bulk, and geofence sources must never create separate
> counted authorities.

```
manual ─┐
admin  ─┤
geofence┼──▶  record_attendance  ──▶  one audited attempt
qr     ─┤    (+ record_attendance_batch, which loops over it in-database)
kiosk  ─┘                         ──▶  one unique counted fact
```

Asserted structurally:

- no check-in file **writes** `attendance_facts` or `attendance_attempts`
  directly. The sweep distinguishes a write from a read, because the kiosk
  legitimately reads facts to show "already checked in" — and an earlier version
  that forbade the table name outright made that a false positive;
- migration 0059 creates no insert or update against either table;
- the kiosk path is `recordAttendance({ source: "kiosk", actorType: "kiosk" })`
  and nothing else;
- migrations 0055–0058 mention none of the Prompt 8 tables, asserted by name.

A database test drives the case that matters: a QR check-in **and** a kiosk
check-in for the same person produce one fact and one `already_counted`.

---

## 7. Rate limits

| Path | Budget | Bucket |
| --- | --- | --- |
| Typed short code | 10 / 5 min | per account |
| Scanned QR | 40 / 5 min | per account |
| Display pairing | 12 / 5 min per client, 400 / 5 min globally | per IP + global |
| Kiosk pairing | same | per IP + global |
| Kiosk search | 120 / min | per kiosk session |
| Kiosk check-in | 240 / min | per kiosk session |

All of them go through `consume_api_rate_limit`, which settles the count inside
**one SQL statement** rather than reading and then writing, and which **fails
closed** — an unavailable limiter refuses rather than waving the attempt through.

### An honest limitation

`getClientIp` returns the literal string `"untrusted"` unless the deployment
declares a trusted proxy (`VERCEL=1` or `TRUST_PROXY_HEADERS=true`). Off a
trusted proxy, **every caller shares one per-client bucket.** That is a real
property of the existing limiter, inherited rather than introduced, and it is
why:

- the pairing endpoints also carry a global backstop bucket, set well above any
  plausible church's use and far below what searching a 31-bit space would need;
- the code-submission budgets are keyed on the **account**, which is
  authenticated and cannot be spoofed by a header.

---

## 8. What a rotating code does and does not prove

**Does:** makes a shared screenshot stale within a rotation period, so sharing
usefully requires relaying a fresh code every thirty seconds, live.

**Does not:**

- prove physical presence;
- resist a relay — a video call pointed at the screen defeats it entirely;
- make a screenshot useless, only short-lived.

No screen and no document in Faithful claims otherwise. The dashboard panel says
so in as many words to the pastor starting the display:

> Rotation makes a shared screenshot go stale quickly — it does not prove anyone
> was in the room.

There is **no permanent printed code**, and none may be added. A static code is
remote attendance with extra steps.

---

## 9. Data retention

| Table | Kept | Removed by |
| --- | --- | --- |
| `attendance_checkin_codes` | 1 hour past the window | purge — deleted outright |
| `attendance_display_pairings` | 1 hour past expiry | purge — deleted outright |
| `attendance_checkin_sessions` | indefinitely, as history | ended by purge, never deleted |
| `attendance_kiosk_sessions` | indefinitely, as history | ended by purge; credential nulled |
| `attendance_qr_scan_redemptions` | 90 days | purge |

Codes and pairings are capabilities, not history — a table of expired
capabilities is a liability with no reader. Sessions and scan redemptions are
retained because "was a display running" and "which code did this person use" are
questions a church legitimately asks weeks later.

`purge_attendance_checkin_artifacts(now, retentionDays)` is service-role only and
is exercised by a database test.

---

## 10. Row-level security

All five new tables:

```sql
alter table … enable row level security;
revoke all on … from public, anon, authenticated;
```

No policies, deliberately — these hold capabilities and their hashes, nothing
client-side reads or writes one, and a browser reaching Supabase directly with an
authenticated JWT sees no rows because there is nothing to match.

All eight new functions are `security definer` with `set search_path = public`,
revoked from `public`, `anon` and `authenticated`, and granted to `service_role`
only. `pnpm test:migrations` asserts the pinned `search_path` for every
`SECURITY DEFINER` function added after the baseline.

---

## 11. Cookies

```
ff_checkin_display   HttpOnly  SameSite=Strict  Secure(prod)  Path=/api/checkin
ff_checkin_kiosk     HttpOnly  SameSite=Strict  Secure(prod)  Path=/api/checkin
```

The path is the blast radius: a projector's capability is never sent to
`/dashboard`, a kiosk's is never sent to `/api/mobile`, and neither reaches
anything that could act on a church's behalf. `HttpOnly` means a script on the
page cannot read one out; `SameSite=Strict` means another site cannot cause the
browser to spend one.

No check-in route accepts a dashboard session as an alternative — asserted by
sweeping every route for `getChurchAuth`, `requireChurchAdmin`, `createClient(`
and `supabase.auth`. Opening the projector page while signed in gives you exactly
the same narrow surface.

Both public pages set `robots: { index: false, follow: false }` and
`referrer: "no-referrer"`, and neither does any server work: they render a client
component and read nothing, so no capability is ever embedded in HTML that sits on
a screen at the front of a room.

---

## 12. Scope exclusions, honoured

Not implemented, and asserted absent where a sweep can express it:

| Excluded | How |
| --- | --- |
| Livestreams, recordings | `AVPlayer`, `ExoPlayer` swept |
| Sermon archive, presentations | untouched |
| Donations, mobile payments | `StoreKit`, `SKPayment`, `BillingClient`, `PaymentSheet` swept |
| New discovery/onboarding behaviour | untouched |
| Face recognition, biometric identification | `VNDetectFaceRectangles`, `FaceDetector`, `LAContext`, `BiometricPrompt` swept |
| NFC attendance | `NFCNDEFReaderSession`, `NfcAdapter` swept |
| Permanent printed QR codes | rotation bounded at 120 s; no static mint path |
| Unattended People-directory browsing | 3-character minimum, prefix match, 8 results, no paging |
| Analytics, advertising, tracking identifiers | `AD_ID` swept; no analytics dependency added |
| Unrelated refactors | see §13 |

Prompt 7's scope guard listed `AVCaptureSession` and `CameraX` as out of scope,
because scanning was Prompt 8's work. That boundary moved, and the list moved with
it — **replaced by something stricter**, not removed: the camera can now be
reached from exactly two adapters, no capture-to-disk API exists anywhere, and no
early surface holds a scanner.

---

## 13. The two things changed outside Prompt 8's own surface

Both are recorded rather than folded in silently.

**`lib/attendance/v2/qr.ts` was deleted.** It was Prompt 6's entire QR authority
and Prompt 8 replaces it: a fifteen-minute capability, one unversioned key, no
issuer or audience, and a nonce consumed globally on first scan. Every property
its tests asserted has a new home in `tests/unit/attendance-sources.test.ts`,
asserted of the code that now implements them — round-trip binding, no secret in
the body, wrong-target refusal, expiry, tampering, malformed input, and a weak
key refusing to sign — plus three it never had: key versions, domain separation,
and a rotation grace.

**A flaky assertion in `tests/unit/faithful-provider-auth.test.ts` was fixed.**
It asserted a raw P-256 signature's first byte is not `0x30`, reasoning that DER
starts with a SEQUENCE tag. But that byte is the top byte of `r` and is uniformly
random, so the test failed about once in every 390 runs on a perfectly correct
signature — measured at 0.26% over 5,000 freshly generated keys. It surfaced
during a Prompt 8 verification run. The length check (exactly 64 bytes) already
excludes DER entirely, and the replacement checks the DER *shape* rather than one
byte, so it cannot fire by coincidence.
