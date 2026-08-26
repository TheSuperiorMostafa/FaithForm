# Prompt 11 — The Native Giving Experience

*What a person sees, what each screen is allowed to do, and where the two
platforms honestly differ.*

---

## 1. The shape of it

```
Give ─────────────► Amount ─────────► Confirm ────► Stripe sheet
 │                                                       │
 │ funds a church published                    completed / cancelled / failed
 │ suggested amounts + custom                            │
 │                                                       ▼
 └─► Your giving                                   Processing…
     (this account, this church)                         │
                                          server says succeeded / failed
                                                         │
                                                      Receipt
```

Four screens and one sheet. Nothing else.

---

## 2. Where the decisions live

Not in the views. On both platforms the rules are in a platform-free module —
`Giving.swift` and `:core:giving` — and the views render a state.

| Decision | iOS | Android |
| --- | --- | --- |
| Is this amount allowed? | `validateAmount(_:bounds:)` | `validateAmount(raw, fund)` |
| What does a closed sheet mean? | `advanceAfterSheet` | `advanceAfterSheet` |
| What does the server's answer mean? | `advanceAfterServer` | `advanceAfterServer` |
| When to ask again, and when to stop | `nextPollDelaySeconds` | `nextPollDelayMillis` |
| Which empty state | `GivingListPhase` | `GivingScreenState.emptyReason` |
| May a sheet be presented? | model guards | `GivingScreenState.canPresentSheet` |
| What must never be logged | `redactForLog` | `redactForLog` |

That is why `swift test` and `gradlew :core:giving:test` can assert the payment
flow without a payment sheet, a device or a network. **A flow that could only be
tested by opening a payment sheet would not be tested.**

---

## 3. Giving home

Shows the church's name, a line of context, and one card per published fund.
Each card carries a title, an optional description, and nothing else.

**No totals, no goals, no donor counts, no progress bars.** None of those exist
in the canonical data. Inventing one would be a number the church would then have
to defend, and a sweep asserts none is present in the panel or the contract.

### The states, and why each is a different sentence

| State | What it says |
| --- | --- |
| Loading | a spinner |
| Funds published | the list |
| **Church not accepting** | "Giving is not set up yet" |
| **No funds published** | "Nothing to give to yet" |
| **Blocked** | "This church is not available to you" — the same answer as everywhere else |
| Offline | "Faithful could not reach the server", with a retry |
| Failed | the server's message, with a retry |

The first two are genuinely different and are said differently. Showing "nothing
here" to someone whose church has not finished Stripe setup makes an unfinished
setup look like a mistake they made.

A retry is offered only where retrying could help. Blocked gets none, because a
retry button implies a network problem that is not there.

### Recurring

Faithful gives **one-time**. The existing dashboard and Stripe model support
recurring properly — subscriptions, billing anchors, pause, resume, amount
changes, a billing portal — and bolting that onto a one-time sheet is what this
prompt explicitly forbids.

So the app says where recurring lives, and **only when the church actually runs
it**: `recurringAvailable` is computed from that church's own active
subscriptions. A church with none is not advertised as offering it.

---

## 4. Amount

Suggested amounts are chips; the field is always there. The chips are a
convenience and never a floor.

The chips **wrap** rather than scroll — `FlowRow` on both platforms — because at
large text sizes a row of them will not fit, and a chip a person cannot reach is
a chip that is not there.

### What the validator accepts

Both platforms parse the same way, and a test asserts the same pairs on each:

| Typed | Read as | Why |
| --- | --- | --- |
| `50` | $50.00 | |
| `50.25` | $50.25 | |
| `$50` | $50.00 | people type the symbol |
| `1,000` | $1,000.00 | a thousands separator, not a decimal point |
| `50,25` | $50.25 | most of the world writes it this way |
| `twenty`, `-5`, `0` | refused | |
| `99999999999` | refused as above-maximum | it must not overflow into something payable |

The comma is decided by **shape**, not by locale: digits in groups of three make
it a separator, anything else makes it a decimal point. Guessing wrong charges
the wrong amount.

### What it says when it refuses

"Below this fund's minimum" and "above this fund's maximum" are separate
messages. "Invalid amount" tells a person nothing they can act on.

An empty field says nothing at all until they have typed something — an error
before anyone has typed is an error about nothing.

The message is a **live region** on Android and an announced element on iOS, so
someone using a screen reader learns why the button is disabled rather than
discovering it by pressing.

---

## 5. Confirm

Church, fund, amount. All three, because a person about to pay should be able to
check what they are paying without remembering what they tapped four screens ago.

The amount is formatted in full — `$1,234.00`, never `$1.2K`. An abbreviated
number on a receipt is not something a person can check against their bank.

---

## 6. The payment sheet

**Stripe's own.** `PaymentSheet` on both platforms. Faithful has no card field,
and card details never touch this process — a sweep over every production native
file asserts the absence of every card-input symbol on both SDKs.

No WebView checkout. Also swept for.

Apple Pay and Google Pay appear only when the server's configuration allows it
**and** the device agrees — and on iOS, only when the build carries a merchant
identifier. Neither is enabled here; the path is written, tested, and switched
off until the external setup is done.

---

## 7. Processing

The screen a person waits on after the sheet closes, and the most important
screen in this feature.

**It does not say thank you.** Stripe's own documentation is explicit that a
completed sheet means the payment was *submitted*; final state arrives by
webhook. So `completed` maps to `awaitingConfirmation` on both platforms, and a
test on each asserts it, plus a source sweep asserting the exact line exists in
both.

The app then polls the status route, backing off — 1 s, then 3 s, then 6 s — and
**stops** after about two minutes. A phone that has polled that long is not
helped by a hundred more requests. It changes its wording to say the gift is
still going through and the receipt will arrive, which is true, and stops asking.

A failed poll is not a failed gift: the loop keeps asking.

---

## 8. Interruption

The scenario this whole design exists for: the sheet is open and the app is
killed.

1. The attempt id is generated once and **persisted before the network call**. A
   phone killed between those two lines has nothing to retry.
2. On launch and on foreground, the model loads the pending attempt and asks the
   server what became of it — it does not start again.
3. The server returns the intent that already exists, because the same
   `clientAttemptId` always resolves to the same attempt row.

Cancelling or failing clears the pending attempt: that id is spent, and reusing
it would resume an intent the person walked away from.

The stored attempt holds an id, a slug, a fund and an amount. **No client secret
and no payment intent id** — nothing a person would mind being read.

---

## 9. Receipt

Shown only when the **server** says the gift succeeded, and fetched from a route
that requires the attempt *and* the donation to both be `succeeded`. Before then
the route is a 404, so a payment sheet's own callback cannot produce a receipt.

It carries the amount, the fund, and the church. It carries no donor email, no
Stripe identifier, no fee, and **no tax language** — nothing in the dashboard
records deductibility, so the word is "receipt".

If the receipt has not arrived yet, the thank-you stands alone rather than
showing something this app invented.

---

## 10. Your giving

This account's own gifts at this selected church, newest first, with the date,
amount, fund and a truthful status.

**Refunded and disputed are shown.** Hiding them would leave a person looking at
a list that disagrees with their bank statement.

The list says out loud that it is only their own giving at this church, because
a person looking at a list of gifts should know whose it is.

A status a newer server introduces reads as "processing" rather than as anything
a person would act on.

---

## 11. Where the platforms honestly differ

| | iOS | Android |
| --- | --- | --- |
| Payment sheet | `PaymentSheet` (StripePaymentSheet) | `PaymentSheet` (stripe-android) |
| Wallet | Apple Pay, gated on a merchant identifier | Google Pay, gated on server config |
| Sheet presentation | main actor, from a resolved view controller | activity-result launcher registered at construction |
| Numeric keyboard | `.decimalPad`, guarded `#if os(iOS)` | `KeyboardType.Decimal` |
| **Everything else** | identical | identical |

The `#if os(iOS)` on the keyboard is not decoration: `swift test` runs on macOS,
where `keyboardType` does not exist, and guarding it is what keeps the decisions
testable on a plain runner.

The wallet difference is real but shallow — iOS needs a merchant identifier as a
third veto because a build without the entitlement cannot present Apple Pay at
all.

---

## 12. Accessibility

* **Dynamic Type / font scaling** — every text style comes from the design
  system; cards use `fixedSize(horizontal: false, vertical: true)` on iOS so they
  grow rather than truncate. Chips reflow.
* **Selection is semantic** — `.isSelected` on iOS, `selectable` on Android. A
  ring nobody can see is not a selection.
* **Cards are one element** — `accessibilityElement(children: .combine)` and
  `semantics(mergeDescendants = true)`, so a gift is read as a gift rather than
  as four unrelated labels.
* **Live regions** — the amount error and the processing state announce
  themselves.
* **Dark mode** — both use theme tokens; nothing hardcodes a colour.
* **Reduced motion** — the only motion is a standard progress indicator.
* **Localization** — 43 new keys, mirrored on both platforms, verified by
  `pnpm localization:check`. No inline literal in a view.

---

## 13. What has not been observed

**No payment sheet has been presented.** Android compiles it into an APK; iOS
compiles it for a device. Neither has run.

**No wallet has been shown.** Neither Apple Pay nor Google Pay is configured.

**There is no iOS app target.** `apps/faithful-ios` is a SwiftPM library — no
`@main`, no `Info.plist`, no Xcode project — so nothing on iOS can present
anything to anyone yet. The views and the adapter compile for the platform, and
that is the whole of the claim.

Everything in §§3–11 is exercised by 32 Kotlin and 33 Swift tests against the
state machines and the validators. Everything that needs a phone is in the
runbook.
