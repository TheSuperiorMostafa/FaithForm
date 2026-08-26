# Prompt 4 — External setup runbook

Everything Faithful needs that this repository cannot establish for itself.

**No credential, key, certificate, or private value belongs in this file or in
any committed source.** Each item below names *what* is required and *where it
is configured* — never the value.

## Why these are open

The repository can define a bundle identifier; it cannot own one. It can declare
an associated domain; it cannot publish a file at that domain's root. Inventing
these would produce configuration that looks complete and fails at submission,
so each is left explicitly outstanding.

## 1. Identifiers

| Item | Current (development) | Required for production | Owner |
|---|---|---|---|
| iOS bundle id | `io.faithform.faithful.dev` | Real id, registered in the Apple Developer account | Apple account holder |
| Android application id | `io.faithform.faithful.dev` (`.debug` suffix on debug) | Real id — **immutable after first Play upload** | Play account holder |
| iOS Team ID | unset | Required for signing and Universal Links | Apple account holder |

Configured in `apps/faithful-ios/Config/Production.xcconfig` and
`apps/faithful-android/app/build.gradle.kts`.

## 2. Signing

| Item | Status | Notes |
|---|---|---|
| iOS distribution certificate + provisioning profile | Not created | Prefer Xcode Cloud or fastlane match; never commit a `.p12` |
| Android upload keystore | Not created | Enrol in Play App Signing; the upload key is the only one you hold |
| CI signing | Not configured | Secrets injected from the CI secret store at build time only |

`app/build.gradle.kts` deliberately declares **no `signingConfig`** for release,
so a key can never be read from a committed file.

## 3. Deep links

Working today: the `faithful://` custom scheme, on both platforms, parsed and
authorized before any state change.

Not configured, because both need a domain and an identifier that do not exist
yet:

| Item | Required |
|---|---|
| iOS Universal Links | `apple-app-site-association` at `https://<domain>/.well-known/`, plus the `associated-domains` entitlement |
| Android App Links | `assetlinks.json` at `https://<domain>/.well-known/`, plus an `android:autoVerify` intent filter and the release signing SHA-256 |

Until then the `associated-domains` entitlement and the `autoVerify` filter are
**absent rather than declared-and-broken**.

## 4. Supabase

| Item | Required |
|---|---|
| Redirect URLs | `faithful://auth/callback` added to the Supabase Auth allow-list, per environment |
| Publishable key per environment | Supplied to the app as build configuration — **never the service-role key** |
| Email template | Magic-link template pointing at the app scheme |

## 5. API origins

| Environment | iOS | Android |
|---|---|---|
| development | `https://localhost:3000` | `http://10.0.2.2:3000` (emulator loopback; the one documented cleartext case, debug only) |
| staging | **not yet assigned** | **not yet assigned** |
| production | `https://faithform.io` | `https://faithform.io` |

A staging origin must be assigned before staging validation.

## 6. Store accounts

| Item | Status |
|---|---|
| Apple Developer Program membership | Required, not verified here |
| App Store Connect record | Not created |
| Google Play Console account | Required, not verified here |
| Play listing | Not created |

## 7. Analytics and crash reporting

**No provider is integrated, and that is a deliberate open decision.**

Adding one means sending congregation-adjacent data to a third party, which
needs the same privacy review as any other processor. Whatever is chosen must
honour the existing logging rule: no tokens, no personal data, no message
content, no precise location, no payment data, no full API bodies.

Until a provider is chosen, `FaithfulLog` and Android logging emit only event
names, request ids, and typed error codes.

## 8. Privacy declarations

`apps/faithful-ios/Config/PrivacyInfo.xcprivacy` exists and is **accurate for
Prompt 4 only**: no tracking, no location, no contacts, no payment data.

**This must be updated in the same change that adds any of them.** Prompts 6
(location), 5 (push), and 11 (payments) each require an update to this manifest
and to the Play Data Safety form before submission.

The Play Data Safety declaration has not been drafted.

## 9. Assets

| Item | Status |
|---|---|
| App icon | Placeholder brand-gold mark in `ic_launcher_foreground.xml` |
| iOS app icon set | Not created |
| Fraunces + Inter font licences | **Not verified** — both are open-licensed, but the licence must be confirmed and bundled before release |
| Store screenshots | Not created |

## 10. Ordering

1. Register identifiers (1) — everything else depends on them.
2. Set up signing (2).
3. Assign the staging origin (5) and configure Supabase redirects (4).
4. Publish the well-known files and enable deep links (3).
5. Decide the analytics provider (7).
6. Produce assets and confirm font licences (9).
7. Complete privacy declarations (8).
8. Create store records (6).

## Explicitly not claimed

Nothing here has been performed. No account was accessed, no identifier
registered, no key generated, no domain configured, and no store record created.
Prompt 4 is **source-complete only** — see `P4_PARITY_AND_VERIFICATION_MATRIX.md`
for the separation between source, hosted CI, device, and production status.
