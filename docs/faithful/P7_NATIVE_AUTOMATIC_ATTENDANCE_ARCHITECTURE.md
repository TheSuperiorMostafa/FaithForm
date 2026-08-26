# Prompt 7 — Native automatic attendance

Automatic attendance on iOS and Android, on top of the Prompt 6 authority.

## The one sentence that governs everything

**An operating-system geofence event is evidence, not attendance.**

A device crossing a circle drawn round a building is a reason to *ask* the
server whether that counts. It is never the answer. No code on either platform
marks anyone present, and no state reads as success except a server verdict of
`counted` or `already_counted`.

## What was built

| | iOS | Android |
|---|---|---|
| Region monitoring | Core Location `CLCircularRegion` | Play services `GeofencingClient` |
| Lifecycle owner | `GeofenceReconciler` (actor) | `GeofenceReconciler` (mutex) |
| Evidence machine | `EvidencePhase` + `AutomaticAttendanceCoordinator` | identical case set |
| Permission model | `LocationAuthorization` + accuracy | foreground / background / strategy |
| Framework adapter | `CoreLocationAdapter` | `PlayServicesGeofencing` |
| Pending queue | Keychain | `EncryptedSharedPreferences` |
| Screens | SwiftUI | Compose |
| Testable without a device | `swift test` | `gradle :core:attendance:test` |

The decision logic on both platforms lives in code with **no framework
dependency** — `FaithfulKit/Attendance/*` and the pure-JVM `:core:attendance`
module. The adapters translate and decide nothing. That is what makes every
permission branch, every capacity case and every refusal reachable in a test
with no simulator, no emulator and no movement.

## Where the platforms genuinely differ

Forcing these into one shape would produce a worse app on both.

| | iOS | Android |
|---|---|---|
| Permission model | One escalating grant: When In Use → Always | Two separate runtime permissions |
| Precision | `fullAccuracy` / `reducedAccuracy`, a separate axis | `ACCESS_FINE` vs `ACCESS_COARSE`, the permission itself |
| Background grant | A second prompt | API 29: a dialog. **API 30+: Settings only** |
| Region limit | **20**, hard | **100** per app per user |
| Survives reboot | Regions persist | **Cleared** — must re-register on `BOOT_COMPLETED` |
| Mock-location signal | None exists | `Location.isMock` |
| Delivery | App relaunched into the background | Broadcast to a receiver |

Both are capped at **20** regions regardless, so a church with 25 campuses gets
the identical set on either phone. A support conversation should not have to
begin by asking which platform.

## The geofence lifecycle

One owner per platform. Everything that could change the desired set calls
`reconcile(trigger:)`, and that is the only thing that talks to the framework.
Registration spread across a view, an app delegate, a receiver and a worker
cannot be reasoned about: they race on launch, and what the system holds drifts
from anything intended.

### Triggers

`optIn`, `foreground`, `churchChanged`, `accountChanged`,
`authorizationVersionChanged`, `permissionChanged`, `configurationRefreshed`,
`windowBoundary`, `regionEvent`, and — Android only — `bootOrUpdate`.

### Rules

1. **Partitioned** by `environment | account | church | authorizationVersion`.
   Any change is a different identity, and everything under the previous one is
   removed *before* anything new is registered.
2. **Idempotent.** Desired is compared against actual and only the difference is
   issued. Ten calls cost nine no-ops — which matters, because foregrounding
   after a church switch really does fire two.
3. **A moved campus is re-registered; an identical one is left alone.**
   Re-registering an unchanged region resets the system's state for it.
4. **Bounded** at 20, by a deterministic selection: sorted by region id, which
   is the campus uuid. Deliberately *not* by distance — a proximity rule makes
   the set depend on where the person is standing, so two devices monitor
   different regions and neither is reproducible from a bug report.
5. **Invalid geometry is dropped, not clamped.** A region the OS would reject or
   silently resize is worse than one region fewer.
6. **Fails closed.** Every refusal, every authorization loss and every teardown
   reason ends in `stopMonitoringAll()`.

### Immediate teardown

Logout, leaving a church, being blocked, People-link revocation, consent
withdrawal, and disabling the feature. All six are the same thing from the
device's point of view: this app is no longer authorized to watch.

### Offline is not teardown

One failed configuration request leaves a working setup alone. Tearing down a
feature that was working because the train went into a tunnel would be wrong.

## Expired configuration

A region event may arrive against a configuration that has since expired or been
revoked. **Waking is allowed. Acting on it is not.**

`regionEvent` and `bootOrUpdate` force a refresh rather than reading the cache,
so authorization is re-derived before any evidence is submitted. If the refresh
refuses, the flow ends and the regions are removed.

## The evidence state machine

Identical case set on both platforms.

```
idle
 → entered(regionId, at)              OS callback
 → reauthorizing(regionId)            refresh config; re-check authority
 → refused(reason)                    terminal, fails closed
 → awaitingDwell(occurrenceId, since) server returned pending_confirmation
 → confirming(occurrenceId)           dwell satisfied, confirm in flight
 → counted(occurrenceId, already)     the only success
 → retrying(occurrence, attempt, at)  transient only
 → abandoned                          exited before dwell
```

`isSuccess` is true for `counted` alone. `entered`, `reauthorizing`,
`awaitingDwell` and `confirming` are all explicitly not success — asserted on
both platforms, because an encouraging intermediate state on screen is how a
person ends up believing they were counted when they were not.

### The canonical request

Byte-identical on both platforms:

```
POST /api/mobile/v1/attendance/attempt
Idempotency-Key: gf-<sha256(...)[0:40]>
{ occurrenceId, source: "geofence", phase, observedAt,
  accuracyMeters?, dwellSeconds?, latitude?, longitude?, mockLocationReported? }
```

The client names an occurrence and reports an observation. It cannot send a
member, a church, a distance, a band, or a result — asserted against the schema
field keys, not a substring sweep.

**The occurrence is resolved by the server**, from its own clock, via
`/attendance/{slug}/occurrence`. The client never picks one from a cached
window: a cached window may be stale, and choosing locally would be the client
deciding what it is attending.

## The logical attempt, and the bug it exists to fix

### What was wrong

The first version derived the key from `(account, occurrence, phase)` alone.
Deterministic, nothing to persist — and **broken for exactly the people most
likely to need it.**

`record_attendance` checks idempotency *before* validation and replays the
earlier result. So:

1. A visitor arrives with a cold GPS fix. The server bands it outside and
   refuses `outside_region`, cached under that key.
2. They walk inside. The fix sharpens. The OS delivers another entry.
3. The client sends the **same key**, and the server replays the refusal.
4. Forever.

They could sit through the whole service and never be counted, with nothing on
the device or the dashboard to explain it. The same trap applied to
`insufficient_accuracy`, an expired configuration, and a consent revocation that
was later restored.

The server is not at fault — idempotency means "same key, same answer". The
client was reusing a key across genuinely different attempts.

### The identity

A **logical attempt** is one workflow, not one occurrence:

```
LogicalAttempt {
  attemptId      128 random bits, hex, from SecureRandom / arc4random
  churchSlug
  occurrenceId
  openedAt
  expiresAt      bounded by the same retention rule as its evidence
  queued?        the one submission that could not be sent
}
```

**Opened before anything is submitted**, atomically, in the encrypted store.
`openIfAbsent` returns the *existing* attempt on a collision, which is what
makes two simultaneous callbacks join one workflow instead of starting two.

**Closed** on counted, already-counted, terminal refusal, abandonment, or
expiry. Closing is the whole correction: the next genuine entry opens a new
attempt with a new id and is validated fresh.

### The key

```
gf-sha256("faithful.geofence.v2|account|church|occurrence|attemptId|kind")[0:40]
```

| Input | Why |
|---|---|
| `account` | The server scopes attempts by `(occurrence, source, key)`, which does not include the account. Two people sharing a device must not collide. |
| `church` | A defensive tenant boundary. |
| `occurrence` | Two services on one day are two answers. |
| **`attemptId`** | **The fix.** One workflow, not one occurrence. |
| `kind` | `detected` and `confirm` are two genuinely independent server commands — the contract defines both and the server answers each on its own. This is not mutable state-machine phase; sharing a key here would make `confirm` replay the earlier `pending_confirmation` forever. |

`v2` so a client mid-upgrade cannot collide with a key it wrote under the old
scheme. Byte-identical construction on both platforms, pinned by test.

### What the same key is reused across

Duplicate callbacks, network retries, app suspension, and process restart — all
of them within one logical attempt. The key is **re-derived** from the stored
`attemptId` rather than stored alongside the payload, so the two cannot drift
apart.

### Anti-flapping — bounded, and never a lockout

A first version capped refusals at **five per occurrence** and then refused
permanently. **That was the original bug wearing a larger number.** Five poor
readings on arrival — indoors, phone cold, walking past a wall — would stop that
person being counted at that service at all, which is precisely what the logical
attempt was introduced to remove.

`AttemptPolicy` replaces the cap. Identical on both platforms, constant for
constant, so an iPhone and a Pixel back off the same way.

| Mechanism | |
|---|---|
| **Exponential cooldown** | 30 s doubling, capped at **10 minutes** — well below a service, so a hold can never outlast the window |
| **Token bucket** | Capacity 12, refilling **continuously** at one per minute |
| **`nextEligibleAt`** | A hold names when it lifts. There is no `ineligible` state |
| **Meaningful triggers** | Bypass the cooldown entirely |
| **`maxLocalHold`** | **10 minutes**, stated as a constant and asserted exhaustively |

A previous version used a 12-per-**rolling-hour** budget. That was the lockout
again in a third disguise: spend the twelve in the first two minutes and the
next attempt is up to an hour away — longer than the service. A bucket refills
continuously, so an empty one is at most **one minute** from a token, and the
cooldown ceiling is therefore always the binding constraint.

The triggers that bypass a hold, because each is genuinely new information:

- **A verified exit then re-entry.** The person actually left and came back.
- **A materially improved fix** — halved, or 25 m better. A cold GPS sharpening
  as someone walks inside is exactly the case a cap used to lock out. Noise
  (±98 m after ±100 m) is not news.
- **A configuration change.** A policy edit, a moved campus, a restored consent:
  whatever refused before may not refuse now.

**Only a count settles an occurrence.** Twenty refusals in a row leave it open;
`counted` and `already_counted` close it. Blocked, revoked, unlinked and
consent-denied remain terminal for *this attempt* and tear the regions down —
but they too become eligible again if the underlying authorization changes,
because that changes `configVersion`.

Server rate limiting and the unique counted fact remain authoritative. None of
this is a correctness guard; it protects the battery and the API.

### Bounds

- **After counted or already-counted**, further attempts for that occurrence are
  suppressed locally. The database's unique fact remains the final invariant;
  this only stops asking again for an answer already held.
- **Attempt ids are not tracking identifiers.** Scoped to one occurrence, at
  most two hours old, never transmitted except folded into a key, deleted on
  close. Nothing correlates two of them.

## `detected` → `confirm` — server-authoritative dwell

### The hole this closes

**Dwell was never enforced.** `record_attendance` compared `p_dwell_seconds` —
a number the *client supplies* — against the occurrence's `minDwellSeconds`. A
device sending `dwellSeconds: 9999` counted immediately, and the whole two-phase
mechanism was decorative against anything but an honest client.

The first `confirmationNotBefore` made one part worse: it was computed from the
client's own `observedAt`, so backdating that value by an hour produced a
deadline already in the past.

### The detection record

Migration `0058` adds `attendance_detections`. When `detected` is accepted the
server creates one, stamped with `now()` from **this database** and nothing
else:

```
detected_at_server      = now()
confirmation_not_before = detected_at_server + minDwellSeconds
```

`minDwellSeconds` comes from the occurrence's **snapshot**, so a church editing
its policy does not move a dwell already running.

`confirm` presents the detection id. The server re-reads the row and computes

```
server_dwell_seconds = now() - detected_at_server
```

**Two server timestamps. No client-controlled value is in the arithmetic**, so a
device clock days behind or ahead changes nothing.

### What `observedAt` is now for

Diagnostics, bounded by a plausibility check (±1 year, else dropped). It is
stored with the recorded clock skew so support can see why a device's numbers
looked strange, and it **decides nothing**.

### Bindings, all re-checked at confirmation

| Bound to | Refusal if it moved |
|---|---|
| Authenticated account | `detection_wrong_account` |
| Verified People link / member | `detection_wrong_member` |
| Church + service occurrence | `detection_wrong_occurrence` |
| Region / campus | `detection_wrong_region` |
| Configuration version | `detection_stale_configuration` |
| Logical attempt | — it *is* the idempotency key of the detection |
| Policy snapshot | stored on the row; the dwell is judged against it |

Plus `detection_not_found` (fabricated), `detection_expired`,
`detection_already_used` (spent), `dwell_not_elapsed` (too soon), and
`confirmation_without_detection` (no detection at all).

Every one of those reads the same to the person — "We couldn't confirm you're at
the service" — except `dwell_not_elapsed`, which says *stay a moment longer*,
because that one is actually actionable. The distinctions live in the attempt
audit, not on screen.

### Idempotency of `detected`

`unique (service_occurrence_id, account_id, logical_attempt_id)` with
`on conflict do nothing` and a re-read. A repeated `detected` returns **the same
record and the same timestamps** — restarting the clock on a retry would let a
client reset its own dwell indefinitely by resending.

Two connections opening the same detection produce one record; asserted.

### What invokes `confirm`

| Platform | |
|---|---|
| **Android** | The OS dwell transition, with `setLoiteringDelay` from authoritative configuration |
| **iOS** | Any legitimate execution opportunity: another region callback, a foreground, a granted background refresh |

**Neither proves the server dwell elapsed.** Android's dwell callback *schedules
an opportunity*; iOS uses `confirmationNotBefore` only to decide when it is
worth trying. The server enforces the rule again either way, so an early
callback is refused `dwell_not_elapsed` and simply tries again.

### Suspension, termination, never confirming

`confirmationNotBefore` **and the detection id** are persisted with the attempt,
in the Keychain / `EncryptedSharedPreferences`, because the wait spans exactly
the window where the process is most likely to be killed. A relaunched process
reads both back.

A client with a deadline but **no detection never confirms** — guessing an id
would be worse than not trying. Asserted on both platforms.

**When confirmation never happens**, the attempt expires at two hours, is purged
unsent, and nobody is counted.

### `detected` alone creates nothing

No fact, and no attempt row either. It records that a device said it arrived.
Asserted against real Postgres.

## Retries## Retries

Bounded exponential backoff with full jitter, capped at 120 s, floored above
zero, five attempts. **Jitter matters more than usual**: a whole congregation's
phones cross the same boundary within two minutes, and undithered backoff would
have them retry in lockstep.

Applied **only** to transport and 5xx failures. An authorization or validation
refusal is an answer, never retried — retrying a `consent_revoked` would be
pointless and a small denial-of-service against our own server.

## The offline queue

At most one attempt per partition, in the Keychain / `EncryptedSharedPreferences`
— not a preference file, not a cache, because the payload can hold a position.

**Bounded to two hours**, then purged unsent. That covers a service that runs
long plus a drive home through a dead zone; beyond it the window has closed
server-side anyway and the queue would only be holding coordinates for nothing.

## Server changes

Three, each the smallest that closes a real gap.

### 1. The server now computes the distance band

`P6_ATTENDANCE_ARCHITECTURE.md` said submitted coordinates were re-validated
against the campus position the server holds. **They were not.**
`submitAttempt` passed `distance_band: 'inside'` unconditionally, and the
occurrence's `campus_latitude` / `campus_longitude` / `geofence_radius_m` were
selected and never read — so the command's `outside_region` branch was
unreachable for a geofence attempt.

`lib/attendance/v2/distance.ts` bands it now, by haversine against the
occurrence's own snapshot. A client with no usable fix bands `unknown`, which
the command refuses. Coordinates are arguments, never state: nothing stores,
logs or returns them.

This is **not** anti-spoofing. It makes the *server* do the arithmetic against
numbers the client never supplied, so a client cannot simply assert it was
inside.

### 2. `latitude`, `longitude`, `mockLocationReported` on the attempt request

All optional, so a pre-Prompt-7 client still validates. Regenerated into
`schema.json`, `Contract.swift` and `Contract.kt`.

### 3. `POST /api/mobile/v1/attendance/consent`

`attendanceConsentRequestSchema` had been in the contract since Prompt 6 and was
already generated into all three languages, but **no route consumed it** — a
native client had no way to grant or withdraw consent. A new route over an
existing schema and the existing `recordConsent` authority. No schema shape
changed.

### Migration `0057` — the report totals were wrong

`attendance_report` counted with `count(*)` over a subquery grouped by
`(source, status)` — so it counted **sources, not people**:

```
three counted, two by phone and one by a greeter
  → groups: (geofence, active, n=2), (manual, active, n=1)
  → reported: 2
  → actual:   3
```

Invisible until now because a single source is a single group. Prompt 7
introduces the second source, and the day a congregation used both, the
dashboard would have started under-reporting its own attendance — the one number
a church actually looks at. `sum(af.n)` instead. Additive `create or replace`;
`0055` is not edited.

Found by an executable test, not by reading. The shape looks entirely
reasonable.

## Permission and consent are independent

Both required, neither implies the other.

- **OS permission** governs whether the device will deliver a transition.
- **Server consent** (`auto_attendance_consent = 'granted'`) governs whether an
  attempt will be counted.

Someone may hold Always-location and have withdrawn consent, in which case every
attempt is refused. Or grant consent and never grant the permission, in which
case no region is ever monitored. `isOperational` requires the app toggle, the
server consent, **and** the OS permission — asserted on both platforms.

Consent is written to the server **before** any region is registered. Monitoring
someone while the server would refuse every attempt would be collecting location
for nothing.

## What is deliberately absent

Asserted by a forbidden-symbol sweep that walks the real source trees, strips
comments, asserts a minimum file count, and is **proven to fail on an injected
violation**:

- No `startUpdatingLocation`, `allowsBackgroundLocationUpdates`,
  `startMonitoringSignificantLocationChanges`, `startMonitoringVisits`,
  `requestLocationUpdates`, or any `LocationListener`.
- No foreground service, no `startForeground`, no `FOREGROUND_SERVICE_LOCATION`.
- No DeviceCheck, App Attest, Play Integrity, advertising id, `identifierForVendor`,
  or analytics.
- No QR scanning or camera (Prompt 8), no player, no payments.
- No logging call of any kind in any attendance file.
- No `UserDefaults` or plain `SharedPreferences` in any attendance file.

The Android manifest declares exactly seven permissions, asserted as an exact
list so an eighth cannot appear unnoticed.
