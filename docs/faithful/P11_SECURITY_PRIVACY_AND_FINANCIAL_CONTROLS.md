# Prompt 11 — Security, Privacy, and Financial Controls

*Who can see what, what can never be forged, and what is deliberately not built.*

---

## 1. What each holder can do

| Holder | Can | Cannot |
| --- | --- | --- |
| An authenticated visitor | see funds their relationship allows; start a gift; see **their own** history and receipts at the selected church | see another donor's anything; choose the account, currency, fee or metadata; mark a gift succeeded |
| A church admin | publish a fund, set its title, description, suggested amounts and bounds | publish while Stripe cannot charge; see a client secret; change a donation's state |
| A leaked `clientAttemptId` | nothing | the attempt is bound to an account; another account presenting it gets a 404 |
| A leaked `clientSecret` | complete *that one* payment | it is one payment's bearer token, expires with the intent, and is never persisted or logged |
| The Stripe webhook | write every payment state | nothing else can |

---

## 2. Access is bound to an account, never to an email

`giving_donors` is keyed `(church_id, email)`. Matching a Faithful account to a
donor **by email** would be the "email-only" access this prompt forbids — and it
would do real harm the first time two people shared an inbox, which for a church
is a married couple, a family, or an office address.

So `giving_donor_links` is written **only when the account itself gives**, on a
succeeded webhook, from the donor id the donation already carries. First gift
wins; a later gift does not repoint the link.

And history does not go through that link at all. It goes through
`giving_donation_attempts`, which carries `account_id` directly:

```sql
where a.account_id = p_account_id
  and c.slug = p_church_slug
```

Both predicates, on the statement. There is no email path in, no donation-id path
in, and no receipt-id path in — a receipt is reached through an attempt, which is
reached through an account.

---

## 3. What the projections never return

| Never returned to a phone | Where it lives instead |
| --- | --- |
| Donor email | `giving_donations.donor_email` |
| Stripe payment intent / charge / customer id | the same table, and the attempt row |
| Stripe fee, net amount, fee coverage | `giving_donations` |
| Another donor's anything | behind the account predicate |
| A church's connected-account secret | there is none — the account **id** is not a credential |
| Provider error text | never read at all |

Asserted three ways: a column-name sweep over the SQL projections, a JSON-Schema
sweep over the five visitor-facing definitions, and a database test that puts a
donor email and a fee on a real row and asserts neither is in the projected
output.

The one type that carries a client secret is `DonationSession`, returned by the
donate route alone, `no-store`, and never in a list.

---

## 4. Rate limits and bounds

| Control | Value | Why |
| --- | --- | --- |
| Amount floor | 100 cents | what Stripe accepts for a card charge, and what the web flow already enforces |
| Amount ceiling | 2,000,000 cents | a **typo control**, not a fraud control, and documented as one |
| Per-fund bounds | the church's own, clamped inside the platform's | a church may narrow, never widen |
| Suggested amounts | at most 6, deduplicated, sorted, inside the fund's range | a chip that fails on tap is a broken button |
| History page | at most 50 rows, `greatest(1, least(…))` in SQL | a client cannot ask for a church's whole ledger |

The amount is bounded in **three independent places**: the client for the
keyboard, the server for the platform, and SQL for the fund. A sweep asserts all
three exist.

---

## 5. What cannot be forged

**A succeeded gift.** `project_giving_attempt_state` is `security definer`,
granted to `service_role` only, rejects any status outside the state machine, and
is called by the webhook path alone. A sweep asserts no mobile route mentions it.

**A receipt.** `mobile_giving_receipt` requires `a.status = 'succeeded'` *and*
`d.status = 'succeeded'` — the attempt and the donation must agree — and joins
the donation on its own church. A gift that is merely processing has no receipt,
and a database test asserts it.

**A refund or a dispute.** Only `charge.refunded` and `charge.dispute.*` write
them, through the same signed, claimed, ordered path. There is no client route.

**A cross-tenant read.** Every function carries its tenant predicate on the
statement: `claim_giving_attempt` refuses another church's fund;
`attach_giving_payment_intent` refuses another account's attempt;
`link_giving_donor` refuses a donor from another church; the history and receipt
projections carry both the account and the church. Six database tests drive each
of those from the wrong side.

**An attempt aimed at a second church.** A `clientAttemptId` already used for one
church is refused for another rather than answered — it is either a client bug or
a probe, and neither deserves a payment intent.

---

## 6. Card data

**Faithful has no card field.** Card details are entered inside Stripe's own
`PaymentSheet`, in Stripe's process boundary, and never reach this app. A sweep
over every production native file asserts the absence of
`STPPaymentCardTextField`, `STPCardParams`, `STPPaymentMethodCardParams`,
`CardInputWidget`, `CardMultilineWidget`, `CardFormView` and `CardNumberEditText`.

**No WebView checkout.** `WKWebView`, `SFSafariViewController`, `WebView` and
`checkout.stripe.com` are all swept for and absent. A payment inside a web view
is a payment whose credentials end up in a URL, a cookie jar and a page's
history.

**No instrument management and no bank rails.** `CustomerSheet`,
`FinancialConnections`, `USBankAccount` and `STPBankAccount` are absent. Faithful
gives once; it does not store a card, link an account, or move money by ACH.

---

## 7. What is never logged

* Client secrets. Both platforms run `redactForLog` before any string is logged,
  and the server never interpolates one.
* Payment intent, account and customer identifiers — redacted by the same
  function, because each names a person's gift.
* Publishable keys. Not a credential, and still not something that should sit in
  a log identifying which Stripe account an install talks to.
* Provider errors. Not read, so there is nothing to log.

An Android sweep additionally asserts no source file interpolates
`$clientSecret`, which is how one would reach a log by accident.

---

## 8. Caching

| Surface | Policy | Why |
| --- | --- | --- |
| Fund list | `private-revalidate`, ETag over the per-fund publication versions | a church's published funds, for a member — cheap to revalidate |
| Donate | `private-no-store` | carries a client secret |
| Status | `private-no-store` | a stale payment state is actively harmful |
| History | `private-no-store` | not something to leave in a cache |
| Receipt | `private-no-store` | same |

A sweep asserts each route's policy. The fund list's ETag moves when any
published fund changes, through a trigger that deliberately ignores internal
edits — a church reordering its dashboard list must not invalidate every phone.

### Purging

Giving state is partitioned by account, church and authorization version, like
every other Faithful cache. A church switch, a sign-out, an authorization-version
bump or a revoked donor link changes the partition, and nothing survives it.
Because history and receipts are `no-store`, there is nothing in an HTTP cache to
purge in the first place — the partition covers what the app itself holds.

---

## 9. What is **not** claimed

**No Stripe call has been made.** Every test uses a fixture or a fake provider.
No test-mode key, no test card, no real webhook. Anything about how Stripe
actually behaves is a runbook item.

**No payment sheet has been presented.** Both adapters compile — Android into an
APK, iOS for a device — and neither has run. iOS additionally has no app target
to present from.

**Anonymous giving is not offered.** Nothing in the dashboard records an
anonymous policy, so nothing here invents one.

**No tax language anywhere.** `churches.ein` exists; nothing records
deductibility, exemption or jurisdiction. The word is "receipt". A sweep asserts
"deductible", "501(c)", "write-off" and "charitable deduction" appear on no
giving surface.

**No fabricated numbers.** No totals, no goals, no donor counts, no progress
bars. A sweep asserts `goalCents`, `raisedCents`, `donorCount`, `progress` and
`percentFunded` exist in neither the panel nor the contract.

**Money movement is unchanged.** Payouts, refunds, reconciliation, statements and
fee reporting are the existing dashboard's, and Prompt 11 does not touch them. A
sweep asserts the web giving flow and the webhook's donation projection are as
they were.
