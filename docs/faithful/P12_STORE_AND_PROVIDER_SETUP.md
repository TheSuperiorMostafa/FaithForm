# Prompt 12 — Store and Provider Setup

*Every external account, key, and form. **None of it has been done**, nothing has
been submitted, and no provider state was changed.*

---

## 1. Apple

### App ID and capabilities

| Step | Detail |
| --- | --- |
| Membership | Apple Developer Program, paid. A free personal team is enough to run on your own phone and not for TestFlight |
| Bundle identifier | replace `io.faithform.placeholder.faithful`. Set `FAITHFUL_BUNDLE_ID_PREFIX` |
| Capabilities to enable | **Push Notifications** only |
| Capabilities to leave off | Apple Pay (no merchant ID yet), Associated Domains (no verified domain), everything else |

### APNs

1. Create an APNs **key** (`.p8`) rather than a certificate — one key covers every
   app and does not expire annually.
2. Note the Key ID and Team ID.
3. Configure them wherever push is sent from. **The key file never enters this
   repository**, and `pnpm scan:secrets` would fail if it did.
4. `aps-environment` is `development` in the committed entitlements; Xcode
   rewrites it to `production` for a distribution build.

### Apple Pay, when giving goes live

1. Create a Merchant ID: `merchant.<your prefix>.faithful`.
2. Register it with Stripe so Stripe can decrypt the payment token.
3. Add `com.apple.developer.in-app-payments` to `Faithful.entitlements`.
4. Pass the merchant identifier to `GivingModel(applePayMerchantID:)`.

Until step 4, `applePayAvailable` returns false and the sheet shows cards only.

### Privacy nutrition labels

Answer these from what the app actually does, not from a template:

| Question | Answer | Why |
| --- | --- | --- |
| Data used to track you | **None** | there is no tracking SDK, no advertising identifier, and no `NSUserTrackingUsageDescription` |
| Data linked to you | Contact info (email, via the church), Financial info (donations), Location (coarse — presence at a church), Identifiers (account id) | all of it linked, because it is a church's record of a person |
| Data not linked to you | none | |
| Third-party analytics | **none** | no analytics SDK exists |
| Crash reporting | **none** | none was approved, so none was added |

The honest headline is that Faithful collects a small amount and links all of it,
which is what a church membership record is.

### App Review

Two things reviewers will ask about:

* **Donations.** Apple permits a registered non-profit to take donations through
  an external processor rather than in-app purchase — and may ask for
  documentation of the non-profit relationship. Have it ready.
* **Background location.** The review notes must say plainly: region monitoring
  only, to check someone in when they arrive at their own church, with an
  education screen before the prompt and no continuous tracking.

### TestFlight

Before the first build: a real 1024×1024 icon (`check-assets.sh` fails a Release
build without one), an export compliance answer (`ITSAppUsesNonExemptEncryption`
is already `false`), and a test account — which needs sign-in to exist first.

---

## 2. Google

| Step | Detail |
| --- | --- |
| Package name | replace `io.faithform.faithful.dev` |
| Keystore | generate one, back it up somewhere it cannot be lost. A lost upload key can be reset; a lost app-signing key without Play App Signing cannot |
| Play App Signing | enrol. It is the difference between a recoverable mistake and an unrecoverable one |
| Signing in CI | from the environment at build time. No key, password or alias enters this repository — `release` declares no `signingConfig` for exactly that reason |
| Mapping file | upload it for every release, or every crash report is unreadable |

### Data Safety

Mirrors the Apple answers: contact info, financial info, approximate location,
identifiers — all collected, all linked, none shared with third parties, none
used for tracking or advertising. Data is deletable in-app (the account deletion
request already exists) and encrypted in transit.

### App Links

Not configured, deliberately. To enable:

1. Serve `/.well-known/assetlinks.json` from the domain, with the app's signing
   certificate fingerprint.
2. Add an `https` intent filter with `android:autoVerify="true"`.
3. Verify with `adb shell pm verify-app-links`.

A test currently asserts neither exists, because a declared-but-unverified App
Link is a domain claim the app cannot prove.

### FCM

`FCM_PROJECT_ID`, `FCM_CLIENT_EMAIL`, `FCM_PRIVATE_KEY` — the service account,
server-side only. `pnpm pilot:readiness` reports whether they are present without
printing them.

---

## 3. Stripe: test to live

Nothing below has been done. No Stripe API call has been made from this work.

1. **Test mode first.** `sk_test_…`, `pk_test_…`, and a webhook endpoint with its
   own `whsec_…`.
2. Connect a **test-mode** connected account for a church nobody real belongs to.
3. Walk runbook §9 end to end, including the interruption test at step 46.
4. Confirm the church's receipt email arrives **once**, unchanged.
5. Only then create the live keys — and change all three at once.
   `pnpm pilot:readiness` fails on mixed test and live keys in one environment,
   because a rehearsal against that configuration could take a real payment.
6. Register the live webhook endpoint and verify its signature is being checked
   before any real money moves.

### What must never be in an app

`sk_live_…`, `sk_test_…`, `whsec_…`, a connected-account secret, a service-role
key. The publishable key and the connected-account **id** do travel to the phone:
both are designed to, and neither authorises anything on its own.

---

## 4. Streaming relay

`STREAM_RELAY_WEBHOOK_SECRET` is the only value the server needs. The relay box
itself holds its own copy plus MediaMTX configuration, and neither is in this
repository.

Before a pilot: confirm a recording actually lands, and put it through the
eligibility parser (runbook step 34). The parser has never seen a real file.

---

## 5. Supabase

| Value | Where it lives | Public? |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | server and app | yes |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | server and app | yes |
| `SUPABASE_SERVICE_ROLE_KEY` | **server only** | **no** |

The service-role key must never reach a client. An app test asserts the iOS
bundle carries no `service_role` value, and the secret scan covers the rest.

---

## 6. Support and incident rollback

| Incident | First move |
| --- | --- |
| A church's content is wrong in the app | `update … set mobile_visibility = 'none'` for that church. Reversible in one statement |
| Every church's media vanished | expected after 0061/0062. Open the media library; it re-probes |
| A donation looks wrong | the church's Stripe dashboard is authoritative. The app shows a projection of what the webhook wrote |
| Duplicate charges | **stop the pilot.** Capture the payment intent ids and the client attempt id |
| A person cannot sign in | there is no sign-in flow yet |
| The app says "not set up" | the build has no origin |

Every support conversation should quote the `requestId` from the app's error —
every mobile response carries one, and it is the only identifier that ties a
person's report to a server log.

---

## 7. Explicitly not done

* No store account was created, opened or used.
* No app was submitted to any review.
* No keystore, certificate, provisioning profile, APNs key or merchant ID was
  created — and none was requested.
* No Stripe object was created, and no charge was attempted.
* No provider configuration was changed.
* No credential was rotated.
