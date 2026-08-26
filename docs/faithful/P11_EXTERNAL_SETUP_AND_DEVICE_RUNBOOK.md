# Prompt 11 — External Setup and Device Runbook

*Everything that needs a Stripe account, a phone, a store, or a person — none of
which this work had. Nothing below is done.*

---

## 1. Read this first

Prompt 11 is **source-complete** and **externally unverified**. Every gate that
can run on a laptop has run and is green. Not one of the following has happened:

* No Stripe API call, in test mode or otherwise.
* No test card entered, no 3-D Secure challenge, no decline.
* No webhook received from Stripe.
* No payment sheet presented, on any device or simulator.
* No Apple Pay or Google Pay shown.
* No app installed on a phone. **There is no iOS app target at all** —
  `apps/faithful-ios` is a library.
* No store review, no submission, no listing.
* No migration applied to staging or production.

The tests use fixtures and a fake provider. They prove what this repository
decides; they prove nothing about how Stripe behaves.

---

## 2. Stripe credentials

| Item | Variable | State |
| --- | --- | --- |
| Platform secret key | `STRIPE_SECRET_KEY` | already used by the web flow |
| Publishable key | `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | already set; **now also sent to phones** |
| Webhook secret | `STRIPE_WEBHOOK_SECRET` | already used |
| Application fee | `PLATFORM_APPLICATION_FEE_AMOUNT` | 0 at launch |

Nothing new is required to *start*. What is new is that the publishable key and
the church's connected-account id now travel to a mobile client — both are
designed for that, and neither authorises anything on its own, but it is a change
worth a deliberate look before it goes live.

**Do the first pass entirely in test mode**, against a test-mode connected
account, with a church nobody real belongs to.

---

## 3. Connected-account readiness

A fund cannot be published to Faithful unless its church has
`stripe_account_id`, `stripe_charges_enabled`, and the `giving` feature on. The
dashboard says which of those is missing.

**To verify:**

1. Take a church with no Stripe account. Open **Dashboard → Giving**. The card
   should say the church has not connected an account, and every Publish button
   should be disabled.
2. Complete Connect onboarding but stop before charges are enabled. The message
   should change to "Stripe hasn't enabled payments yet."
3. Enable charges. Publish a fund. It should appear in the app.
4. **Disable charges again** — in the Stripe dashboard, or by rejecting a
   requirement. The published fund should vanish from the app, because
   `mobile_giving_funds` requires `stripe_charges_enabled` on every read.

Step 4 is the one worth doing carefully. It is the case where a church's app
would otherwise offer a payment that fails.

---

## 4. Apple Pay

**Not configured. Not started.**

1. Create an Apple Merchant ID (`merchant.io.faithform.…`) in the Apple Developer
   portal.
2. Add the Apple Pay Payment Processing capability to the app target — **which
   does not exist yet**; see §8.
3. Register the merchant ID with Stripe, so Stripe can decrypt the token.
4. Pass the merchant identifier into `GivingModel(applePayMerchantID:)`. Until
   then `applePayAvailable` returns false and the sheet shows cards only.
5. Verify on a real device with a real card in Wallet. The Simulator's Apple Pay
   is not evidence.

`applePayAvailable` requires the server to allow it, the device to be able to
make payments, **and** a non-empty merchant identifier. A build with none of the
above cannot show Apple Pay by accident.

---

## 5. Google Pay

**Not configured. Not started.**

1. Complete Google Pay API brand and integration review for the Play listing.
2. Verify on a device with a card in the Google Wallet.

The **environment is not a setting**: `walletEnvironment` derives it from the
publishable key's prefix, because Google Pay's environment has to match the
Stripe key it is used with. The first version of the adapter hardcoded
`Production`, which would have refused against every test key — in exactly the
environment someone is testing in. Fixed, and asserted by a test.

Until the server sends a wallet flag, `allowGooglePay` is false and the sheet
shows cards only.

---

## 6. Webhooks

The webhook path is Prompt 2's and is unchanged. What is new is that
`payment_intent.succeeded`, `payment_intent.payment_failed`, `charge.refunded`
and `charge.dispute.*` now also project onto a Faithful attempt.

**To verify, in test mode:**

1. `stripe listen --forward-to <host>/api/webhooks/stripe`.
2. Give in the app. Confirm the attempt moves `initiated → succeeded`, that a
   `giving_donations` row appears, and that the church's own receipt email is
   sent exactly once.
3. **Replay the same event** with `stripe events resend`. Confirm one gift, one
   donation row, one email.
4. Send `payment_intent.processing` *after* `payment_intent.succeeded`, with an
   earlier `created`. Confirm the attempt stays `succeeded`.
5. Refund the charge in the Stripe dashboard. Confirm the app's history says
   Refunded within one refresh.
6. Trigger a dispute with test card `4000000000000259`. Confirm the history says
   Under review.

Step 3 and step 4 are the ones that matter. Both are tested against PostgreSQL
with a simulated webhook; neither has been driven by Stripe.

---

## 7. Test cards and 3-D Secure

| Card | What to check |
| --- | --- |
| `4242 4242 4242 4242` | the happy path, end to end |
| `4000 0025 0000 3155` | **3-D Secure required.** The sheet challenges; the app must reach processing, not success, until the webhook lands |
| `4000 0000 0000 9995` | declined for insufficient funds. The app must say declined and say nothing was charged |
| `4000 0000 0000 0002` | generic decline |
| `4000 0000 0000 3220` | 3-D Secure that then fails |
| `4000 0027 6000 3184` | authentication required on the *next* payment |

**Interruption, which is the case worth the most attention:**

1. Start a gift with a 3-D Secure card. When the challenge appears, **force-quit
   the app.**
2. Reopen it. The pending attempt should be found and the server asked. The
   person should land on processing or on a result — never on a fresh payment
   sheet, and never on a second charge.
3. Check Stripe: **one** payment intent for that attempt.
4. Repeat with airplane mode toggled at the moment the sheet closes.

If step 3 ever shows two intents, stop. That is the failure this entire design
exists to prevent, and it is the one thing no local test can fully prove.

---

## 8. The iOS app target

**There is none.** `apps/faithful-ios` is a SwiftPM library: no `@main`, no App
struct, no `Info.plist`, no `.xcodeproj`, no signing identity. Nothing can be
installed on a phone, and nothing can present a payment sheet.

Before any of §§4, 7 or 9 can happen on iOS, someone has to build it:

1. An Xcode app target with an entry point and root navigation wiring the
   existing `Features/` models to the `Components/` views.
2. An `Info.plist` with the camera usage string check-in already needs.
3. An Apple Developer Team ID and a provisioning profile.
4. The Apple Pay capability from §4.

Android is different: `pnpm android:build` produces a real installable APK today.

---

## 9. Universal Links and App Links

Stripe's SDKs handle their own redirect returns, so Faithful adds no custom
payment scheme. What is still needed is the app's return URL, registered with
Stripe, so a redirecting payment method comes back into the app rather than
leaving a person in a browser.

**Until this is configured**, a redirecting method may strand someone on the
processing screen until they reopen the app — at which point the status route
tells them the truth, because the webhook already did. That is a poor experience
and not a wrong one.

---

## 10. Store payment policy

Both stores allow charitable donations to a registered non-profit through an
external processor rather than in-app purchase, **and both require the app to be
associated with the non-profit or to be a platform serving them**. This is the
review question most likely to be asked.

* Apple: the app must not use IAP for donations, and Apple may ask for
  documentation of the non-profit relationship.
* Google: donations to a registered charity may use an alternative billing
  system; Google may ask the same.

Nothing here has been submitted, and no legal review of the platform's own
position has been done. A sweep asserts no in-app-purchase symbol exists in
either app, which is the technical half of it and not the whole.

---

## 11. Receipt email

Unchanged. The church's own receipt email is sent by
`lib/stripe/receipt-delivery.ts`, once, claimed idempotently, on a succeeded
donation. Faithful shows the same gift in-app and **sends no email of its own**.

**To verify:** give in the app, and confirm exactly one email arrives at the
address Stripe collected in the payment sheet — and that its content is what the
church already sends, not something new.

---

## 12. Applying migration 0063

Additive: six columns on `giving_funds`, two new tables, one trigger, six
functions. Migrations 0055–0062 are untouched.

```bash
createdb faithful_rehearsal
psql faithful_rehearsal -f tests/database/fixtures/bootstrap.sql
for n in 0055 0056 0057 0058 0059 0060 0061 0062 0063; do
  psql faithful_rehearsal -f supabase/migrations/${n}_*.sql
done

FAITHFUL_TEST_DATABASE_URL=postgres://…/faithful_rehearsal pnpm test:concurrency
```

Expect `ℹ pass 163`. Use a **fresh database each run** — migration 0055 uses
`create policy`, which has no `if not exists`.

**Applying it publishes nothing.** `mobile_visibility` defaults to `'none'` on
every fund, so no church's giving appears in the app until a human publishes it.

**It changes nothing about existing giving.** No donation row is written, no
status is altered, and the web giving flow is untouched.

### Rolling back

```sql
-- The panic button. Every church, every fund, out of the app.
update public.giving_funds set mobile_visibility = 'none';
```

Money already given is unaffected: it is in `giving_donations`, which this
migration does not write.

---

## 13. What must be reported back

For each numbered step: pass, fail, or not attempted — and for any failure, the
exact behaviour rather than a summary. In particular:

* **Step 7.3 — one payment intent per attempt.** The single most important
  observation in this runbook.
* Step 6.3 and 6.4 — replay and out-of-order, driven by real Stripe deliveries
  rather than by simulated ones.
* Step 3.4 — a fund disappearing when charges are disabled.
* Step 5 — that Google Pay actually appears against a test key. The environment
  is derived from the key rather than hardcoded, and that derivation has never
  met a real wallet.
* Whether the church's receipt email arrives once, and unchanged.
