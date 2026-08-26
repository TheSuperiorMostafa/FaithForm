# Prompt 7 — iOS geofence implementation

Deployment target **iOS 17**, Swift 6 strict concurrency (`swiftLanguageMode(.v6)`).

## Sources consulted

Apple documentation only, read 2026-08-24:

- [Region Monitoring and iBeacon](https://developer.apple.com/library/archive/documentation/UserExperience/Conceptual/LocationAwarenessPG/RegionMonitoring/RegionMonitoring.html)
- [Monitoring the user's proximity to geographic regions](https://developer.apple.com/documentation/corelocation/monitoring-the-user-s-proximity-to-geographic-regions)
- [`CLLocationManager`](https://developer.apple.com/documentation/corelocation/cllocationmanager)
- [`startMonitoring(for:)`](https://developer.apple.com/documentation/corelocation/cllocationmanager/startmonitoring(for:))
- [`monitoredRegions`](https://developer.apple.com/documentation/corelocation/cllocationmanager/monitoredregions)

### What Apple states, quoted

> "Core Location limits to 20 the number of regions that may be simultaneously
> monitored by a single app."

> "In iOS, regions associated with your app are tracked at all times, including
> when the app isn't running. If a region boundary is crossed while an app isn't
> running, that app is relaunched into the background to handle the event."

> "for testing purposes, you can assume that the minimum distance is
> approximately 200 meters"
> — the distance the device must move past a boundary before a crossing is reported.

### What Apple does **not** state, and we therefore do not claim

- **Force-quit behaviour.** The documentation does not address what happens to
  region monitoring after a person force-quits from the app switcher. We make no
  claim either way, and the runbook tests it as an open question rather than
  asserting an outcome.
- **Reboot before first launch.** Not documented. Also a runbook question.
- **Delivery latency or guarantees.** Region monitoring is best-effort. The app
  does not promise a check-in will happen, and the UI never says it will.

## Files

| File | Role |
|---|---|
| `Attendance/LocationAuthorization.swift` | Accuracy model, `LocationAuthorizing`, `LocationSampling`, `LocationSample` |
| `Attendance/GeofenceReconciler.swift` | `RegionMonitoring`, the reconciler, region selection |
| `Attendance/EvidenceMachine.swift` | `EvidencePhase`, `EvidenceRefusal`, `AttendanceEvidence`, `IdempotencyKey`, `PendingAttempt`, `RetryPolicy` |
| `Attendance/AutomaticAttendance.swift` | The coordinator, protocols for submission and storage |
| `Attendance/Digest.swift` | SHA-256 for idempotency keys |
| `Attendance/AttemptStore.swift` | `KeychainAttemptStore` — the open logical attempt |
| `Attendance/CoreLocationAdapter.swift` | `CoreLocationFacade`, `SystemCoreLocationFacade`, and **the only production file that imports CoreLocation** |
| `Features/AutomaticAttendanceModel.swift` | `@Observable` screen model, step machine |
| `Components/AutomaticAttendanceViews.swift` | SwiftUI screens |

`LocationAuthorization` itself lives in `Features/DiscoveryModel.swift`, where
Prompt 5 introduced it. It was **extended** with `.authorizedAlways` and the
region-monitoring helpers rather than duplicated — there is one underlying
`CLAuthorizationStatus`, and two enums for it would eventually disagree.

## Permission progression

Four deliberate taps from opening the app. Nothing is requested before them.

```
notStarted
  → [tap "Turn on automatic check-in"]
introduction              what it is + the privacy explanation, same screen
  → [tap Continue]
foregroundEducation       why location is needed
  → [tap Continue]        ← FIRST OS PROMPT: requestWhenInUseAuthorization
backgroundEducation       why "all the time" is needed
  → [tap Continue]        ← SECOND OS PROMPT: requestAlwaysAuthorization
requestingConsent         POST /attendance/consent
ready
```

**When In Use is never chained straight into Always.** iOS shows the Always
prompt meaningfully once; spending it before the person knows what it is for is
how an app gets permanently denied.

### Every authorization state is handled explicitly

| State | Treatment |
|---|---|
| `.notDetermined` | Nothing requested; the flow can start |
| `.restricted` | **Not** recoverable — parental controls or MDM. No Settings link, because it would be a dead end |
| `.denied` | Recoverable in Settings. Settings link offered |
| `.authorizedWhenInUse` | A **blocked** state. Core Location delivers no region events on it, so claiming the feature works would be a feature that silently never fires |
| `.authorizedAlways` | Required for monitoring |
| `.unavailable` | Location services off device-wide, for every app. Distinct copy |

Reduced accuracy is a **separate axis**, not folded into denial: the recovery
differs. iOS 14's approximate location is kilometre-scale; a campus radius is
100–300 m, so a reduced-accuracy fix cannot decide presence and Core Location
will not deliver useful region events from one.

`@unknown default` maps an unfamiliar future status to `.denied` — failing
closed on a value this build does not understand.

## The Core Location seam

`CoreLocationAdapter` no longer constructs a `CLLocationManager`. It takes a
`CoreLocationFacade` — one member per framework call — and
`SystemCoreLocationFacade` is the production implementation with nothing in it
that could be wrong on its own.

**Why.** `CLLocationManager` cannot be constructed usefully on a test runner:
`authorizationStatus` reflects the host machine, `startMonitoring` needs a real
Location Services daemon, and `requestAlwaysAuthorization` does nothing without
a UI. Without the seam, the adapter's *translation* — status mapping, radius
clamping, region diffing, delegate wiring, continuation handling — would be
reachable only on a device, which is exactly the code most likely to be subtly
wrong.

### The authorization bridge — and a correction

An earlier version had `CoreLocationAdapter.map` switch on
`CLAuthorizationStatus.rawValue`, because `.authorizedWhenInUse` cannot be
*constructed* on macOS where `swift test` runs.

**That was the wrong trade.** It put an undocumented numeric contract on the
production authorization path purely to make a test convenient. The seam should
move, not the semantics.

The façade now exposes **Faithful's own `LocationAuthorization`**, and the one
place a `CLAuthorizationStatus` is interpreted is
`SystemCoreLocationFacade.normalize`, which switches on **real case names**:

```swift
case .notDetermined: return .notDetermined
case .restricted:    return .restricted
case .denied:        return .denied
case .authorizedAlways: return .authorizedAlways
#if os(iOS) || os(watchOS) || os(tvOS)
case .authorizedWhenInUse: return .authorizedWhenInUse
#endif
@unknown default: return .denied       // an unrecognised status is not a grant
```

`.authorizedWhenInUse` exists only on iOS/watchOS/tvOS and `.authorized` only on
macOS, so the two are compiled separately — honest about the platforms rather
than papering over them with a number. Everything above the bridge — adapter,
reconciler, coordinator, screen model — sees only the normalized value, and the
tests exercise that normalized behaviour on every target.

Policy stays out of the adapter: a test asserts it contains no `consent`,
`occurrence`, `idempotenc`, `authorizationVersion`, `minDwellSeconds`,
`requiresConfirmation` or `no_people_link` vocabulary.

## Core Location usage

- `startMonitoring(for: CLCircularRegion)`, `notifyOnEntry` **and**
  `notifyOnExit`. Exit is how an abandoned intent is cancelled when someone
  drives past rather than arriving.
- Radius clamped to `maximumRegionMonitoringDistance`. The system silently
  reduces an over-large radius, so clamping here keeps `monitoredRegions()`
  comparable with what was requested — otherwise reconciliation would see a
  difference every time and re-register forever.
- `requestLocation()` for the confirmation fix — **one** reading, self-stopping.
  Never `startUpdatingLocation`.
- A timeout resumes the continuation with `nil`. A cold GPS indoors is the
  ordinary case, not a rare one; the attempt is submitted without coordinates
  and the server bands it `unknown`, which fails closed.

`CLRegion` is not `Sendable`, so the identifier is read on the delegate thread
and the framework object never crosses to the actor. That is the right shape
anyway: an identifier is all this feature needs.

## Info.plist strings

These are **not** in the repository, because the SwiftPM package has no app
target — see `P7_PERMISSION_PRIVACY_AND_STORE_COMPLIANCE.md`. The exact required
values are recorded there so whoever creates the Xcode project cannot guess.

## What is absent

`startUpdatingLocation`, `allowsBackgroundLocationUpdates`,
`startMonitoringSignificantLocationChanges`, `startMonitoringVisits`,
`pausesLocationUpdatesAutomatically`, `startUpdatingHeading`, DeviceCheck, App
Attest, `identifierForVendor`. Asserted by a sweep proven to fail on injection.

**There is no iOS mock-location signal**, and none is invented. `AttendanceEvidence`
sends `mockLocationReported: nil` from iOS, always.

## Dwell — best effort, honestly

**Core Location has no dwell transition.** `CLCircularRegion` reports entry and
exit and nothing between. Android's `GEOFENCE_TRANSITION_DWELL` has no iOS
counterpart and none is invented.

The path that exists:

1. `detected` is submitted; the server answers `pending_confirmation` with
   **`confirmationNotBefore`**.
2. That instant **and the server-issued `detectionId`** are persisted with the
   attempt, in the Keychain — not held in memory, because the wait spans
   exactly the window where the app is most likely to be suspended or killed.
3. `confirmIfDue()` runs on any legitimate execution opportunity: another region
   callback, an app foreground, a granted background refresh. It does nothing
   before the server's instant, so no predictably-refused `confirm` is ever
   sent.
4. When one arrives after the instant, a **fresh** one-shot fix is taken and
   `confirm` is submitted with the same idempotency key **and the detection
   id**. The server measures the dwell between its own `detected_at_server` and
   `now()`; `confirmationNotBefore` is only how iOS decides when to bother.
   A client with a deadline but no detection never confirms.
5. **If none ever arrives**, the attempt expires at two hours, is purged unsent,
   and nobody is counted.

**No in-memory timer, and no background task assertion.** A `Task.sleep`
spanning a dwell would not survive suspension, and an assertion requested for
one is a request the system may refuse. Either would produce a feature that
appeared to work on a plugged-in device in the foreground and silently did not
in a pocket. Asserted by sweep.

**Confirmation is not gated on in-memory phase.** An earlier version guarded on
`.awaitingDwell`, which after a relaunch is `.idle` — the ordinary case for a
background wake, not an edge one — making a persisted attempt unconfirmable
forever. Found by the restart test.

**Nothing here is guaranteed.** The app does not claim automatic attendance will
always happen, and the readiness screen says the feature is on rather than
promising an outcome.

## Tests — 217, `swift test`

New for Prompt 7: **114** across four suites, including a 22-test
`Core Location adapter` suite that runs on the plain macOS runner.

| Suite | Covers |
|---|---|
| Automatic attendance permissions | No prompt at launch; progressive escalation; denied; restricted; When-In-Use-only; reduced accuracy; services off; consent before monitoring; consent refused; permission ≠ consent; disable tears down; every blocker has distinct copy; copy is not guilt-based |
| Geofence reconciliation | Registers authorized; idempotent; moved vs unchanged; withdrawn; 20-region limit with deterministic selection; invalid geometry; authorization loss; accuracy loss; every server refusal; church switch; authorization-version bump; sign-out; region event forces refresh; offline is not teardown; scoped region ids |
| Evidence submission | One detected attempt; success only from a verdict; already-counted is success; concurrent duplicates; sequential duplicates; per-occurrence settlement; **the key's inputs**; **attempt-id shape**; **one attempt from six concurrent callbacks**; **ten concurrent opens produce one id**; **restart reuses the key**; **transient failure reuses the key**; **refusal closes the attempt**; **`outside_region` does not poison the service**; **a refusal does not settle the occurrence**; **refusals are bounded**; counted suppresses; already-counted suppresses; expiry purges; per-occurrence and per-church isolation; dwell completes; **no timer spans a dwell**; **confirmation with no surviving attempt**; **confirmation for the wrong occurrence**; exit abandons; no open occurrence; revocation mid-flow; teardown classification; reduced accuracy refuses; no fix still submits; invalid fix; offline queue bounded; **the queued submission carries no key of its own**; backoff; terminal not retried; canonical request |
| **Core Location adapter** (new) | **Semantic `CLAuthorizationStatus` bridge**; only-Always-monitors on the normalized enum; services-off outranks status; accuracy axis; monitoring availability; When In Use requested once; Always refusal reported; already-Always skips; registration with entry **and** exit; **radius clamping**; removal by identifier; teardown removes all; **capacity through the real adapter**; **revocation teardown through the real adapter**; fix translation drops speed/course/altitude; failure callback yields nil; no fix without authorization; **region enter callback translated to one identifier**; exit callback; no continuous API invoked; desired accuracy |

Every one runs on a plain macOS runner. No simulator, no device, no movement.
