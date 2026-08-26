# Prompt 7 — Permission, privacy, and store compliance

## The claim this feature makes, and the one it does not

**Makes:** when you arrive for a service, your church can know you attended.

**Does not make:** anything about where else you go, when, or how often. No
location history is created, kept, or transmitted.

That distinction is the whole privacy design, and the copy on screen says
exactly it.

## What actually leaves the device

| | |
|---|---|
| **On a region event** | One latitude/longitude, one accuracy reading, one dwell figure, one occurrence id |
| **How long they exist** | The duration of one request, plus at most two hours if the device is offline — bounded by the logical attempt that carries them |
| **What is stored server-side** | A **band** — `inside`/`near`/`far`/`unknown` and `high`/`medium`/`low`/`unusable`. Never the coordinates |
| **What the counted fact holds** | **No location at all** |
| **What the church sees** | That a person attended a service |

The coordinates are inputs to a computation the server performs and then
discards. `attendance_attempts` has no latitude or longitude column.

## Permission copy

The introduction and both education screens are written to be read by someone
deciding, not persuaded. A test asserts the copy contains none of: "you must",
"required to", "don't let", "miss out", "everyone else", "your church expects",
"only takes a second", "we promise".

The privacy explanation is on the **introduction screen**, not behind a link:
someone deciding whether to share their location deserves to read what happens
to it in the same breath as the offer.

Declining is a real outcome. "Not now" is on every screen, and choosing it
leaves the app fully usable.

## The permission progression

Never at launch, never during discovery, never during login, never while
browsing a feed. Four deliberate taps on iOS, four on Android.

| Step | iOS | Android |
|---|---|---|
| 1 | Introduction + privacy | same |
| 2 | Foreground education → `requestWhenInUseAuthorization` | Foreground education → `ACCESS_FINE_LOCATION` |
| 3 | Always education → `requestAlwaysAuthorization` | Background education → API 29 dialog, or **API 30+ Settings** |
| 4 | `POST /attendance/consent` | same |

## OS permission is not consent

Two independent gates, both required:

- **OS permission** governs whether a transition is ever delivered.
- **Server consent** governs whether an attempt is ever counted.

Consent is recorded **before** the first region is registered. Monitoring
someone while the server would refuse every attempt would be collecting location
for nothing.

Turning the feature off does four things, in order: stop monitoring, cancel
in-flight work, purge unsent evidence, withdraw server consent. The local
teardown happens first — whatever the network does, this device stops.

## Dwell, and what is not promised

Neither platform's automatic check-in is guaranteed to complete.

- **Android** uses the OS dwell transition, with the loitering delay taken from
  the church's own policy. That is a real system callback saying the device
  stayed — a genuine advantage.
- **iOS has no dwell transition at all.** Confirmation waits for another region
  callback, an app foreground, or a granted background refresh.

When none of those comes, the attempt expires at two hours and the person is not
counted. **No in-memory timer spans a dwell on either platform**, because one
would not survive suspension or a killed process and would produce a feature
that worked on a desk and not in a pocket.

The server tells the client when it may confirm (`confirmationNotBefore`), so no
predictably-refused submission is ever sent — but that value is **scheduling
information, not authority**. The dwell itself is measured server-side between
`detected_at_server` and `now()`, so no device clock can shorten it.

Nothing in the UI claims automatic attendance will always happen. The readiness
screen says the feature is on; it does not promise an outcome.

## Battery

| Choice | Effect |
|---|---|
| OS region monitoring, not app polling | The system uses cell/wifi transitions it is already computing. There is no timer and no wake-up loop in this app |
| `setNotificationResponsiveness(2 min)` on Android | Lets the system batch. A service lasts an hour; two minutes of latency is irrelevant here |
| One-shot fix only | `requestLocation()` / `getCurrentLocation()` — self-stopping, never a subscription |
| Sequential-duplicate suppression | Re-entering the building after being counted costs **zero** radio wakes and zero requests |
| Exponential cooldown | A flapping boundary costs one submission, then progressively fewer — 30 s doubling to a 10-minute ceiling |
| Token bucket | Capacity 12, refilling continuously at one per minute. An empty bucket is at most **one minute** from a token |
| Explicit bound | **`maxLocalHold` = 10 minutes.** No combination of throttling holds a device longer, and it is asserted exhaustively |
| OS dwell on Android | The confirmation arrives on a system callback instead of the app waking repeatedly to check |
| Bounded backoff with jitter | A congregation's phones do not retry in lockstep |
| No foreground service | Nothing runs continuously |

**Not measured.** No battery figure is claimed; the runbook has an observation
step, and until it runs this is a set of design choices rather than a result.

## Store compliance

### Apple

`NSLocationWhenInUseUsageDescription`, `NSLocationAlwaysAndWhenInUseUsageDescription`
and the background mode are **not in this repository**, because the SwiftPM
package has no app target — see `P4_EXTERNAL_SETUP_RUNBOOK.md`. Whoever creates
the Xcode project needs exactly these, and guessing would produce a rejection:

```
NSLocationWhenInUseUsageDescription
  Faithful uses your location to check you in when you arrive for a service at
  your church.

NSLocationAlwaysAndWhenInUseUsageDescription
  Faithful checks you in when you arrive for a service, even when the app is
  closed. It only ever looks at whether you have arrived at your church, and it
  never keeps a record of where you have been.

UIBackgroundModes
  location            ← required for region monitoring delivery
```

Purpose strings must name **the specific benefit to the person**, not the
company. Both above do.

**App Privacy answers** ("Data Types" in App Store Connect):

| Question | Answer | Why |
|---|---|---|
| Precise Location collected? | **Yes** | A coordinate is transmitted on a region event |
| Linked to the user? | **Yes** | It is submitted authenticated |
| Used for tracking? | **No** | Never shared with a data broker, never joined across apps, no advertising identifier exists in this app |
| Purpose | App Functionality | Attendance, nothing else |

"Not collected" would be wrong: the coordinate does leave the device, even
though it is discarded after banding. Answering otherwise to look cleaner would
be a false declaration.

### Google Play

**Background location declaration** — required, and reviewed by hand:

- **Feature:** automatic attendance check-in when a member arrives at their own
  church for a service.
- **Why foreground is not sufficient:** check-in happens while a person is
  settling into a seat, not looking at their phone. With foreground-only
  permission the system delivers no transition and the feature never fires.
- **Core to the feature:** yes. Without it there is no automatic attendance.
- **Video:** must show the in-app education screens *before* the system dialog,
  then a check-in occurring with the app closed. Not yet recorded.

**Data safety form:**

| Field | Answer |
|---|---|
| Location collected | Yes — approximate and precise |
| Shared with third parties | **No** |
| Processed ephemerally | Coordinates yes; the derived band is retained |
| Required or optional | **Optional** — the app is fully usable without it |
| Can users request deletion | Yes — existing account deletion (Prompt 3) |
| Purpose | App functionality |

**Prominent disclosure** is satisfied by the education screens, which appear
before any runtime request and state what is collected and why.

**Not claimed:** no store listing exists, nothing has been submitted, and no
review has been passed. These are the answers to give, not answers that have
been given.

## Logging

No attendance file on either platform contains a single logging call — asserted
across every file matching `*ttendance*`, `*Geofence*` and `*geofence*` for
`print`, `NSLog`, `debugPrint`, `Log.d/i/w/e/v` and `println`.

Deliberately never logged:

- Coordinates, at any precision.
- Region identifiers **combined with a transition** — a region id plus "entered"
  is a location fact about a person.
- Core Location and geofence error objects, which carry region identifiers.
- Tokens, People identifiers, account identifiers.
- Any provider payload.

The Core Location and Play services failure handlers are silent by design, with
a comment saying why. The next reconciliation re-derives the whole desired set,
so a failed registration self-heals without a bespoke recovery path.

## Storage

| | iOS | Android |
|---|---|---|
| Open logical attempt | Keychain | `EncryptedSharedPreferences` |
| Region mirror | n/a (`monitoredRegions` is readable) | `EncryptedSharedPreferences` |
| Lifetime | 2 hours, then purged unsent | same |

Never `UserDefaults`, never a plain `SharedPreferences`, never the projection
cache, never a notification body, never crash metadata, never UI state
restoration — asserted by sweep.

Everything is partitioned by `environment | account | church | authorizationVersion`,
so a queued attempt cannot be read back under a different account or after a
revocation — asserted by a Robolectric test that bumps the version and requires
the attempt to become invisible.

### Attempt ids are not tracking identifiers

Each attempt carries 128 random bits. Worth being explicit about what that is
*not*:

| | |
|---|---|
| Scope | One occurrence at one church for one account |
| Lifetime | Two hours at most, then purged |
| Transmitted? | Never — it is hashed into an idempotency key and nothing else |
| Correlatable? | No. Two attempts share nothing, and the id is not derived from the account, the device, or anything stable |
| Deleted when? | On counted, already-counted, terminal refusal, abandonment, expiry, disable, and sign-out |

A test generates 200 and requires them all distinct and all 32 hex characters,
from `SecureRandom` on Android and `arc4random`-backed randomness on iOS.

### A refusal is never a lockout

Worth stating plainly, because two attempts at bounding retries got it wrong in
turn: **no number of failed readings ever permanently prevents someone being
counted.**

- A hard cap of five was the original bug at a larger number.
- A 12-per-rolling-hour budget was the same thing again: spend it in two minutes
  and the next attempt is up to an hour away — longer than the service.

What stands now is an exponential cooldown capped at ten minutes, a
continuously refilling token bucket whose worst case is one minute, and bypass
triggers — a verified exit, a materially better fix, a configuration change.
**The maximum local hold is 10 minutes**, stated as a constant and asserted
exhaustively. Only a *count* ends an occurrence.

### A detection is a capability, and it is bounded

The server-issued `detectionId` is opaque, single-use, expires with the attempt,
and is bound to the account, member, church, occurrence, region, configuration
version and logical attempt. Every one is re-checked at confirmation, so it
cannot be replayed across any of them. It is not a tracking identifier: nothing
correlates two detections, and it is never read by anything but the server.

## Spoofing — the honest limitation

**Ordinary coordinates do not prove physical presence.** A determined person can
report whatever their device will report. Nothing here changes that.

Android's `Location.isMock` is submitted as **one signal among several** and is
never the sole decision rule: a rooted developer phone is not automatically
dishonest, and a determined spoof does not set the flag at all. **iOS has no
equivalent and none is invented** — the field is always null from iOS.

No DeviceCheck, App Attest, or Play Integrity was introduced. Each would be a
new relationship with a platform vendor rather than a code change, and none is
authorized by the architecture.

What raises the cost is server-side and unchanged from Prompt 6: the distance
banded against the occurrence's own snapshotted campus, the accuracy band, the
dwell requirement, the window, the People link, the consent, the unique fact,
and the attempt audit that makes a pattern visible afterwards.
