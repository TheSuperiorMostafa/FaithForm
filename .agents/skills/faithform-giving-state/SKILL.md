---
name: faithform-giving-state
description: Use when changing FaithForm donations, recurring gifts, connected-account ownership, Stripe callbacks, or donor payment state.
---

# FaithForm giving authority

Trace `lib/stripe/giving.ts`, `webhooks.ts`, `webhook-state.ts`, the affected mobile giving route,
and `app/api/webhooks/stripe/route.ts`. Read `docs/faithform/P11_STRIPE_AND_PAYMENT_STATE_MACHINE.md`
for payment transitions; read `P11_SECURITY_PRIVACY_AND_FINANCIAL_CONTROLS.md` for ownership/privacy.

Validate church/fund/account ownership and allowed amounts server-side. Preserve exact monetary
units, currency, connected Stripe account, and idempotency for a client gift attempt.
Verified provider events establish settled payment state; a client confirmation/success page
cannot mark a donation paid. Webhook claim leases, claim tokens, processed/retryable/terminal
states, and retry scheduling must survive duplicate, delayed, and concurrent delivery.

Keep visitor/donor/People linkage boundaries, donor privacy, refund/cancellation state, and
reconciliation consistent. Never log secrets or full donor/provider payloads. Preserve installed
Stripe versions; consult the vendor reference only for relevant API decisions. Test the changed
state/ownership/retry path with fixtures/mocks; no live gift, refund, or recurring cancellation
as a local check.
Follow project `AGENTS.md`. Read only the source and references relevant to this task; validation follows the changed behaviour and risk.
