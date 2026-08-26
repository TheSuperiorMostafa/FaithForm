# Prompt 12 — Final Verification Matrix

*Every gate, its command, its actual output — and, for everything that matters,
exactly how far it has been verified.*

Executed on the Prompt 12 working tree: macOS, Node 24, Swift 6, JDK 17,
PostgreSQL 17.9, Xcode with an iPhone 16 Pro simulator.

---

## 1. Gates

| Gate | Command | Result |
| --- | --- | --- |
| Lint | `pnpm lint` | **0 errors**, 50 warnings (pre-existing unused-variable warnings) |
| Types | `pnpm typecheck` | clean |
| Generated contract | `pnpm contract:check` | current across 3 artifacts |
| Design tokens | `pnpm design:check` | current; 22 contrast pairs pass WCAG minimums |
| Localization parity | `pnpm localization:check` | **247 shared keys**, 3 documented platform-only |
| Web tests | `pnpm test` | **690 passed, 0 failed, 0 skipped** |
| Database tests | `pnpm test:concurrency` | **174 passed, 0 failed, 0 skipped** (fresh DB, migrations 0055–0063) |
| Migration baseline | `pnpm test:migrations` | verified after 66 legacy migrations |
| **Full-chain rehearsal** | `pnpm pilot:rehearse` | **174 passed** on a fresh disposable database, every migration on disk applied in order, database dropped |
| Query plans | `pnpm pilot:plans` | **11 passed** — included in `test:concurrency` |
| Pilot readiness | `pnpm pilot:readiness` | runs; **Core BLOCKED** on this machine — no Supabase values are set here, which is the correct answer |
| Secret scan | `pnpm scan:secrets` | passed for 1,241 files |
| Production dependency audit | `pnpm audit:prod` | `unresolvedHighOrCritical: []` |
| Production web build | `pnpm build` | compiled successfully |
| iOS library build (host) | `pnpm ios:build` | build complete |
| iOS library tests | `pnpm ios:test` | **323 tests in 38 suites passed** |
| iOS library build (device) | `pnpm ios:build:device` | **clean** — now delegates to the app build, which compiles FaithfulKit for iOS as a dependency (§4.6) |
| **iOS app build (device, unsigned)** | `pnpm ios:app:build` | **clean: no errors, no warnings** |
| **iOS app tests** | `pnpm ios:app:test` | **16 tests in 3 suites passed** on a simulator |
| Android tests | `gradlew test` | **BUILD SUCCESSFUL** |
| Android app tests | `:app:testDebugUnitTest` | **91 executed** — not `NO-SOURCE` |
| Android debug APK | `gradlew :app:assembleDebug` | BUILD SUCCESSFUL — 31.3 MB |
| **Android staging APK** | `pnpm android:staging` | BUILD SUCCESSFUL — 22.5 MB, **unsigned** |
| **Android release APK** | `pnpm android:release` | BUILD SUCCESSFUL — 6.9 MB, **unsigned** |
| Whitespace | `git diff --check` | clean |

`assembleStaging` and `assembleRelease` need network: `lint-gradle` is not in the
offline cache. Both were run with it and both succeeded; `--offline` fails for
that reason and not because of anything in this repository.

### Test counts

| Suite | Before Prompt 12 | After | Added |
| --- | --- | --- | --- |
| Web | 690 | 690 | +0 (one test rewritten — §4) |
| Database | 163 | **174** | +11 (query plans) |
| iOS library | 323 | 323 | — |
| **iOS app** | — | **16** | +16 (new target) |
| Android `:app` | 76 | **91** | +15 |
| Android `:core:giving` | 32 | **33** | +1 |
| Android, other modules | 267 | 267 | — |
| **Total** | **1,551** | **1,594** | **+43** |

---

## 2. The build commands added

| Command | What it does |
| --- | --- |
| `pnpm ios:app:generate` | generates `Faithful.xcodeproj` from `project.yml` |
| `pnpm ios:app:build` | unsigned iOS app, device target, warnings as failures |
| `pnpm ios:app:test` | the above plus the app-target tests on a simulator |
| `pnpm android:staging` | the unsigned pilot APK |
| `pnpm android:release` | the unsigned release APK |
| `pnpm pilot:readiness` | which environment values are present, printing none of them |
| `pnpm pilot:rehearse` | full migration chain on a fresh disposable database, then the suite |
| `pnpm pilot:plans` | hot-path index coverage |
| `pnpm pilot:seed` | a non-production smoke church |

`ios:app:build`, `ios:app:test` and `android:staging` are wired into CI.

---

## 3. How far each thing is verified

| | **AUTO** | **SIM** | **DEVICE** | **STAGING** | **PROD** | **BLOCKED** |
| --- | --- | --- | --- | --- | --- | --- |
| iOS app compiles for device | ✅ | | | | | |
| iOS app runs | | | ❌ | | | no signing identity |
| iOS app tests | | ✅ 16 | | | | |
| Android debug/staging/release assemble | ✅ | | | | | |
| Android app installs | | | ❌ | | | never attempted |
| Fail-closed configuration | ✅ both | | | | | |
| Route gating, all four conditions | ✅ both | | | | | |
| Deep links fail closed | ✅ both | | | | | |
| Permissions match behaviour | ✅ both | | | | | |
| Migration chain from nothing | ✅ | | | ❌ | ❌ | |
| Hot-path index coverage | ✅ 11 | | | | | |
| Sign-in | | | | | | **no flow exists** |
| Attendance in the field | ✅ logic | | ❌ | | | |
| A real recording through the parser | | | | | | never met one |
| Any Stripe call | | | | | | no test key configured |
| Push delivery | | | | | | no APNs key, no FCM credentials |
| Store submission | | | | | | nothing submitted |

**Nothing in this repository has been verified on a physical device, on staging,
or in production.** No external system was contacted, and none was changed.

---

## 4. Defects found by executing

### 1. Three finished features were switched off

`ENABLED_CAPABILITIES` listed `account`, `discovery`, `announcements`, `watch`.
It did not list `attendance` — built and tested across Prompts 7 and 8 — or
`giving`, built across Prompt 11. Both route registries gate on that list, so
both features were correctly invisible: **the gate working on the wrong input**,
which is the least visible way for a feature to be missing.

Found by tracing the capability key from `Destination` to the server before
touching structure.

The stale guard that enforced it — `the native attendance capability is not
enabled yet`, written in Prompt 6 — has been **inverted and made stricter**: a
capability may not be on without a screen on *both* platforms, and a capability
with screens on both platforms may not be left off. That is the assertion that
would have caught this in the first place.

### 2. The Android release build had a hardcoded production origin

`release` carried `buildConfigField("String", "API_ORIGIN",
"\"https://faithform.io\"")`. A release build that points somewhere by default is
a release build nobody has to think about pointing, and the one time that matters
is the time it is wrong. Now empty, supplied by a Gradle property, and
fail-closed without one — matching iOS, where staging and release ship with the
origin empty by design.

### 3. Two query-plan assertions were wrong about their own indexes

The first version of `query-plans.test.ts` asserted "no sequential scan" and
failed on three correct queries — because the planner scans a small table
whatever the indexes say, so the assertion measured the fixture size.

Rewritten to ask the question that matters — *with sequential scans off, can an
index answer this at all* — it then caught two real mistakes in its own queries:
one used `occurrence_id` where the index is on `service_occurrence_id`, and one
omitted two of the three conditions a **partial** index is built on. That second
one is a live class of bug: a partial index that no production query can reach
looks exactly like an index that works.

The uniqueness guards were split out entirely: on an empty table two indexes
serve those lookups equally, so which one the planner picks is a fact about the
fixture. Uniqueness is asserted against `pg_indexes` instead.

### 4. The app test directory was swept as production source

`AppTests/` does not match `/(test|Tests|androidTest|src\/test)/`, so four
forbidden-symbol sweeps read the new app tests — which assert the *absence* of
photo-library and microphone keys — as declarations of them. The same shape of
mistake the Prompt 9 sweeps made twice: a sweep failing on prose written to
reassure a reader.

### 5. `SET LOCAL` outside a transaction does nothing

`set local enable_seqscan = off` emits a warning and has no effect outside a
transaction block, so the first working version of the plan checks was disabling
nothing and asserting against ordinary plans. Session-level `SET` fixed it; each
test has its own connection, so it cannot leak.

### 6. The project disabled signing, so Xcode could not sign it either

`project.yml` set `CODE_SIGNING_ALLOWED = NO` in the base settings so the CI
build would work on a machine with no Apple account. It worked — and made a
device install impossible: every run from Xcode failed with *"The executable is
not codesigned"*, with no fix short of editing the project.

Found by someone trying to run it on a phone, which is the only way it could
have been found: every automated gate builds unsigned on purpose.

The script already passed the same flags on the command line, so the
project-level settings were redundant for CI and load-bearing only for the
breakage. Removed. A second, quieter version of the same problem went with it:
`aps-environment` was attached to every configuration, and a **free personal
Apple team cannot provision it** — so even after enabling signing, a Debug device
build would have failed with an error naming provisioning rather than the
capability. Entitlements now apply to Staging and Release only.

A third and fourth fell out while verifying the fix. `pnpm ios:build:device`
compiled the package with `xcodebuild -scheme Faithful`, and with signing enabled
that command now resolves to the *project* — which shadows the package in the
same directory — and failed asking for a development team. It delegates to the
app build instead; the app depends on FaithfulKit, so the check it exists for is
still performed.

And: with signing enabled, the app-packaging
pipeline prints `warning: Metadata extraction skipped. No AppIntents.framework
dependency found` — true, harmless, and enough to fail a gate that grepped for
`warning:`. The filter now matches only compiler diagnostics
(`path:line:col: warning:`) from this repository's own sources.

### 7. The Xcode user-script sandbox denied a script its own file

The asset-placeholder check failed with a sandbox denial reading
`check-assets.sh` — because a build phase script must **declare its inputs** to be
allowed to read them. It reads as a permissions error and is a missing
declaration.

---

## 5. What Prompt 12 deliberately did not do

* **No new visitor capability.** Everything now reachable was already built.
* **No sermon feature.** Prompt 10 was never built; the destination stays
  unregistered on both platforms and the capability stays off. Inventing one
  would be worse than the gap.
* **No sign-in flow.** It does not exist on either platform, it predates this
  prompt, and it is the single blocker to a pilot. Building an untested auth flow
  in the last prompt would be worse than naming it precisely.
* No dashboard business rule changed.
* No deployment, no migration applied to any hosted database, no Stripe call, no
  store submission, no provider state changed, no credential created or rotated.
* No analytics SDK, crash reporter, session replay, ad SDK or tracking
  identifier — none was approved, and the scope sweeps assert their absence.
