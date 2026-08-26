# Prompt 7 — Parity and verification matrix

## Completion levels, kept separate

| Level | Status |
|---|---|
| **Source complete** | ✅ Both platforms, integration paths, documentation |
| **Local automated verification** | ✅ Every locally executable gate green, **including 36 real Android framework tests and 21 Core Location adapter tests** |
| **Simulator / emulator** | ⛔ **Not performed.** No simulator or emulator was launched |
| **Physical device** | ⛔ **Not performed** |
| **Deployed staging** | ⛔ Nothing deployed |
| **Production** | ⛔ Nothing deployed |

> **Automatic attendance has never been observed on a real device.**
> Every permission branch, reconciliation rule and evidence transition is
> exercised by tests, and the server convergence is executed against real
> Postgres — but no geofence has fired on physical hardware. That remains true
> until `P7_DEVICE_TEST_RUNBOOK.md` section 15 passes.

## Gate results

Every command run on this machine, this session.

| Gate | Result |
|---|---|
| `pnpm ci:verify` | ✅ **exit 0** |
| ├ lint | ✅ 0 errors (47 warnings, all pre-existing) |
| ├ typecheck | ✅ |
| ├ contract freshness | ✅ 3 artifacts current |
| ├ design tokens | ✅ 22 contrast pairs pass WCAG |
| ├ localization parity | ✅ **136 shared keys**, 3 documented Android-only |
| ├ tests | ✅ **484/484** |
| ├ migration baseline | ✅ 61 legacy migrations verified |
| ├ secret scan | ✅ 1080 files |
| └ production build | ✅ |
| `pnpm test:concurrency` | ✅ **41/41** against real Postgres 17 |
| `pnpm ios:test` | ✅ **217/217**, 16 suites |
| `:core:attendance:test` | ✅ **103/103** |
| `:core:contract:test` | ✅ **42/42** |
| **`:app:testDebugUnitTest`** | ✅ **52/52** |
| `:core:navigation:test`, `:core:storage:test` | ✅ 8 and 7 |
| `pnpm android:build` | ✅ debug APK |
| `pnpm contract:check` | ✅ current |
| `pnpm test:migrations` | ✅ |
| `pnpm audit:prod` | ✅ `unresolvedHighOrCritical: []` |
| `pnpm scan:secrets` | ✅ |
| privacy / forbidden-symbol sweeps | ✅ 26/26, **injected-failure proof included** |
| `git diff --check` | ✅ clean |

**954 automated tests** — 484 web + 41 database + 217 Swift + 212 Kotlin
(103 + 42 + 52 + 8 + 7).

### Growth across the three passes

| | Prompt 7 | Closure | Correctness | Server authority |
|---|---:|---:|---:|---:|
| Web | 474 | 478 | 481 | **484** |
| Database | 20 | 25 | 29 | **41** |
| Swift | 156 | 193 | 210 | **217** |
| Kotlin | 121 | 171 | 205 | **212** |
| `:app` | **0 (`NO-SOURCE`)** | 36 | 52 | **52** |

Nothing was removed or weakened at any point.

### Which native test tasks execute

| Task | Status |
|---|---|
| `swift test` | **217 execute**, 16 suites |
| `:core:attendance:test` | **103 execute** |
| `:core:contract:test` | **42 execute** |
| **`:app:testDebugUnitTest`** | **52 execute** (nonzero, 0 failures) |
| `:core:navigation:test`, `:core:storage:test` | 8 and 7 execute |
| `:core:design:test`, `:core:network:test` | `NO-SOURCE` — no test sources, pre-existing and unrelated to attendance |

### What still has no test

Whether Play services honours a registration it accepted, and whether Core
Location delivers a region event on real hardware. Everything Faithful *does* —
the request it builds, the results it handles, the reconciliation, the
confirmation timing — is covered. What the operating systems then do is what the
device runbook is for.

## Test inventory

| Suite | Count |
|---|---:|
| **Web** | **484** |
| ├ `attendance-geofence-config` | 44 |
| ├ `mobile-contract` | 40 |
| ├ `attendance-authority-migration` | 36 |
| ├ `attendance-authorization` | 27 |
| ├ `native-attendance-privacy` | 26 |
| ├ `attendance-bulk` | 23 |
| ├ `attendance-sources` | 16 |
| ├ `attendance-distance` | 12 |
| ├ Prompt 2–6 suites | 260 |
| **Database** (real Postgres) | **41** |
| **iOS** (`swift test`) | **217** |
| ├ permissions + reconciliation + evidence + policy + confirmation | 88 |
| ├ `Core Location adapter` | 22 |
| ├ Prompt 4–6 suites | 107 |
| **Android** | **212** |
| ├ `:core:attendance` | 103 |
| ├ `:app` (Robolectric) | 52 |
| ├ `:core:contract` | 42 |
| ├ `:core:navigation` + `:core:storage` | 15 |
| **Total** | **954** |

## Platform parity

Behaviour that must match, and does — each asserted on both sides.

| Behaviour | iOS | Android |
|---|---|---|
| No prompt at launch / discovery / login / feed | ✅ | ✅ |
| Education before every OS prompt | ✅ | ✅ |
| Foreground resolved before background | ✅ | ✅ |
| Server consent written before first region | ✅ | ✅ |
| Permission ≠ consent; both required | ✅ | ✅ |
| Region cap **20**, deterministic by region id | ✅ | ✅ |
| Invalid geometry dropped | ✅ | ✅ |
| Reconciliation idempotent | ✅ | ✅ |
| Moved campus re-registered, identical left alone | ✅ | ✅ |
| Identity change clears before registering | ✅ | ✅ |
| Every refusal tears down | ✅ | ✅ |
| Offline is **not** teardown | ✅ | ✅ |
| Region event forces config refresh | ✅ | ✅ |
| Idempotency key construction | ✅ byte-identical, `v2` | ✅ |
| Key derived from a **logical attempt** | ✅ | ✅ |
| Attempt opened atomically before any submission | ✅ | ✅ |
| Attempt closed on every terminal outcome | ✅ | ✅ |
| A refusal does **not** settle the occurrence | ✅ | ✅ |
| **Refusals never lock an occurrence out** | ✅ | ✅ |
| Exponential cooldown, 30 s → 10 min | ✅ | ✅ |
| **Token bucket**, capacity 12, one per minute | ✅ | ✅ |
| **`maxLocalHold` = 10 min**, asserted exhaustively | ✅ | ✅ |
| Detection id persisted alongside the deadline | ✅ | ✅ |
| No detection ⇒ never confirms | ✅ | ✅ |
| The deadline is scheduling, not authority | ✅ | ✅ |
| Exit / improved fix / config change bypass the hold | ✅ | ✅ |
| Only a count settles an occurrence | ✅ | ✅ |
| `confirmationNotBefore` persisted, not held in memory | ✅ | ✅ |
| No confirm before the server's instant | ✅ | ✅ |
| Confirmation not gated on in-memory phase | ✅ | ✅ |
| Attempt id random, scoped, purged | ✅ | ✅ |
| No timer spans a dwell | ✅ | ✅ |
| Concurrent duplicate suppression | ✅ | ✅ |
| Sequential duplicate suppression | ✅ | ✅ |
| Per-occurrence, not per-region | ✅ | ✅ |
| Success only from a server verdict | ✅ | ✅ |
| `already_counted` is success | ✅ | ✅ |
| Queue bounded to 2 h, encrypted | ✅ Keychain | ✅ EncryptedSharedPreferences |
| Backoff bounded + jittered, terminal never retried | ✅ | ✅ |
| Canonical request field-for-field | ✅ | ✅ |
| No logging in any attendance file | ✅ | ✅ |

### Where they deliberately differ

| | iOS | Android | Why |
|---|---|---|---|
| Background grant | Second prompt | API 29 dialog / **API 30+ Settings** | Platform rule |
| Reboot | Regions persist | **Re-register on `BOOT_COMPLETED`** | Android clears them |
| Precision | Accuracy axis | Permission itself | Different models |
| Mock location | **None — always null** | `Location.isMock` submitted | No iOS equivalent exists |
| Enumerate regions | `monitoredRegions` | **Encrypted mirror** | No Play services API |
| Extra trigger | — | `BootOrUpdate` | Only Android needs it |
| OS dwell transition | **None exists** | **Used**, delay from authoritative configuration | Play services has one and iOS does not; staleness is solved by reconciliation, not abstention |
| Confirmation trigger | Region callback / foreground / BG refresh | The dwell transition | Best effort vs a real system callback |
| Authorization bridge | `SystemCoreLocationFacade.normalize`, semantic cases | `checkSelfPermission` | Different frameworks, both normalized before any decision |
| Adapter test seam | `CoreLocationFacade` | Robolectric | Different framework, same goal: reachable without a device |

## Prompt 7 completion gates

| # | Gate | Evidence | Result |
|---:|---|---|---|
| 1 | Visitor explicitly opts in | 4 taps; step machine | ✅ |
| 2 | Foreground and background both explained first | education screens are real states | ✅ |
| 3 | **No prompt at launch/discovery/login/feed** | executed on both platforms | ✅ |
| 4 | Only server-authorized regions registered | reconciler is the only caller | ✅ |
| 5 | OS event begins an evidence workflow | phase machine | ✅ |
| 6 | Server validates identity, consent, church, occurrence, window, accuracy, evidence, policy | **distance now banded server-side** | ✅ |
| 7 | Success reaches the fact and admin totals without double-counting | **executed vs Postgres** | ✅ |
| 8 | Revocation, switching, logout, blocking, expiry, permission change all fail closed | executed on both platforms | ✅ |
| 9 | iOS 20-region limit respected | asserted, deterministic selection | ✅ |
| 10 | Android 100-limit known; shared cap 20 | asserted | ✅ |
| 11 | Android 10 vs 11+ background flow separated | executed for SDK 26/28/29/30/34/35 | ✅ |
| 12 | Approximate-only handled as its own state | executed | ✅ |
| 13 | Play services unavailable handled | executed | ✅ |
| 14 | Reboot re-registration | executed | ✅ |
| 15 | Receiver not exported; PendingIntent mutable + explicit | asserted | ✅ |
| 16 | Only required permissions declared | **exact list** asserted | ✅ |
| 17 | No continuous location or foreground service | sweep, **proven to bite** | ✅ |
| 18 | Duplicate callbacks → one attempt | concurrent **and** sequential | ✅ |
| 19 | Idempotency stable across restart | executed, no persistence needed | ✅ |
| 20 | Retry reuses the key | executed both platforms + DB | ✅ |
| 21 | Terminal failures never retried | asserted | ✅ |
| 22 | Offline queue bounded, encrypted, purged | executed | ✅ |
| 23 | Never counts locally | every non-counted phase asserted not-success | ✅ |
| 24 | `already_counted` success without incrementing | **executed vs Postgres** | ✅ |
| 25 | No coordinates in logs, prefs, caches | sweep over attendance files | ✅ |
| 26 | No attestation / tracking identifier | sweep | ✅ |
| 27 | Mock location reported, never decisive | asserted; iOS sends null | ✅ |
| 28 | Native ↔ manual race → one fact | **executed** | ✅ |
| 29 | Native ↔ bulk race → one fact | **executed** | ✅ |
| 30 | Two connections, same native intent → one fact | **executed** | ✅ |
| 31 | Legacy tables untouched | **executed** — counted before and after | ✅ |
| 32 | Aggregate totals correct | **executed** — found and fixed a real bug | ✅ |
| 33 | Generated artifacts fresh, or CI fails | proven in the Prompt 6 pass | ✅ |
| 34 | Localization parity, no new inline literals | 136 keys | ✅ |
| 35 | Accessibility: merged semantics, decorative hidden, touch targets | asserted | ✅ |
| 36 | No QR, kiosk, livestream, sermon, payment | sweep | ✅ |
| 37 | **The idempotency key is per logical attempt, not per occurrence** | executed on both platforms and the server | ✅ |
| 38 | **An `outside_region` refusal does not poison the rest of the service** | **executed** — iOS, Android, and vs Postgres | ✅ |
| 39 | The server replays a refusal for a repeated key | **executed** — the reason the key had to change | ✅ |
| 40 | A new attempt id is revalidated and can count | **executed vs Postgres** | ✅ |
| 41 | `insufficient_accuracy` is recoverable the same way | **executed vs Postgres** | ✅ |
| 42 | Duplicate callbacks reuse one attempt and one key | executed, both platforms | ✅ |
| 43 | Ten concurrent opens produce one attempt | executed, at the store | ✅ |
| 44 | Restart and transient failure reuse the key | executed, both platforms | ✅ |
| 45 | A terminal refusal closes the attempt | executed, both platforms | ✅ |
| 46 | Counted / already-counted suppress further submissions | executed, both platforms | ✅ |
| 47 | Expired attempts purged and never sent | executed, both platforms | ✅ |
| 48 | Attempt ids are not tracking identifiers | 200 generated, all distinct, scoped and purged | ✅ |
| 49 | **`:app` has executable Android tests** | **36 via Robolectric** | ✅ |
| 50 | Merged manifest permission list exact | **executed on the real merged manifest** | ✅ |
| 51 | Receiver export state and `PendingIntent` flags | **executed on the real framework** | ✅ |
| 52 | API 28 / 29 / 30 / 34 behaviour | **executed on those actual API levels** | ✅ |
| 53 | Encrypted attempt store round-trip, expiry, partition isolation | **executed** | ✅ |
| 54 | **iOS Core Location boundary has an injectable seam** | `CoreLocationFacade`, 21 tests | ✅ |
| 55 | Adapter translation, capacity, revocation, callbacks | executed through the real adapter | ✅ |
| 56 | Adapters contain no policy | asserted — no consent/occurrence/idempotency vocabulary | ✅ |
| 57 | **Dwell limits documented and tested on both platforms** | no timer, no background assertion | ✅ |
| 58 | **A refusal count never permanently locks out an occurrence** | executed — iOS, Android, and vs Postgres | ✅ |
| 59 | Cooldown exponential and bounded; budget rolling | executed, both platforms | ✅ |
| 60 | Exit, improved accuracy and config change bypass the hold | executed, both platforms | ✅ |
| 61 | Only a count settles; twenty refusals leave it open | executed, both platforms | ✅ |
| 62 | A flapping boundary is held, not spammed and not rejected | executed, both platforms | ✅ |
| 63 | **`detected` can never create a fact** | **executed vs Postgres** | ✅ |
| 64 | The server supplies `confirmationNotBefore` from the snapshot | contract + service | ✅ |
| 65 | No confirm is sent before that instant | executed, both platforms | ✅ |
| 66 | Confirmation succeeds after it, with fresh evidence | executed, both platforms | ✅ |
| 67 | A restart preserves the pending attempt and confirms | executed, both platforms | ✅ |
| 68 | A missing confirmation never creates a fact | executed, both platforms | ✅ |
| 69 | Consent revoked before confirmation fails closed | executed, both platforms | ✅ |
| 70 | An older server without the field gets a safe fallback | executed, both platforms | ✅ |
| 71 | **Android uses the OS dwell transition, configuration-driven** | executed — never a literal delay | ✅ |
| 72 | The loitering delay is part of region identity, so a policy edit re-registers | executed | ✅ |
| 73 | **The full `GeofencingRequest` is asserted** | executed through the injected façade | ✅ |
| 74 | Every Play services task result handled — success, failure, cancellation | executed | ✅ |
| 75 | A failed registration is not mirrored, so it self-heals | executed | ✅ |
| 76 | The permission gate blocks registration | executed, both sides | ✅ |
| 77 | **iOS authorization uses semantic cases, not raw values** | `normalize`, `@unknown default` fails closed | ✅ |
| 78 | **Dwell is measured by the database clock alone** | **executed** — backdating and future-dating `observedAt` change nothing | ✅ |
| 79 | The client's `dwellSeconds` never reaches the command | asserted on the service | ✅ |
| 80 | Confirming one instant before the deadline fails | **executed vs Postgres** | ✅ |
| 81 | Confirming at or after it succeeds, with server-measured dwell | **executed vs Postgres** | ✅ |
| 82 | A repeated `detected` returns the same record and timestamps | **executed** — a retry cannot reset the clock | ✅ |
| 83 | Two connections opening one detection produce one record | **executed** | ✅ |
| 84 | A fabricated detection id is refused | **executed** | ✅ |
| 85 | Cross-account / member / occurrence / region / config replay refused | **executed**, each distinctly | ✅ |
| 86 | A detection is single-use and expires | **executed** | ✅ |
| 87 | Concurrent confirmations produce one fact | **executed** | ✅ |
| 88 | `detected` alone creates neither a fact nor an attempt | **executed** | ✅ |
| 89 | `observedAt` survives only as bounded diagnostics, with skew recorded | **executed** | ✅ |
| 90 | **No local throttle can hold beyond 10 minutes** | executed exhaustively, both platforms | ✅ |
| 91 | An empty bucket refills within one minute | executed, both platforms | ✅ |
| 92 | Neither an exhausted bucket nor any refusal count settles an occurrence | executed, both platforms | ✅ |
| 93 | Only counted / already-counted suppresses an occurrence | executed, both platforms | ✅ |
| 94 | Detections are server-role only | migration asserts the revoke | ✅ |
| 95 | **Simulator / emulator run** | — | ⛔ |
| 96 | **Physical device run** | — | ⛔ |
| 97 | **Play services honouring a registration** | — | ⛔ needs a real device |
| 98 | **Battery measured** | — | ⛔ |
| 99 | **Store review passed** | — | ⛔ |

## Two Prompt 6 tests were replaced, not weakened

Both fired correctly at the boundary they were built to mark.

**1. `no native region monitoring was introduced`** — Prompt 6 asserted region
monitoring appeared *nowhere*, because Prompts 7–8 owned the clients. Prompt 7
is that arrival. Replaced by three stronger tests: the framework APIs are
confined to exactly two named adapter files; those adapters contain **no
decisions** (no consent, occurrence, idempotency, or policy vocabulary); and
`ACCESS_BACKGROUND_LOCATION` appears in exactly two files and nowhere else.

**2. `the attempt request schema cannot carry an identity or a verdict`** —
was a substring sweep that matched the new doc comment explaining what a client
may not send. Replaced by a sweep over the **declared field keys**, which is
both stricter (it catches `distanceBand` and `memberID` alike) and immune to
prose.

## Defects found by executing rather than reading

| # | Defect | How found |
|---|---|---|
| 1 | `submitAttempt` passed `distance_band: 'inside'` unconditionally, making the command's `outside_region` branch unreachable and contradicting the architecture document | Tracing the contract before implementing |
| 2 | **`attendance_report` counted sources, not people** — `count(*)` over a subquery grouped by `(source, status)`. Invisible with one source; Prompt 7 adds the second | An executable test comparing the report against the facts |
| 3 | iOS single-flight guard raced across a suspension point — 8 concurrent callbacks all submitted | The duplicate-callback test |
| 4 | `needs_full_accuracy` mapped to `Unknown`, losing the reason the UI needed | The reduced-accuracy test |
| 5 | Neither platform suppressed **sequential** duplicates — every re-entry was a wake and a round trip | The Android duplicate test, then mirrored to iOS |
| 6 | `attendanceConsentRequestSchema` was generated into all three languages but **no route consumed it** — no way to grant or withdraw consent | Tracing the contract |
| 7 | **The idempotency key collapsed every visit at an occurrence into one namespace**, so an early `outside_region` was replayed for the rest of the service and the visitor could never be counted | Raised in review; then reproduced against Postgres before fixing |
| 8 | `flushPending`'s expiry branch was **unreachable** — the store purges an expired attempt on read, so the guard after the lookup never fired and expiry was silently never reported | The expiry test, after the store was rewritten |
| 9 | **The five-refusal cap was the original bug at a larger number** — five poor readings on arrival permanently prevented a legitimate visitor being counted | Raised in review; replaced with cooldown + rolling budget + bypass triggers |
| 10 | **The confirm path was unreachable in production** — nothing called `confirmDwell`, so `pending_confirmation` never became a count | Tracing the two-command lifecycle |
| 11 | **Confirmation was gated on in-memory phase**, which after a restart is idle — making a persisted attempt unconfirmable forever | The restart-preserves-confirmation test |
| 12 | `GoogleApiAvailability` **throws** when the version meta-data is absent rather than returning a code, so an exception escaped into a permission check | The Robolectric Play-services test |
| 13 | **Dwell was never enforced at all.** `p_dwell_seconds` came from the client, so `dwellSeconds: 9999` counted immediately — the whole two-phase mechanism was decorative | Raised in review; confirmed by reading the command, then closed with a server-stamped detection record |
| 14 | **`confirmationNotBefore` was derived from the client's `observedAt`**, so backdating it produced a deadline already in the past | Same review |
| 15 | **A 12-per-rolling-hour budget could hold a device for nearly an hour** — longer than the service, so it was the lockout again in a third disguise | Same review; replaced with a continuously refilling token bucket and an explicit `maxLocalHold` |

Each of 1, 2, 5 and 7 would have shipped silently. None was findable by reading.

Defect 7 is worth dwelling on: it made the feature fail *specifically* for
someone whose first fix was poor — arriving indoors, phone in a pocket, GPS
cold. That is the ordinary case, not an edge one. The design that produced it
looked cleaner than the fix does.

## Explicitly not claimed

- **No device readiness.** No geofence has fired on hardware.
- **No simulator or emulator run.** Neither was launched.
- **No battery figure.** Design choices only.
- **No store readiness.** The answers to give are recorded; none has been given.
- **No production or staging deployment.**
- **No spoof resistance.** Ordinary coordinates do not prove presence, and
  nothing here changes that. What *is* now true is that no client-supplied
  value — a timestamp, a duration, or a claimed dwell — can shorten the
  server's own measurement.
- **No guaranteed check-in.** Neither platform guarantees a dwell confirmation
  completes; when it does not, the attempt expires and the person is not
  counted. The UI never promises otherwise.
- **No proof Play services honours a registration.** Faithful's side of the call
  is fully covered through an injected façade; what the OS then does is not.
- **No RLS verification, no query plans, no legacy reconciliation** — unchanged
  from Prompt 6.
