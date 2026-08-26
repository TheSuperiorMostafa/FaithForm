# Prompt 7 — Android geofence implementation

`minSdk 26`, `targetSdk 34`, `compileSdk 34`. Play services location **21.3.0**.

## Sources consulted

Android documentation only, read 2026-08-24:

- [Create and monitor geofences](https://developer.android.com/develop/sensors-and-location/location/geofencing)
- [Request background location](https://developer.android.com/develop/sensors-and-location/location/permissions/background)
- [Request location permissions](https://developer.android.com/develop/sensors-and-location/location/permissions)
- [Location updates in Android 11](https://developer.android.com/about/versions/11/privacy/location)
- [Background location limits](https://developer.android.com/about/versions/oreo/background-location-limits)

### What the documentation states, quoted

> "You can have multiple active geofences, with a limit of 100 per app, per
> device user."

> "On Android 11 (API level 30) and higher, however, the system dialog doesn't
> include the *Allow all the time* option. Instead, users must enable background
> location on a settings page."

> Geofences are **not** automatically restored after device reboot; the app must
> listen for boot-complete and re-register. They *are* restored after a Play
> services upgrade.

Latency: typically under two minutes; ~2–3 minutes with background location
limits in effect; up to ~6 minutes if the device has been stationary a while.

## The API-level split — the part most often got wrong

| API | Background permission | How to request it |
|---|---|---|
| 26–28 | Does not exist | Foreground location is sufficient |
| 29 (Android 10) | `ACCESS_BACKGROUND_LOCATION` | A runtime dialog offering "Allow all the time" |
| 30+ (Android 11+) | `ACCESS_BACKGROUND_LOCATION` | **Settings only.** The runtime dialog has no such option |

Modelled as `BackgroundRequestStrategy.forSdk(sdkInt)` →
`ImpliedByForeground` / `RuntimeDialog` / `SettingsOnly`, and asserted for
26, 28, 29, 30, 34 and 35.

**On API 30+ `requestBackground()` deliberately does nothing.** Calling
`requestPermissions` there shows no dialog, and the person is left looking at an
unchanged screen wondering what happened. The UI sends them to Settings, with
copy that says so.

Foreground must be resolved first — Android rejects a background request without
it. `needsForegroundFirst` makes the ordering a property of the type rather than
a comment in a view.

## Approximate location is its own state

Android 12 put precise-versus-approximate in the same dialog, so
`ACCESS_COARSE_LOCATION` without `ACCESS_FINE_LOCATION` is an **ordinary answer**,
not an edge case. Approximate is city-block accurate; a campus radius is 150 m.
Geofences registered under coarse-only permission are unreliable, so this is a
blocked state with its own copy and its own recovery — never folded into denial.

`COARSE` is declared in the manifest precisely so the app can *recognise* that
state. An undeclared permission cannot be checked, and the app would have to
guess.

## Modules

Decision logic is in the **pure-JVM** `:core:attendance` module, so
`gradle :core:attendance:test` exercises every branch on any runner:

| File | Role |
|---|---|
| `LocationPermissions.kt` | The permission model and the API-level strategy |
| `GeofenceReconciler.kt` | `RegionMonitoring`, the reconciler, region selection |
| `EvidenceMachine.kt` | Phases, refusals, evidence, idempotency, retry |
| `AutomaticAttendance.kt` | The coordinator |
| `AutomaticAttendanceUiState.kt` | Steps, blockers, the pure resolver |

Android glue is in `:app` and holds **no decisions**:

| File | Role |
|---|---|
| `attendance/PlayServicesGeofencing.kt` | `GeofencingClient`, permissions, one-shot fix |
| `attendance/GeofenceReceivers.kt` | Transition, boot, package-replaced, region mirror |
| `attendance/EncryptedPendingAttemptStore.kt` | `EncryptedAttendanceAttemptStore` — the open logical attempt |
| `ui/attendance/AutomaticAttendanceScreens.kt` | Compose screens |

## The `PendingIntent`

```kotlin
Intent(context, GeofenceBroadcastReceiver::class.java)   // explicit component
FLAG_UPDATE_CURRENT or FLAG_MUTABLE                       // FLAG_MUTABLE from API 31
```

Three things make it safe:

- **Explicit component** — it names this app's own receiver, so it cannot be
  redirected elsewhere.
- **`FLAG_MUTABLE`** — required from API 31 and required by the geofencing API,
  which fills in the transition extras. An immutable intent silently delivers
  nothing. Paired with the explicit component, Play services may add extras but
  not change the destination.
- **`FLAG_UPDATE_CURRENT` with a fixed request code** — `addGeofences` and
  `removeGeofences` must receive the *same* PendingIntent to address the same
  registration.

`FLAG_IMMUTABLE` is asserted absent.

## Receivers

| Receiver | Exported | Guard |
|---|---|---|
| `GeofenceBroadcastReceiver` | **false** | Only the system and Play services can deliver; no other app can forge a transition |
| `BootAndUpdateReceiver` | true | Must be, to hear `BOOT_COMPLETED` — guarded by `android:permission="RECEIVE_BOOT_COMPLETED"`, which only the system holds |
| `PackageReplacedReceiver` | false | `MY_PACKAGE_REPLACED` is system-only |

### `goAsync` and its honest limit

`onReceive` runs on the main thread and must return promptly; `goAsync` buys
roughly ten seconds. The evidence flow — refresh configuration, resolve the
occurrence, take a fix, submit — **will not always fit**.

That is not papered over. When it does not fit, the attempt is left in the
encrypted pending queue and retried on next foreground. Holding the receiver
open longer is not available, and starting a foreground service to do it would
be exactly the continuous-location shape this feature avoids.

## The region mirror

Play services offers **no API to enumerate registered geofences**. That is the
single most awkward fact about this integration, because the reconciler's design
is "compare desired against actual" and `actual` cannot be read back.

A mirror is kept in `EncryptedSharedPreferences`. It is an **efficiency aid,
never authority**: a reboot clears the system's geofences without updating it,
which is exactly why `BootOrUpdate` ignores the mirror and re-registers
everything. Correctness never depends on the mirror being right.

## Reboot, update, force-stop

| Event | Behaviour |
|---|---|
| Reboot | Geofences cleared. `BOOT_COMPLETED` → reconcile with a **forced** configuration refresh, because access may have been revoked while the device was off |
| Play services upgrade | Restored automatically. Nothing needed |
| App update | `MY_PACKAGE_REPLACED` → reconcile (idempotent, so costs nothing if unchanged) |
| **Force-stop** | **Android delivers no broadcast and clears the app's geofences. Nothing runs again until the person opens the app.** Documented, not worked around — there is no supported mechanism |

## Dwell — the OS transition, driven by configuration

Play services has a real dwell transition: `GEOFENCE_TRANSITION_DWELL` with
`setLoiteringDelay`. It is a genuine advantage over iOS, which has none.

**An earlier version refused to use it**, on the grounds that a device-side
loitering delay would go stale against the server's rule. That reasoning was
wrong: **the answer to staleness is reconciliation, not abstention.**

How it works now:

- The delay comes from `minDwellSeconds` in the **authoritative configuration**,
  never from a constant. A test asserts `setLoiteringDelay` is never called with
  a literal.
- It is **part of the region's identity** (`MonitoredRegion.loiteringDelayMillis`),
  so a church editing its policy changes `configVersion` → the configuration is
  refetched → the region differs → the reconciler re-registers. A test asserts
  two regions differing only in delay are unequal, because that inequality is
  what makes the re-registration happen.
- A church with `requiresConfirmation == false` gets a **zero** delay and no
  dwell transition at all — a check-in it chose to make immediate is not
  delayed.

On the dwell transition the receiver calls `confirmIfDue()`, which refreshes
authorization, takes a **fresh** one-shot fix, and submits `confirm` with the
server-issued detection id.

**The dwell callback schedules an opportunity; it does not prove server dwell
elapsed.** The server measures that itself, between its own `detected_at_server`
and `now()`, so a callback delivered early is refused `dwell_not_elapsed` and
simply tries again. The loitering delay is a scheduling hint, not an authority.

**No coroutine `delay` spans a dwell.** A `goAsync` receiver has roughly ten
seconds regardless, and a delay would not survive the process being killed.

## Geofence configuration

- `GEOFENCE_TRANSITION_ENTER or GEOFENCE_TRANSITION_EXIT`.
- `INITIAL_TRIGGER_ENTER` — fires if the device is *already* inside when the
  region is registered, which is the common case: someone turns the feature on
  while sitting in the building.
- `NEVER_EXPIRE` — the reconciler owns the lifetime, not the system.
- `setNotificationResponsiveness(2 minutes)` — longer responsiveness costs less
  battery and lets the system batch. A service lasts an hour; two minutes of
  latency is irrelevant to a check-in and materially cheaper on a phone.
- **`GEOFENCE_TRANSITION_DWELL` is used when the church's policy asks for a
  confirmation** — see above — with the delay from authoritative configuration.
- Registered in **one batched call**, not one per region.

## Manifest — exactly seven permissions

```
INTERNET
ACCESS_NETWORK_STATE
POST_NOTIFICATIONS
ACCESS_COARSE_LOCATION
ACCESS_FINE_LOCATION
ACCESS_BACKGROUND_LOCATION
RECEIVE_BOOT_COMPLETED
```

Asserted as an **exact sorted list**, so an eighth cannot appear unnoticed.

Absent: no `FOREGROUND_SERVICE`, no `FOREGROUND_SERVICE_LOCATION`, no
`ACTIVITY_RECOGNITION`, no `AD_ID`.

## Dependency added

`com.google.android.gms:play-services-location:21.3.0` — the only Play services
artifact. No Maps, no Ads, no Analytics, no Play Integrity.

## Tests — 212 Kotlin

### `:core:attendance:test` — **103 execute**

`PermissionModelTest`, `ReconcilerTest`, `EvidenceTest`, `ResolverTest`,
**`AttemptPolicyTest`** (cooldown shape, rolling budget, every bypass trigger,
"five refusals do not lock out", "only a count settles", constants matched to
iOS), and **`ConfirmationTest`** (the server instant is recorded and respected,
confirmation succeeds after it, restart preserves the pending attempt, a missing
confirmation creates nothing, consent revoked mid-flow fails closed, an older
server gets a fallback).

### `:app:testDebugUnitTest` — **52 execute**

**This was `NO-SOURCE` two passes ago.** Robolectric 4.13 runs the Android
framework on the JVM.

| Suite | Covers |
|---|---|
| `ManifestAndReceiverTest` (11) | The **merged** manifest's exact permission list; no foreground-service or tracking permission from any library; **no service declared**; receiver export states; `BOOT_COMPLETED` and `MY_PACKAGE_REPLACED` actually *resolve*; `PendingIntent` flags on API 30 and 34 |
| `AndroidPermissionTranslationTest` (11) | Fine, **coarse-only**, nothing-granted; services off; **API 28 / 29 / 30 / 34 on those actual API levels**; API 30 background request grants nothing; **Play services unavailable — including the throwing path** |
| **`GeofencingRequestTest` (14)** | The full request, batching, initial trigger, loitering delay and its role in region identity, success / failure / cancellation, **partial-failure self-heal**, permission gate, teardown, reboot |
| `GeofenceReceiverTest` (8) | Wrong action; no payload; region-id prefix; **the OS dwell transition is used and configuration-driven**; no continuous location or foreground service |
| `EncryptedAttemptStoreTest` (8) | Round-trip with the queued position; `openIfAbsent` semantics; **expiry purge**; partition isolation; `close` vs `closeAll`; corrupt data discarded |

### Which test tasks execute

| Task | Status |
|---|---|
| `:core:attendance:test` | **103 execute** |
| `:core:contract:test` | **42 execute** |
| **`:app:testDebugUnitTest`** | **52 execute** (nonzero, 0 failures) |
| `:core:navigation:test`, `:core:storage:test` | 8 and 7 execute |
| `:core:design:test`, `:core:network:test` | `NO-SOURCE` — no test sources, pre-existing and unrelated |

### The Play services façade — previously untested, now covered

`GeofencingClient` sits behind `GeofencingFacade`, a narrow interface with one
member per call. `PlayServicesGeofencingFacade` is the production
implementation; `RecordingFacade` in the tests records what it was asked and
returns a scripted result.

**This tests that Faithful calls Play services correctly and handles every
result. It does not test Play services**, which is not ours to verify.

| Covered | |
|---|---|
| The `GeofencingRequest` | Region ids, `INITIAL_TRIGGER_ENTER`, batching, `NEVER_EXPIRE`, the loitering delay |
| Every task result | Success, failure, **cancellation** |
| **Partial failure** | A failed registration is **not** mirrored, so the next reconciliation retries it — asserted by driving a failure then a success |
| Removal on failure | The mirror is cleared anyway: erring towards "not registered" costs a redundant registration, never a silently-live geofence |
| The permission gate | Nothing is registered without permission; the gate is injectable and *replaces* the framework check so both sides are reachable |
| The `PendingIntent` | The same instance for add and remove — a different one would leave geofences live after a teardown |
| Reboot | Re-registration is issued again because the mirror is not authority |
| Teardown | Revocation removes everything through the real monitoring object |

Two seams made this possible, and both are honest rather than convenient:

- `RegionMirror` takes a `SharedPreferences` rather than building one. A JVM has
  no `AndroidKeyStore`, so a class that constructs `EncryptedSharedPreferences`
  in its initialiser cannot be exercised at all. `RegionMirror.encrypted()` is
  the production call site, and the privacy sweep asserts it stays encrypted.
- `GoogleApiAvailability.isGooglePlayServicesAvailable` **throws** when the
  version meta-data is absent rather than returning a code. The check now fails
  closed on any exception — which is the correct production behaviour, not a
  test accommodation, and one test exercises exactly that path.

### Still not covered

Whether Play services honours a registration it accepted. That is what the
device runbook is for.
