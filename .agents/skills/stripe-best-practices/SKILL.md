---
name: stripe-best-practices
description: Use for Stripe payment, subscription, Connect, or webhook design decisions; pair with the project money-state skill.
---

# Stripe integration reference

Preserve the installed SDK and explicit API-version pins. Upgrading Stripe, migrating existing
PaymentIntents to Checkout, changing payment methods, or creating an account/sandbox is a
separate task. Vendor defaults for new integrations do not silently change existing flows.

Read the matching local reference only:
- Payments/fulfillment: `references/payments.md`.
- Connected accounts: `references/connect.md`.
- Subscriptions: `references/billing.md`.
- Signature/key/OAuth handling: `references/security.md`.
- Tax or treasury: `references/tax.md` / `references/treasury.md` only when requested.

For FaithForm, use its giving state-machine skill; for Pivorta, billing/entitlements and
quote/signing have different authorities. Browser success is not proof of payment settlement.
Preserve raw-body signature verification, idempotency/retry handling, exact amounts and
connected-account ownership. Exercise providers only in the established test environment
when that is within the task. Do not expose keys, full customer payloads, or signing secrets.
Verify temporally changing API/legal facts in current Stripe documentation when needed.
`UPSTREAM.md` preserves the vendor snapshot; its latest-version defaults are not local policy.
