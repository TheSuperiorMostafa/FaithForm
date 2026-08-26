# Prompt 12 — The iOS App Target, and How to Sign It

*What now exists, how to build it without an Apple account, and the exact manual
steps to put it on a phone.*

---

## 1. What exists

`apps/faithful-ios` was a SwiftPM library. It now also has an application.

```
apps/faithful-ios/
  project.yml                     ← the app target, as a readable spec
  App/
    FaithfulApp.swift             @main
    AppEnvironment.swift          debug / staging / release, fail-closed
    AppDependencies.swift         the object graph
    RootView.swift                the visitor journey
    RootModel.swift               which tabs exist right now
    HostViews.swift               home, church switching, account
    SupabaseSessionRefresher.swift
    Configuration/
      Base.xcconfig               bundle id placeholder, version
      Debug.xcconfig              localhost
      Staging.xcconfig            origin deliberately empty
      Release.xcconfig            origin deliberately empty
    Resources/
      Info.plist                  two usage descriptions, no background modes
      Faithful.entitlements       push only
      Assets.xcassets             AppIcon + AccentColor placeholders
    Scripts/check-assets.sh       fails Release when the icon is a placeholder
  AppTests/AppHostTests.swift     16 tests
```

### Why the project is generated

The `.xcodeproj` is **not committed**. `project.yml` is, and
`pnpm ios:app:generate` produces the project from it.

A `.pbxproj` is two thousand lines of machine-ordered UUIDs. Nobody can diff one,
and merge conflicts in one get resolved by guessing. A spec file can be read in a
minute and reviewed like code.

The cost is one command before opening Xcode. `pnpm ios:app:build` runs it for
you, so the only person who has to remember is someone opening the IDE directly.

```bash
brew install xcodegen     # once
pnpm ios:app:generate     # then open apps/faithful-ios/Faithful.xcodeproj
```

---

## 2. Building it, with no Apple account

```bash
pnpm ios:app:build   # unsigned, device target, warnings are failures
pnpm ios:app:test    # + the app-target tests on a simulator
```

Both are deterministic and need no Apple ID, no Team ID and no provisioning
profile: the *script* passes `CODE_SIGNING_ALLOWED=NO` on the command line. What
it produces is a `Faithful.app` that cannot be installed, which is the correct
output for a machine with no signing identity.

**Signing is not disabled in the project.** It was, briefly, and the cost was
that Xcode could not sign it either — every device run failed with *"The
executable is not codesigned"* and no way out short of editing the project.
Turning it off for the one build that needs it off, rather than everywhere, is
what lets the same project serve CI and a phone.

**Warnings are failures**, filtered to this repository's own sources. A warning
inside a package dependency is not something this build can fix; failing on one
would make the gate unusable the first time Stripe's SDK updates.

### Three iOS gates, and what each covers

| Command | Compiles | Runs |
| --- | --- | --- |
| `pnpm ios:build` | the library, for **macOS** | — |
| `pnpm ios:test` | the library, for macOS | 323 library tests |
| `pnpm ios:build:device` | the library, **for iOS** | — |
| `pnpm ios:app:build` | the **app**, for iOS | — |
| `pnpm ios:app:test` | the app, for a simulator | 16 app tests |

The third exists because `swift build` compiles for the host: every
`#if os(iOS)` block — the camera scanner, the player adapter, the Stripe sheet —
is invisible to it. That gap hid a real Swift 6 concurrency break behind sixteen
green gates once already.

Since the app target arrived, the third and fourth are the **same build**.
`build-ios-device.sh` used to compile the package directly with
`xcodebuild -scheme Faithful`; a `Faithful.xcodeproj` now sits beside the package
and that command resolves to the project instead, asking for a development team.
It delegates to `build-ios-app.sh` rather than fighting the ambiguity — the app
depends on FaithfulKit, so FaithfulKit is compiled for iOS either way, under the
same warnings-as-errors rule. Both names are kept because CI refers to them and
because the two things they *mean* are worth stating separately.

---

## 3. Configuration

| | Debug | Staging | Release |
| --- | --- | --- | --- |
| Bundle id | `…faithful.debug` | `…faithful.staging` | `…faithful` |
| Origin | `http://localhost:3000` | **empty** | **empty** |
| Environment key | `development` | `staging` | `production` |
| Debug controls | on | off | off |

Staging and Release ship with the origin empty, and a build with no origin
**fails closed**: `AppEnvironmentLoader` returns `.unconfigured`, the app shows a
state that says so, and no network call is attempted.

That is the inverse of the usual default, deliberately. A fallback to production
is why staging builds end up writing to real churches. A build that refuses to
start is a bad afternoon; a staging build silently talking to production is a bad
year.

Supply origins at build time:

```bash
xcodebuild ... FAITHFUL_API_ORIGIN=https://staging.example.test
```

Cleartext is refused outside `development`, and a client build number that cannot
be read is refused rather than defaulted — the server rejects builds it no longer
supports, and guessing one would make an unsupported build look supported.

### What may be in the bundle

An origin, an environment key, a client build number, and the two **public**
Supabase values. Nothing else. An app bundle is readable by anyone who installs
it; `pnpm scan:secrets` and an app test both assert no `sk_`, `whsec_` or
`service_role` value is present.

---

## 4. The bundle identifier

`io.faithform.placeholder.faithful`, and deliberately obvious. It is meant to be
overridden:

```
FAITHFUL_BUNDLE_ID_PREFIX = com.yourorg
```

in `Base.xcconfig` or your own local xcconfig. A build that reached a store with
the placeholder would be rejected, which is the intended outcome — nobody's real
reverse-DNS name is in this repository, and no Team ID is either.

---

## 5. Permissions, and what is absent

Two usage descriptions, each naming a feature that exists:

* **Location** — automatic attendance (Prompt 7). Region monitoring only; a sweep
  asserts `startUpdatingLocation` and `allowsBackgroundLocationUpdates` appear
  nowhere in the app.
* **Camera** — QR check-in (Prompt 8). Asked only after an explicit tap on "Scan
  the code".

Absent, and asserted absent by an app test: photo library, microphone, contacts,
calendars, tracking, Face ID, motion, Bluetooth — and **`UIBackgroundModes`**,
because region monitoring wakes the app without one and declaring `location`
would enable the continuous updates this app deliberately does not do.

### Entitlements

**Present:** `aps-environment` — push notifications, Prompt 5. `development`
here; Xcode rewrites it to `production` for a distribution build.

**Absent, on purpose:**

* **Apple Pay** (`com.apple.developer.in-app-payments`). Giving implements the
  path and it is switched off: no merchant identifier exists, and
  `applePayAvailable` returns false without one. Declaring the entitlement
  without a registered merchant ID makes *signing* fail, with an error that reads
  as a provisioning problem rather than a missing setup step. It is one line when
  the merchant ID exists.
* **Associated domains.** App Links need a verified
  `apple-app-site-association` on a domain this repository does not establish.
  The `faithful://` scheme works today; https links do not, and declaring the
  entitlement would not change that.

A capability is added when a feature needs it, not because it might be useful.

---

## 6. Signing, exactly

**No Apple credential, private key, provisioning profile or Team ID is in this
repository, and none was requested.** These are the steps for the person who has
an Apple Developer account.

### To run on your own iPhone (a free account is enough)

The quickest route is a local config file, so nothing personal is ever staged:

```bash
cd apps/faithful-ios/App/Configuration
cp Local.xcconfig.example Local.xcconfig
# edit it: DEVELOPMENT_TEAM and FAITHFUL_BUNDLE_ID_PREFIX
cd - && pnpm ios:app:generate
```

`Local.xcconfig` is **gitignored**, and `Base.xcconfig` includes it with
`#include?` — the optional form, so its absence is not an error. Your Team ID is
not a secret, and it is still not something to put in a shared repository.

Find it in Xcode: **Settings → Accounts → your account → Manage Certificates**,
or at developer.apple.com under Membership.

Then:

1. Open `apps/faithful-ios/Faithful.xcodeproj`.
2. **Faithful** target → **Signing & Capabilities**. It should already show your
   team, with **Automatically manage signing** ticked. If not, set them here —
   the project bakes in neither.
3. Point the build somewhere the phone can reach. `localhost` in
   `Debug.xcconfig` is the **phone's own** loopback, not your laptop: use the
   laptop's LAN address (`http://192.168.x.x:3000`) or a staging URL.
4. Connect the iPhone, choose it as the destination, press Run.
5. On the phone: **Settings → General → VPN & Device Management** → trust your
   developer certificate. A free-account build stops working after seven days.

**Debug carries no entitlements**, deliberately. A free personal team cannot
provision `aps-environment`, and requiring it would fail automatic signing in
exactly the configuration somebody uses to run the app on their own phone — with
an error naming provisioning rather than the capability, which reads as a broken
project. Push is not testable on a personal team or a simulator anyway.

Staging and Release do carry it, and need a paid account.

### Before TestFlight

10. A paid Apple Developer Program membership.
11. Register the App ID with the **Push Notifications** capability.
12. An APNs key or certificate, uploaded wherever push is sent from.
13. A real 1024×1024 app icon. `check-assets.sh` fails a Release build without
    one — a missing icon is only a *warning* in Xcode, which means it otherwise
    survives to App Store Connect rejecting the upload.
14. Privacy nutrition labels — see `P12_STORE_AND_PROVIDER_SETUP.md`.

---

## 7. What has not been done

* **No app has been installed on any device.** The build is unsigned by design.
* No Apple account was used, and none was asked for.
* No TestFlight build, no submission, no review.
* **No sign-in flow exists**, on either platform. `SessionManager` handles the
  token lifecycle and `SupabaseSessionRefresher` can refresh a session that
  already exists — nothing creates one. This predates Prompt 12 and is the single
  blocker to a pilot. See `P12_DEVICE_PILOT_RUNBOOK.md` §1.
