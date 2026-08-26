# Prompt 11 — Mobile Giving: Source of Truth

*What already exists, what is authoritative, and what Faithful is allowed to add.
Written before any code, from reading the code.*

---

## 1. The one-sentence version

**FaithForm already has a complete Stripe Connect giving system.** Faithful adds a
native way for an authenticated visitor to reach it, and adds nothing else: no
second donation table, no second Stripe flow, no second idea of what a donation
is worth or whether it succeeded.

---

## 2. What exists, traced

### Stripe configuration and Connect

| Concern | Where | Notes |
| --- | --- | --- |
| Platform secret key | `lib/stripe/client.ts` | one `Stripe` client, `STRIPE_SECRET_KEY`, `isStripeConfigured()` |
| Application fee | `lib/stripe/config.ts` | `PLATFORM_APPLICATION_FEE_AMOUNT`, **0 at launch** |
| Connect onboarding | `lib/stripe/connect.ts`, `app/api/stripe/connect/*` | account links, refresh |
| Readiness, per church | `churches.stripe_account_id`, `stripe_charges_enabled`, `stripe_payouts_enabled`, `stripe_details_submitted`, `stripe_onboarding_status`, `stripe_requirements_due` | kept current by `account.updated` / `capability.updated` webhooks |
| Feature switch | `isChurchFeatureEnabled(churchId, "giving")` | the control centre can stop new money moving |

Every charge is created **on the connected account** (`{ stripeAccount }`), never
on the platform account. There is no `transfer_data` / destination-charge path to
reproduce: it is a direct charge on the church's own account.

### The canonical data

| Table | Role | Key columns |
| --- | --- | --- |
| `giving_funds` | what a gift can be designated to | `church_id`, `name`, `slug`, `sort_order`, `is_default`, `is_active`, unique `(church_id, slug)` |
| `giving_donors` | a donor, **per church** | `church_id`, `email`, `name`, `stripe_customer_id`, unique `(church_id, email)` |
| `giving_donations` | the donation projection | `church_id`, `stripe_payment_intent_id`, `stripe_charge_id`, `stripe_invoice_id`, `stripe_subscription_id`, `amount_cents`, `currency`, `status`, `gift_type`, `fund_id`, `donor_id`, `intended_amount_cents`, `fee_covered`, `stripe_fee_cents`, `net_amount_cents`, `stripe_object_key`, `stripe_event_created_at` |
| `giving_subscriptions` | recurring gifts | `stripe_subscription_id` unique, `interval`, `status` |

`giving_donations.status` is already exactly:
`pending | succeeded | failed | refunded | disputed`, and `gift_type` is
`one_time | recurring`. **Both check constraints already exist.**

### The payment flow that exists today (web)

```
POST /api/give/create-intent
  ├─ isStripeConfigured()
  ├─ rate limit  (20 / 15 min, per IP × slug)
  ├─ getChurchBySlug → requires stripe_account_id AND stripe_charges_enabled
  ├─ isChurchFeatureEnabled(church, "giving")
  ├─ getFundById(fundId, churchId)          ← tenant predicate on the read
  ├─ upsertGivingDonor({churchId, email, name})
  └─ createConnectedPaymentIntent(...)      ← automatic_payment_methods, metadata
       → { clientSecret, paymentIntentId }
```

**No donation row is written here.** The row appears only when a webhook says so.

### The webhook, which is the authority

`app/api/webhooks/stripe/route.ts` → `lib/stripe/webhooks.ts`.

* **Signature verified** by `constructStripeEvent` before anything is parsed.
* **Atomic claim** via `claim_stripe_webhook_event(event_id, type, lease)` —
  replay protection, leases, attempt counts, and a `processing | processed |
  retryable | terminal` state, all from Prompt 2's security baseline (0050).
* **`complete_stripe_webhook_event`** closes the claim with a redacted failure
  category and code; `safeStripeFailure` strips everything but an error name.
* **Out-of-order protection**: every donation update carries
  `stripe_event_created_at.lte.<this event>`, so a late `payment_intent.created`
  cannot overwrite a `succeeded`.
* **Race protection**: a unique `stripe_object_key` with a `23505` recovery path
  that re-reads and updates the row that won.
* Events handled: `account.updated`, `capability.updated`,
  `account.application.deauthorized`, `payment_intent.succeeded`,
  `payment_intent.payment_failed`, `charge.refunded`, `invoice.paid`,
  `invoice.payment_failed`, `customer.subscription.{created,updated,deleted}`,
  `charge.dispute.{created,closed}`, `payout.failed`.

### Receipts

`lib/stripe/receipt-delivery.ts`. A receipt is an **email**, sent once, claimed
idempotently through `claim_donation_receipt(donation_id, lease)` and gated on
`status = 'succeeded'`. There is **no receipt document table and no receipt URL**.

That matters for Faithful: there is nothing to hand a phone. A mobile "receipt"
can only be a view of the confirmed donation row.

### Donor portal — the existing "your own history" authority

`lib/giving/portal-session.ts`. An HMAC-signed cookie
(`ff_donor_portal_v2`) carrying `{ churchId, donorId, exp }`, issued by a magic
link, 7-day TTL, 30-minute link TTL, tokens stored hashed.

**It is email-authenticated.** That is appropriate for a web donor with no
account, and it is explicitly *not* what Prompt 11 may use: receipt access in
Faithful must be bound to the authenticated account.

---

## 3. What is authoritative, and stays that way

| Authority | Owner | Faithful's relationship to it |
| --- | --- | --- |
| Which Stripe account a charge lands on | `churches.stripe_account_id` | never sent by a client |
| Whether a church can charge | `stripe_charges_enabled` + the giving feature flag | read-only gate |
| Currency, amount, fee coverage, metadata | server, in `createConnectedPaymentIntent` | never sent by a client |
| Whether a donation succeeded | the **webhook**, writing `giving_donations` | mobile reads a projection of it |
| Refunds, payouts, reconciliation, statements | existing dashboard | untouched |
| Funds and campaigns | `giving_funds` | Faithful adds publication columns, nothing else |
| Donor identity | `giving_donors`, per church | Faithful adds an explicit account link |

---

## 4. What is missing, and therefore what this prompt adds

Five gaps, each additive:

1. **No publication concept for funds.** `giving_funds` has `is_active` and
   nothing about being visible in a mobile app, no title/description a church
   would write for visitors, no suggested amounts, no bounds. → additive
   `mobile_*` columns, following the pattern migration 0054 established for
   announcements and 0060 for media.

2. **No link from a Faithful account to a `giving_donor`.** `giving_donors` is
   keyed by `(church_id, email)`. Matching a visitor to a donor **by email**
   would be exactly the "email-only" access Prompt 11 forbids, and would also
   silently hand one person another's giving history if two people ever shared an
   address. → an explicit `giving_donor_links` table, written only when the
   account itself gives.

3. **No logical donation attempt.** The web flow creates a payment intent per
   request; a phone that loses the network mid-payment has no way to ask "did my
   attempt already become an intent?" → a persisted attempt with an idempotency
   key, which is also what makes the Stripe call idempotent.

4. **No mobile-safe projection.** `giving_donations` carries donor emails, Stripe
   ids, fee breakdowns and net amounts. None of that may reach a phone. → SQL
   projections that select only what a donor may see about their own gift.

5. **Nothing links a webhook back to an attempt.** → the attempt id travels in
   the payment intent's metadata, and the webhook projects the confirmed state
   onto the attempt.

---

## 5. Decisions taken before writing code

**One-time giving only, in the mobile flow.** Recurring exists and is mature —
subscriptions, billing anchors, pause, resume, amount changes, a billing portal.
It also requires a saved payment method, a Stripe customer bound to the donor,
and a whole subscription-management surface. Bolting it onto a one-time sheet is
what the prompt explicitly forbids. So Faithful gives one-time, tells the visitor
plainly where recurring lives, and the contract carries `giftType` so a later
prompt can add it without a migration.

**No fee-coverage toggle on mobile.** `chargeCentsWithFeeCoverage` exists and the
web form uses it. On a phone it is one more decision in a payment flow, and
getting it wrong means charging someone more than they agreed. Out of scope,
stated rather than silently dropped.

**Anonymous giving is not offered.** Nothing in the dashboard has an anonymous
policy — `giving_donations` always carries a donor email from Stripe, and
`giving_donors` is email-keyed. The prompt permits anonymous giving *only if the
existing dashboard policy explicitly supports it*. It does not, so Faithful does
not offer it.

**The receipt is the donation row.** No PDF, no receipt URL, no email address
shown back. A church's own receipt email is unchanged and still the thing that
arrives in an inbox.

**No tax language.** `churches.ein` exists but nothing records tax-exempt status,
deductibility, or a jurisdiction. The word used is "receipt", everywhere.
