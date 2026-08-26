# Prompt 4 — Native architecture

Two fully native applications sharing **specifications, contracts, fixtures and
tokens — never UI code**. No React Native, Flutter, KMP UI, or webview.

## Shared by construction, separate by implementation

| Shared | Not shared |
|---|---|
| `contracts/faithful/v1/schema.json` | Every line of UI |
| Golden fixtures (same bytes, all 3 languages) | Navigation implementation |
| `design/faithful/tokens.json` | Storage implementation |
| Component behaviour specs | Concurrency model |
| Error vocabulary and semantics | Back/gesture behaviour |

---

# iOS — SwiftUI

**Minimum iOS 17.** The oldest release with the Observation framework and the
`NavigationStack` APIs this architecture depends on. By the 2026 split it still
covers the overwhelming majority of devices; moving to 18 would buy little and
exclude working hardware a congregation plausibly still carries.

Swift 6, **strict concurrency complete**. The package builds clean under it.

## Structure

```
apps/faithful-ios/
  Package.swift                    # FaithfulKit + tests, buildable by `swift build`
  Sources/FaithfulKit/
    Generated/  Contract.swift, DesignTokens.swift   ← generated, do not edit
    Networking/ Envelope, APIClient, HTTPTransport
    Storage/    SecureStore (Keychain), CachePartition
    Session/    SessionStore, AppState, Logging
    Navigation/ Destination, RouteRegistry
    Theme/      Theme
    Components/ Primitives, AppShell
  Tests/FaithfulKitTests/          # 51 tests, 6 suites
  Config/                          # Info.plist, xcconfig, PrivacyInfo
```

Everything testable lives in `FaithfulKit`, so `swift test` runs the whole
suite on a plain macOS runner — **no Xcode project state, no simulator**.

## State and dependencies

`AppState` is `@Observable` and `@MainActor`, holding only session, bootstrap,
and the derived route snapshot. Feature state belongs to features. Dependencies
are constructed at a composition root and passed explicitly — no service
locator, no reflective injection.

`routeSnapshot` is **derived on every read**, never cached, so a relationship
that changed on the server cannot leave a stale permission in the navigation
layer.

## Networking

`APIClient` is an `actor`. `HTTPTransport` is the seam that lets every
networking test run without a network; `StubTransport` records requests so
header assertions are possible.

Every request carries `X-FaithForm-Client-Build`. Conditional requests send
`If-None-Match` and surface 304 as `notModified` with a nil value. A rejected
token calls `invalidate()` **exactly once**.

TLS is left entirely at defaults — no pinning, no custom trust evaluation, no
ATS exception. There is nothing present that could weaken it.

## Secure storage

`KeychainStore` with `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly` — tokens
stay off a backup restored to a different device. **Tokens never touch
`UserDefaults`, the response cache, or any file the backup system sweeps up.**

`InMemorySecureStore` is the test double, deliberately non-persistent so no test
can accidentally validate insecure storage.

## Session

`SessionManager` is an `actor` implementing `TokenProviding`.

- Expiry uses **60 s leeway** so a request does not race the clock.
- Refresh is **single-flight** — concurrent callers await the same task.
  Verified: 12 simultaneous callers → 1 refresh.
- A failed refresh **clears the session**; keeping a dead token would make every
  later call fail less obviously.
- A session whose `environmentKey` differs is **never adopted or used**.
- `purgeEverything()` clears every environment's material, not just the current
  one.

## Persistence and cache

`CachePartition` = `environment | account | church | authorizationVersion`. Any
change yields a different key, so revoked data is **unreadable, not merely
stale**. `purgeAccount` clears every church and version for an account;
`purgeAllPrivate` leaves only the anonymous partition.

Freshness is three-valued: fresh → stale (displayable, must be labelled) →
expired (not shown at all). Eviction is deterministic, oldest-first, so
behaviour under pressure is testable.

## Navigation and deep links

`Destination` declares the **full future IA** (home, discovery, church,
announcements, watch, sermons, give, account) so later prompts add a *screen*
rather than restructuring the root.

`RouteRegistry` applies four independent gates: a screen is registered, the
server reports the capability, the session permits it, and — for church
destinations — the account holds a usable relationship. **Prompt 4 registers
only `home` and `account`**; everything else resolves `.notImplemented` and is
never offered.

`DeepLinkParser` fails closed. Rejected: wrong scheme, empty, unknown root,
missing slug, uppercase slug, path traversal, unknown leaf, trailing junk.
A link is parsed **and authorized before any state changes**.

## Configuration

`Development.xcconfig` / `Production.xcconfig` carry an origin and a display
name — never a key, token, team, or certificate.
`FAITHFUL_ALLOW_DEBUG_CONTROLS` is `NO` in release, so debug affordances are
**compiled out rather than hidden**.

## Logging

`FaithfulLog` accepts only a `StaticString` event name, a request id, and a
typed error code. It is **structurally incapable of accepting a token, a person,
a message body, a coordinate, or a payment detail** — a logger you cannot hand a
secret cannot leak one.

---

# Android — Kotlin / Jetpack Compose

**minSdk 26, targetSdk 34, compileSdk 34, JDK 17.** 26 gives the full modern
Keystore surface and adaptive icons; below it the Keystore guarantees weaken and
the coverage gained is negligible.

## Structure

```
apps/faithful-android/
  gradle/libs.versions.toml        # one version catalog
  core/contract/   (JVM)  ← generated Contract.kt
  core/network/    (JVM)  Envelope, ApiClient, SingleFlightRefresher
  core/navigation/ (JVM)  Destination, DeepLinkParser, RouteRegistry
  core/storage/    (JVM)  CachePartition, PartitionedCache
  core/design/     (Android)  ← generated DesignTokens.kt, FaithfulTheme
  app/             (Android)  MainActivity, AppViewModel, Compose shell
```

**The four `core` modules are pure JVM on purpose.** Contract, client, routing
and cache policy are verifiable with `gradlew test` on any runner — no Android
SDK, no emulator — which is exactly what CI needs to check on every change.

## Dependency injection

`AppContainer` is the composition root, built once in `FaithfulApplication`.
Explicit construction, no framework. The environment is fixed at build time and
is part of both the credential storage key and every cache partition, so one
environment's token or cache can never be used against another.

## Networking

`ApiClient` mirrors the iOS client exactly — same headers, same conditional
requests, same idempotency, same error mapping — arrived at from the same
specification, not shared code.

`FaithfulJson` sets `ignoreUnknownKeys = true` **once**, so no call site can opt
out of forward compatibility.

`SingleFlightRefresher` uses a `Mutex` + `CompletableDeferred`: concurrent
callers await the same in-flight refresh.

## Secure storage

`EncryptedSharedPreferences` with an `AES256_GCM` `MasterKey` — hardware-backed
where the device offers it. `AndroidSessionStore` refuses a session from another
environment and exposes `purgeEverything()`.

`allowBackup=false` plus explicit `data_extraction_rules` exclude **everything**
from cloud backup and device transfer.

## Navigation and back

Single activity, `launchMode="singleTask"` with `onNewIntent` — the Android-native
way to receive a deep link into a running app. **This is deliberately not
modelled on the iOS lifecycle**, which handles the same situation differently.
System back and predictive-back are the platform's, not a reimplementation.

Only the `faithful://` custom scheme is declared. **App Links over https are
absent** because they need a verified Digital Asset Links file on a domain this
repository does not establish.

## Security posture

`usesCleartextTraffic="false"` plus a `network_security_config` that permits no
cleartext and trusts only system anchors. Release builds enable R8 with
ProGuard rules that keep kotlinx.serialization's generated serializers — without
them the contract fails to decode **only in release**, which is the worst
possible time to find out.

---

## Testing

| Suite | Count | Runs where |
|---|---:|---|
| TypeScript contract | 28 | any runner |
| Swift (`swift test`) | 51 | macOS |
| Kotlin JVM (`gradlew test`) | 28 | any runner with JDK 17 |
| Web (existing + new) | 187 | any runner |

All three languages decode **the same fixture files** — resolved by relative
path, not copied — so they cannot drift.

## Build and release prerequisites

**Verified locally:** Swift build + 51 tests; Gradle build of all six modules;
28 Kotlin tests; a signed-debug APK (11 MB).

**Not done, and not claimed:** no simulator or emulator run, no physical device,
no signing, no store submission, no hosted CI execution. See
`P4_EXTERNAL_SETUP_RUNBOOK.md` for what production still needs.
