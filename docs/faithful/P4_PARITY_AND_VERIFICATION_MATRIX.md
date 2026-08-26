# Prompt 4 — Parity and verification matrix

**Four statuses are kept separate and must not be conflated.**

| Layer | Status |
| --- | --- |
| **A — Source completion** | ✅ Complete |
| **B — Local build and test** | ✅ Complete — Swift, Kotlin and TypeScript all built and tested on this machine |
| **C — Hosted CI** | ⛔ Pending — workflow written, never executed on a hosted runner |
| **D — Device / store / production** | ⛔ Pending — no simulator, emulator, device, signing, or store action |

A ✅ in A/B means a test ran and passed **on this machine**. It does not mean a
hosted runner, a simulator, a phone, or an App Store has seen any of it.

## Gate results

| Gate | Command | Result |
|---|---|---|
| Web lint | `pnpm lint` | ✅ 0 errors (46 warnings, 44 pre-existing) |
| Web typecheck | `pnpm typecheck` | ✅ |
| Generated freshness | `pnpm verify:generated` | ✅ contract + tokens current |
| Contrast audit | (in `design:check`) | ✅ 22 pairs pass WCAG |
| Web + contract tests | `pnpm test` | ✅ **187/187** (was 159) |
| Migration baseline | `pnpm test:migrations` | ✅ |
| Secret scan | `pnpm scan:secrets` | ✅ 934 files, incl. native config |
| Dependency audit | `pnpm audit:prod` | ✅ 0 unresolved high/critical |
| Production web build | `pnpm build` | ✅ all 9 mobile routes emitted |
| iOS build | `pnpm ios:build` | ✅ Swift 6, strict concurrency complete |
| iOS tests | `pnpm ios:test` | ✅ **51/51**, 6 suites |
| Android build | `pnpm android:build` | ✅ debug APK, 11 MB |
| Android tests | `pnpm android:test` | ✅ **28/28**, 3 modules |
| Whitespace | `git diff --check` | ✅ |

**Total: 266 automated tests** (187 web/TS + 51 Swift + 28 Kotlin).

## Contract parity

The decisive property: **all three languages decode the same 24 fixture files**,
resolved by relative path rather than copied, so they cannot drift.

| Requirement | TypeScript | iOS | Android |
|---|---|---|---|
| Golden fixtures decode | ✅ | ✅ | ✅ |
| Unknown additive fields tolerated (3 depths) | ✅ | ✅ | ✅ |
| Unknown enum → forward-compatible | n/a (strict server) | ✅ `.unknown(_)` | ✅ `UNKNOWN` |
| Typed errors map equivalently | ✅ 12 codes | ✅ 12 codes | ✅ 12 codes |
| Cursor opaque, kind-scoped, replay-refused | ✅ | — | — |
| ETag exact / weak / list / wildcard | ✅ | ✅ (client) | ✅ (client) |
| Idempotency key required + validated | ✅ | ✅ | ✅ |
| Malformed / oversized input rejected | ✅ | ✅ | ✅ |
| Sensitive fields absent (key-walk) | ✅ | ✅ | ✅ |
| Deprecation metadata readable | ✅ | ✅ | ✅ |
| Pagination terminates | ✅ | ✅ | ✅ |

## Authentication and session

| Requirement | Verified | Where |
|---|---|---|
| Single-flight refresh | ✅ 12 concurrent callers → 1 refresh | `SessionTests`; `SingleFlightRefresher` |
| Expiry leeway (60 s) | ✅ | `SessionTests` |
| Failed refresh clears session | ✅ | `SessionTests` |
| Cross-environment session refused | ✅ | `SessionTests`, `AndroidSessionStore` |
| Sign-out purges all credentials | ✅ | `SessionTests` |
| Rejected token invalidated once | ✅ | `APIClientTests` |
| Tokens in Keychain / Keystore only | ✅ | `KeychainStore`, `EncryptedSharedPreferences` |
| No selected church (first run) | ✅ | fixture + 3 languages |
| Multi-church bootstrap | ✅ | fixture + 3 languages |
| Blocked relationship cannot read | ✅ | fixture + 3 languages |
| Deletion-requested state | ✅ | fixture |
| Account-removal purge | ✅ | `signOut` / `requestDeletion` |

**Not verified:** live sign-in, real magic-link round trip, expired/replayed
link against a live Supabase project. All require a deployed environment.

## Navigation, deep links, cache

| Requirement | iOS | Android |
|---|---|---|
| Valid links → typed destinations | ✅ 7 forms | ✅ 7 forms |
| Unknown / malformed / hostile fail closed | ✅ 9 cases | ✅ 9 cases |
| Unimplemented destination never offered | ✅ 5 destinations | ✅ 5 destinations |
| Signed-out refused | ✅ | ✅ |
| Missing capability refused | ✅ | ✅ |
| Wrong-church link refused | ✅ | ✅ |
| Blocked church refused | ✅ | ✅ |
| Authorized before mutation | ✅ | ✅ |
| Partition isolation (env/account/church/version) | ✅ | ✅ |
| Public vs private never share a partition | ✅ | ✅ |
| Revoke one church, others intact | ✅ | ✅ |
| Sign-out purges account partitions | ✅ | ✅ |
| Switch account leaves nothing private | ✅ | ✅ |
| Fresh / stale / expired | ✅ | ✅ |
| Deterministic eviction | ✅ | ✅ |

## Design parity

| Requirement | Result |
|---|---|
| Native constants generated from canonical tokens | ✅ both platforms |
| CI fails on token drift | ✅ `design:check` in `ci:verify` |
| Contrast verified, both themes | ✅ 22 pairs; **caught a real 2.46:1 defect** |
| Light / dark resolve distinct palettes | ✅ |
| Increased contrast: borders ×1.5, muted promoted, shadows dropped | ✅ |
| Reduced motion shortens without removing | ✅ |
| Touch targets ≥ 44 / 48 | ✅ |
| Body type ≥ 16 pt with larger line height | ✅ |
| Component states specified | ✅ 25 primitives |
| Platform differences documented as intentional | ✅ 6 documented |

**Not verified:** rendered golden images. Capture needs a simulator and an
emulator — the policy is written and the assertions exist, but no baseline has
been rendered. This is the largest single item in Layer D.

## Accessibility

| Requirement | iOS | Android | Verified how |
|---|---|---|---|
| Dynamic Type / fontScale | ✅ specified | ✅ specified | token scaling rules |
| VoiceOver / TalkBack semantics | ✅ combined rows, labelled controls | ✅ `mergeDescendants`, `contentDescription` | source |
| Reduced motion | ✅ | ✅ | unit test |
| Increased contrast | ✅ | ✅ | unit test |
| Light / dark / system | ✅ | ✅ | unit test |
| Localization foundation | ⚠️ strings inline | ✅ `strings.xml` | source |

**iOS gap, stated plainly:** user-facing strings in the SwiftUI shell are inline
literals rather than `String(localized:)` catalog entries. Android is fully
resourced. This is a real parity gap and the first thing Prompt 5 should close.

**Not verified:** actual VoiceOver and TalkBack traversal. Needs a device.

## Scope — what was deliberately not built

Verified by inspection and by the route registry refusing them:

announcements/event feeds · push delivery · attendance check-ins · geofencing ·
QR/kiosk · livestream playback or history · sermon archives · donations or
Stripe mobile flows · full discovery/join screens · any fake church, sermon,
announcement, attendance, or donation data · any new domain authority or
parallel database.

`ENABLED_CAPABILITIES` is `["account"]`. The registry implements `home` and
`account` only; the other five destinations resolve `.notImplemented` — asserted
in both native suites.

## Layer C — hosted CI ⛔

`.github/workflows/ci.yml` has two jobs: `web` (ubuntu) and
`contract-and-native` (macos-15, 13 steps). **Never executed on a hosted
runner.** Unknown until it runs: macOS runner image availability, Android SDK
provisioning time, Gradle cache behaviour, total wall-clock.

## Layer D — device, store, production ⛔

| Item | Status |
|---|---|
| iOS Simulator run | Not performed |
| Android emulator run | Not performed |
| Physical device | Not performed |
| Golden image baselines | Not rendered |
| VoiceOver / TalkBack traversal | Not performed |
| Live API round trip | Not performed |
| Code signing | Not configured |
| Store submission | Not performed |

See `P4_EXTERNAL_SETUP_RUNBOOK.md` for the ten outstanding external items.

## Explicitly not claimed

- **No App Store or Play readiness.** No signing, no identifiers, no store record.
- **No deployed API compatibility.** The contract is verified against fixtures,
  not against a running server.
- **No device-verified accessibility.** Semantics are in source and unit-tested;
  no assistive technology has traversed either app.
- **No rendered visual parity.** Tokens match by construction; no image compared.
- **No performance claim.** Nothing profiled.
