# Prompt 11 — Verification Matrix

*Every gate, its command, its actual output — and, for each required behaviour,
where it is proved or why it cannot be.*

Executed on the Prompt 11 working tree: macOS, Node 24, Swift 6, JDK 17,
PostgreSQL 17.9.

---

## 1. Gates

| Gate | Command | Result |
| --- | --- | --- |
| Lint | `pnpm lint` | **0 errors**, 50 warnings (pre-existing unused-variable warnings, plus two deliberate `_ok` destructures) |
| Types | `pnpm typecheck` | clean |
| Generated contract | `pnpm contract:check` | current across 3 artifacts |
| Design tokens | `pnpm design:check` | current; 22 contrast pairs pass WCAG minimums |
| Localization parity | `pnpm localization:check` | **233 shared keys**, 3 documented platform-only |
| Web tests | `pnpm test` | **690 passed, 0 failed, 0 skipped** |
| Database tests | `pnpm test:concurrency` | **163 passed, 0 failed, 0 skipped** (fresh database, migrations 0055–**0063**) |
| Migration baseline | `pnpm test:migrations` | verified after 66 legacy migrations |
| Secret scan | `pnpm scan:secrets` | passed for 1,206 files |
| Production dependency audit | `pnpm audit:prod` | `unresolvedHighOrCritical: []` |
| Production web build | `pnpm build` | compiled successfully |
| iOS build (host) | `pnpm ios:build` | build complete |
| iOS build (device) | `pnpm ios:build:device` | **clean: no errors, no warnings** |
| iOS tests | `pnpm ios:test` | **323 tests in 38 suites passed** |
| Android tests | `gradlew test` | **BUILD SUCCESSFUL** |
| Android app tests | `:app:testDebugUnitTest` | **76 executed** — not `NO-SOURCE` |
| Android debug APK | `gradlew :app:assembleDebug` | BUILD SUCCESSFUL |
| Whitespace | `git diff --check` | clean |

### Test counts

| Suite | Before Prompt 11 | After | Added |
| --- | --- | --- | --- |
| Web | 664 | **690** | +26 |
| Database | 130 | **163** | +33 |
| iOS | 319 | **323** | +4 (33 in the giving suites; 29 replaced nothing) |
| Android `:core:giving` | — | **32** | +32 (new module) |
| Android `:app` | 69 | **76** | +7 |
| Android `:core:media` | 44 | 44 | — |
| Android `:core:attendance` | 161 | 161 | — |
| Android `:core:contract` | 42 | 42 | — |
| Android `:core:navigation` | 13 | 13 | — |
| Android `:core:storage` | 7 | 7 | — |
| **Total** | **1,424** | **1,551** | **+127** |

No earlier test was weakened or deleted. One was **changed** — the Prompt 7/8
scope guard, recorded in §5.

---

## 2. Required testing, item by item

### Server and database

| Requirement | Observed |
| --- | --- |
| Wrong church rejected | a fund from another church is `fund_not_found`; an attempt id re-aimed at a second church is `attempt_church_mismatch` |
| Wrong fund rejected | unpublished is `fund_not_published`; inactive is `fund_inactive` |
| Wrong currency rejected | a client cannot send one — the request schema has no currency field, asserted by a sweep |
| Wrong amount rejected | below and above the fund's own bounds, with the bounds themselves inside |
| Connected-account-not-ready rejected | a church with charges disabled, and a church with no account, both show **zero funds**; enabling charges makes the same fund appear |
| **Duplicate logical attempt → one intent** | three sequential claims produce one row; two concurrent claims produce one row and exactly one `created` |
| Network retry idempotent | the same attempt id keeps its idempotency key across retries; the intent attaches write-once |
| Webhook retry idempotent | five deliveries of one success produce one gift |
| Webhook event races | out-of-order guarded by `state_event_at`; a late `processing` cannot move a `succeeded` |
| Receipt races | a receipt requires the attempt **and** the donation to both be `succeeded` |
| Cross-tenant access fails | six tests: verdict, invalidate, publish, attach, link, history, receipt — each driven from the wrong side |
| Cross-donor access fails | another donor holding the exact attempt id gets nothing |
| **Email-only access fails** | there is no email path in any projection; the link is written from a donation, never matched from an address |
| Refund/dispute cannot be forged | only `project_giving_attempt_state` writes them, `service_role` only, and an undefined status is refused |
| Publication visibility | none/public/followers/members honoured; blocked sees nothing |
| Donor history isolation | one donor's history excludes another's; one church's excludes another's |
| Existing giving preserved | publishing changes no fund field; no donation row is created by the attempt path; the web flow and the webhook's donation projection are asserted unchanged |

### Stripe boundary (fixtures and doubles only)

| Requirement | Observed |
| --- | --- |
| Payment-sheet configuration mapping | every documented payment-intent status maps to an app state; `canceled` → `cancelled` normalised once |
| Unknown provider status | resolves to `initiated`, never to a guess |
| Webhook signature / replay | Prompt 2's `claim_stripe_webhook_event`, asserted still in the path; replay driven against PostgreSQL |
| Provider error redaction | no route or adapter reads an error message; the service's `catch` binds nothing; both platforms redact secrets, intents, accounts, customers and keys |
| Capability expiry / revocation | a client secret is never cached or persisted; every giving route except the fund list is `no-store`, asserted by a sweep |
| Apple Pay / Google Pay unavailable and configured | server gate, device veto, and — on iOS — a merchant-identifier veto; the Google Pay environment is derived from the publishable key |

### iOS and Android

| Requirement | Observed |
| --- | --- |
| Contract fixtures decode | generated `Contract.swift` and `Contract.kt` compile and carry all seven giving types |
| **No payment sheet at launch** | `canPresentSheet` is false in every launch state; a source sweep asserts `MainActivity`, `FaithfulApplication` and `AppViewModel` never present, build or configure a sheet |
| Amount and fund validation | 6 tests per platform, including thousands separators, comma decimals, both bounds, and an overflow that must not wrap |
| Payment-sheet façade transitions | completed / cancelled / failed on both platforms |
| **Interruption, restart, retry with the same attempt** | persisted attempt recovered; three starts, one intent; concurrent starts, one intent — the Swift one a real rendezvous with a time limit |
| Pending / processing / succeeded / failed / cancelled / refunded UI | every state has a distinct sentence; refunded and disputed shown truthfully |
| Cache partition and purge | `purge()` drops history, receipt, donation, list and pending attempt |
| Deep-link return handling | Stripe's SDKs own it; no custom payment scheme exists, deliberately (§8 of the state-machine document) |
| Receipt / history isolation | server-side; the client has no route that could return another donor's |
| Accessibility, localization, dark mode, reduced motion | tokens throughout, 43 mirrored strings, semantic selection, live regions, no inline literals |
| Nothing sensitive logged or persisted | `redactForLog` on both platforms; a sweep asserts no source interpolates a client secret |

### Dashboard

| Requirement | Observed |
| --- | --- |
| Publish / unpublish a fund | one dialog, four visibilities |
| Title, description, suggested amounts, min/max | all present; normalised, clamped, deduplicated, sorted |
| Stripe readiness shown clearly | four separate facts, one sentence each, in the order a church has to fix them |
| **Publication prevented when the church cannot charge** | `canPublish` requires it, and it is **re-read at save time** — a capability can be withdrawn between a page load and a click |
| Preview | the same shape the app draws, with no total and no goal |
| Money movement untouched | no payout, refund, reconciliation or reporting code is changed |

---

## 3. Behavioural parity

| Behaviour | iOS | Android | Same? |
| --- | --- | --- | --- |
| A completed sheet is not a receipt | ✅ | ✅ | ✅ |
| Amount parsing, including `1,000` and `50,25` | ✅ | ✅ | ✅ — same pairs asserted on each |
| Both bounds reported separately | ✅ | ✅ | ✅ |
| An empty field is not an error | ✅ | ✅ | ✅ |
| Poll backoff, and stopping | ✅ | ✅ | ✅ |
| Unknown status keeps waiting | ✅ | ✅ | ✅ |
| Three distinct empty states | ✅ | ✅ | ✅ |
| Refunded / disputed shown | ✅ | ✅ | ✅ |
| Redaction | ✅ | ✅ | ✅ — same inputs asserted on each |
| Wallet | Apple Pay, + merchant-id veto | Google Pay, + key-derived environment | ❌ platform difference, documented |
| Numeric keyboard | `.decimalPad` behind `#if os(iOS)` | `KeyboardType.Decimal` | ❌ mechanism, same behaviour |
| Sheet presentation | main actor, resolved controller | activity-result launcher | ❌ mechanism, same behaviour |

---

## 4. Defects found by executing

### 1. `requiresAction` generated `REQUIRESACTION`

Every other enum in the contract is snake_case. Two of mine were camelCase, and
the generator turned `requiresAction` into a run-together Kotlin constant —
valid, unreadable, and one letter from ambiguous.

Found by compiling Kotlin, which is a slow way to discover a naming convention.
Fixed at the source (the values are snake_case now) **and** guarded: a contract
test asserts every enum value in `CONTRACT_ENUMS` is snake_case, so the next one
fails in a second rather than in a Gradle build.

### 2. Google Pay was hardcoded to `Production`

The Android adapter named `Environment.Production` unconditionally. Google Pay's
environment must match the Stripe key it is used with, so this would have refused
against **every test-mode key** — in exactly the environment someone would be
testing in, and only there. It would have looked like Google Pay being broken.

Found while writing the runbook, by asking what the first test-mode run would
actually do. Fixed by deriving it from the publishable key's prefix, which cannot
drift from the key, with an unrecognised prefix resolving to `TEST` — refusing a
real payment is recoverable, taking one against an unidentifiable key is not.

### 3. The migration would have doubled every publication audit

Not this prompt — carried in from the eligibility work and caught here: 0062's
`publish_recording_to_faithful` had picked up an audit insert the caller already
performs. It failed loudly only because the invented column names were wrong. Had
they matched, every church's publication history would have doubled silently.

### 4. Two sweeps that failed on their own prose

`create table[^;]*giving_donations` spanned from the attempts table's `create`
through its foreign key and flagged a *reference* as a second donation table. And
a contract slice read the next schema's doc comment — which legitimately explains
why `stripeAccountId` is in the *response* — as a request field.

Both were my sweeps being wrong about correct code. Anchored and comment-stripped
respectively. Worth recording because a sweep that fails on prose is one somebody
eventually deletes rather than fixes.

### 5. A test asserted the word rather than the value

`assertFalse(safe.contains("secret"))` failed on the replacement `[client-secret]`.
The redaction was correct; the assertion was naive. Now it asserts the actual
secret value is gone.

---

## 5. Earlier tests: what changed, and why

No test was weakened or deleted. One was **changed**:

| Test | Change | Why |
| --- | --- | --- |
| `no out-of-scope feature leaked in` | `PaymentSheet` removed from the forbidden list; **fifteen symbols added** | Prompt 7 forbade it because giving was out of scope until Prompt 11 built it. The boundary moved and the list moved with it — and what replaced it is stricter: no card field on either SDK, no `CustomerSheet`, no `FinancialConnections`, no `USBankAccount`, no in-app purchase, no crypto wallet, no donation sharing, no leaderboard, no donor wall |

The same pattern Prompt 9 used when it removed `AVPlayer` from that list.

---

## 6. Non-vacuity of the sweeps

`tests/security/giving-privacy.test.ts` walks the filesystem, asserts minimum
counts, and anchors on named files.

| Swept set | Files | Minimum asserted |
| --- | --- | --- |
| Native tree | 130+ | > 60 |
| Native production subset | 100+ | > 40 |
| Server giving files | 8 | ≥ 8 |

Two specific files are asserted **inside** the swept set by name —
`Giving.swift` and `Giving.kt` — because a sweep that misses the giving module
proves nothing about giving.

Three sweeps additionally assert their own anchors have not gone stale: the
request-schema slice, the webhook-projection slice, and the `walkBoxes` body
slice each fail loudly if the thing they read was renamed.

---

## 7. Pending — cannot be run here

Each with the exact reason. **None is claimed as passing.**

| Item | Reason | Verified instead by |
| --- | --- | --- |
| **Any Stripe API call** | no test-mode credential was used, deliberately | runbook §§6–7 |
| **One payment intent per attempt, at Stripe** | the three-layer defence is proved against PostgreSQL and a fake provider; Stripe's own idempotency has never been exercised | runbook §7.3 |
| A payment sheet, on any device | Android compiles it into an APK; iOS compiles it for device; neither has run | runbook §7 |
| 3-D Secure, declines, redirects | needs test cards and a device | runbook §7 |
| Real webhook delivery, replay, ordering | simulated against PostgreSQL; never driven by Stripe | runbook §6 |
| Apple Pay | no merchant identifier, no entitlement, **no app target** | runbook §4, §8 |
| Google Pay | no configuration, no review | runbook §5 |
| **An installable iOS app** | `apps/faithful-ios` is a SwiftPM library: no `@main`, no `Info.plist`, no Xcode project, no signing identity | runbook §8 |
| Universal Links / App Links for redirect returns | not registered | runbook §9 |
| Store payment-policy review | nothing submitted; no legal review of the non-profit relationship | runbook §10 |
| Receipt email content and delivery | unchanged code, unverified end to end from a mobile gift | runbook §11 |
| Applying 0063 to staging or production | deliberately not done from a test harness | runbook §12 |

**No claim is made that a gift has been taken, that a sheet has opened, that a
wallet has appeared, or that anything has been deployed.** The decisions, the
isolation, the idempotency and the projections are tested; Stripe, the devices
and the stores are not.

---

## 8. Scope, honoured

Not implemented: banking, crypto, ACH, tax software, a second payment authority,
card storage UI, bank-account UI, donation sharing, leaderboards, social giving,
and recurring giving in the mobile flow. Where a symbol can express the
exclusion, a sweep asserts it.

**Attendance, QR/kiosk, livestreams, the sermon archive, church discovery and
push are untouched.** Two files with "attendance" in their names were edited and
neither is one of those systems:

* `tests/security/native-attendance-privacy.test.ts` — the shared native scope
  guard, where the giving boundary moved (§5).
* `scripts/run-attendance-concurrency.mjs` — the database test runner, which
  gained migration 0063 and the new test file.

The only other pre-existing file Prompt 11 modified is `lib/stripe/webhooks.ts`,
which is the giving authority itself: the change adds a projection onto a
Faithful attempt and leaves the donation write, the receipt path and every
existing event handler as they were.

Migrations **0055–0062 were not modified**. 0063 creates its own objects and
secures only those.
