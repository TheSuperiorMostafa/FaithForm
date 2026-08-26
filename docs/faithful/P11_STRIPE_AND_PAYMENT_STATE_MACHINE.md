# Prompt 11 — Stripe, Idempotency, and the Payment State Machine

*How a gift is created, what makes a retry safe, and the one thing that is
allowed to say money moved.*

---

## 1. The shape of it

```
  phone                     FaithForm                      Stripe
    │                            │                            │
    │  POST /giving/donate       │                            │
    │  {slug, fundId, amount,    │                            │
    │   clientAttemptId}         │                            │
    │───────────────────────────▶│                            │
    │                            │ claim_giving_attempt       │
    │                            │  ├ fund belongs to church? │
    │                            │  ├ active? published?      │
    │                            │  ├ amount inside bounds?   │
    │                            │  └ on conflict do nothing  │
    │                            │                            │
    │                            │  paymentIntents.create     │
    │                            │  on the connected account, │
    │                            │  idempotencyKey from the   │
    │                            │  attempt row              │
    │                            │───────────────────────────▶│
    │  {clientSecret, …}         │                            │
    │◀───────────────────────────│                            │
    │                                                         │
    │  Stripe PaymentSheet (native SDK, card never touches us) │
    │◀───────────────────────────────────────────────────────▶│
    │                                                         │
    │  sheet says "completed" ── which is NOT a receipt        │
    │                            │                            │
    │                            │◀── webhook, signed ────────│
    │                            │  claim_stripe_webhook_event│
    │                            │  upsertDonation            │
    │                            │  project_giving_attempt_state
    │                            │                            │
    │  GET  …/status/{attempt}   │                            │
    │───────────────────────────▶│                            │
    │  {status, confirmed}       │                            │
    │◀───────────────────────────│                            │
```

Two things are worth reading twice.

**The payment intent is created on the church's own connected account.** Direct
charges, `{ stripeAccount: acct_… }`, exactly as the web flow has always done.
There is no destination charge and no transfer to reproduce.

**The sheet's completion and the gift's success are different events**, arriving
by different paths, and only the second one is believed.

---

## 2. What a client is allowed to say

Four fields, and that is the whole of it:

```ts
{ churchSlug, fundId, amountCents, clientAttemptId }
```

Everything else is read from the church's own rows:

| Decided by the server | Where from |
| --- | --- |
| Which Stripe account | `churches.stripe_account_id` |
| Whether it may charge | `stripe_charges_enabled` + the giving feature flag |
| Currency | fixed, `usd` |
| Amount bounds | the fund's own `mobile_min/max_amount_cents`, then the platform's |
| Application fee | `PLATFORM_APPLICATION_FEE_AMOUNT`, which is 0 |
| Metadata | assembled server-side; the client contributes none of it |
| Idempotency key | derived in SQL from the attempt row |
| Receipt email | not set from mobile — the church's own receipt path handles it |

A sweep asserts the request schema contains none of `stripeAccountId`,
`currency`, `applicationFee`, `metadata`, `customerId`, `donorEmail` or
`receiptEmail`, and that the service never reads them off a request.

---

## 3. Idempotency, in three layers

A phone loses its network mid-payment. A person taps Give twice. An app is killed
while a sheet is open. All three must produce **one** charge, and each is
defended separately because each fails differently.

### Layer 1 — one attempt row

`claim_giving_attempt` is `on conflict (account_id, client_attempt_id) do
nothing`, followed by a read. Two concurrent requests carrying the same id
produce one row, and the loser is told which intent to reuse.

A database test drives this from two connections and asserts exactly one of them
believes it created the attempt.

### Layer 2 — one Stripe intent

The attempt row carries `stripe_idempotency_key`, derived in SQL as
`'ffg_' || gen_random_uuid()`. **A client never chooses it**, so a client cannot
make two attempts share a key or make one attempt use two. It is sent to Stripe
as the `Idempotency-Key`, so *this server* retrying — a timeout, a cold start, a
redeploy mid-request — returns the first intent rather than creating a second.

### Layer 3 — write-once attachment

`attach_giving_payment_intent` matches on `stripe_payment_intent_id is null`.
Even a bug that somehow created two intents cannot repoint the attempt at the
second, which would strand the first charge with nothing tracking it.

### And the client's half

The `clientAttemptId` is generated once, when the person commits to an amount,
and is **persisted before any network call**. That ordering is the whole point: a
phone killed before sending has nothing to retry, and a phone killed after
sending has an id that will find the intent it already created.

---

## 4. The state machine

```
                    initiated
                    │      │
     requires_action│      │processing
                    └──┬───┘
                       │
        ┌──────────────┼──────────────┐
     succeeded       failed       cancelled
        │
   ┌────┴────┐
refunded  disputed
```

| State | Written by | Means |
| --- | --- | --- |
| `initiated` | the claim | an intent exists, nothing has confirmed |
| `requires_action` | the status read | the bank is still asking |
| `processing` | the webhook | submitted, not settled |
| `succeeded` | **the webhook only** | money moved |
| `failed` | the webhook | it did not |
| `cancelled` | the client dismissing the sheet, or Stripe | nothing was charged |
| `refunded` | **the webhook only** | `charge.refunded` |
| `disputed` | **the webhook only** | `charge.dispute.created` |

`project_giving_attempt_state` is `security definer`, granted to `service_role`
alone, and rejects any status outside that list. No mobile route calls it; a
sweep asserts that.

### Out-of-order events

Stripe delivers out of order in practice, not just in theory. Every projection
carries `state_event_at` and refuses an event older than the one already applied
— the same guard `giving_donations` has always used. A database test drives a
late `processing` after a `succeeded` and asserts the confirmed state survives.

### Replay

Webhook replay protection is Prompt 2's, unchanged:
`claim_stripe_webhook_event` takes an atomic lease, tracks attempts, and
`complete_stripe_webhook_event` closes it with a redacted failure category. A
database test delivers the same success five times and asserts one gift.

---

## 5. Why the sheet is not believed

Stripe's own documentation is explicit that a completed `PaymentSheet` means the
payment was **submitted**, and that final state arrives by webhook. A card can be
authorised and then fail capture; a redirect method can complete on the device
and settle minutes later; a 3-D Secure challenge can pass and the issuer can
still decline.

So both platforms map the sheet's outcomes this way:

```
completed  →  awaitingConfirmation   ← never `confirmed`
cancelled  →  cancelled
failed     →  failed
```

and only `advanceAfterServer(.succeeded)` reaches `confirmed`. Three tests assert
it — one per platform, plus a source sweep asserting the exact line exists in
both — because a version of this that resolved on the sheet would show a receipt
for a gift that could still fail, and would do so most often for exactly the
payments that need review.

The screen a person sees while waiting says *processing*. It does not say thank
you.

---

## 6. Errors

Nothing Stripe says crosses to a phone.

* The Android adapter maps `PaymentSheetResult.Failed` **by type** and never
  reads its error. A sweep asserts `.error.message` appears nowhere in it.
* The iOS adapter does the same with `PaymentSheetResult.failed`.
* The server wraps provider calls in `catch { }` with no bound error, so there is
  no value to log. A sweep asserts `catch (error)` does not appear in the giving
  service.
* Failures become five app-level reasons — declined, network, church not
  accepting, not allowed, unavailable — and nothing else.

Both platforms additionally run `redactForLog`, which replaces client secrets,
payment-intent ids, account ids, customer ids and publishable keys before any
string is logged.

---

## 7. Wallets

Apple Pay and Google Pay are offered only when **the server says the church's
configuration allows it** and the device agrees. The server's answer is the gate;
the device's is a veto. On iOS a missing merchant identifier is a third veto,
because a build without the entitlement cannot present Apple Pay at all.

Neither is enabled in this repository: no Apple merchant identifier exists, and
no Google Pay configuration has been created. The code path is present, tested,
and **switched off until the external setup in
`P11_EXTERNAL_SETUP_AND_DEVICE_RUNBOOK.md` is done**.

---

## 8. 3-D Secure and redirects

`automatic_payment_methods` is enabled, so the church's own Stripe dashboard
settings decide which methods appear. Some of them redirect.

Stripe's SDKs handle the return themselves — `PaymentSheet` registers its own
activity result on Android and its own URL handling on iOS — so this app adds no
custom scheme and no deep-link parser for payments. That is deliberate: a
hand-written return handler is a place to get authentication wrong, and Stripe's
is the supported path.

**What still has to be configured externally** is the app's return URL / App
Link, and it is not configured here. Until it is, a redirecting payment method
may leave a person on the processing screen until they reopen the app — at which
point the status route tells them the truth, because the webhook already did.

---

## 9. What this document does not claim

* **No Stripe call has been made.** Every test uses fixtures or a fake provider.
  No test-mode key has been used, no test card has been entered, and no webhook
  has been received from Stripe.
* **No payment sheet has been presented.** Android compiles the adapter and iOS
  compiles it for device; neither has run.
* **No wallet has been shown.** Apple Pay and Google Pay are unconfigured.
* The state machine, the idempotency, the isolation and the projections are all
  tested against a real PostgreSQL. Everything that needs Stripe is in the
  runbook.
