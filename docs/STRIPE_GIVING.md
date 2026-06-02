# Stripe Connect Giving

## Environment variables

Copy from [`.env.example`](../.env.example):

- `STRIPE_SECRET_KEY` — platform secret key (test or live)
- `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` — platform publishable key
- `STRIPE_WEBHOOK_SECRET` — signing secret from your **snapshot** webhook endpoint (or Stripe CLI)
- `STRIPE_WEBHOOK_SECRET_SNAPSHOT` — optional; use if you also have a thin destination and need both secrets during migration
- `STRIPE_WEBHOOK_SECRETS` — optional comma-separated list of `whsec_...` values (tries each until one verifies)
- `PLATFORM_APPLICATION_FEE_AMOUNT` — `0` at launch
- `NEXT_PUBLIC_SITE_URL` — your real app URL, e.g. `https://faithform.vercel.app` (give links: `{SITE_URL}/give/{slug}`)
- `NEXT_PUBLIC_GIVE_HOST` — optional; only if you own a dedicated give subdomain and set `NEXT_PUBLIC_GIVE_USE_DEDICATED_HOST=true`
- `NEXT_PUBLIC_SITE_URL` — canonical app URL for Connect return URLs

Never commit real keys. Rotate any keys that were exposed in chat or logs.

## Webhook endpoint

Register on the **platform** Stripe account (test and live separately):

```
{NEXT_PUBLIC_SITE_URL}/api/webhooks/stripe
```

Enable **Listen to events on Connected accounts**.

### Snapshot vs thin event destinations

FaithForm’s handler expects **snapshot** (classic) events — full `payment_intent`, `invoice`, etc. in the payload.

If you created a second destination with **Use thin events** enabled, it has a **different** signing secret (`whsec_...`) than your snapshot destination. Sending both to the same URL with only one secret in Vercel causes **400 Invalid signature** on the other destination.

**Recommended:** Use one snapshot destination for `https://faithform.vercel.app/api/webhooks/stripe` and disable or delete the thin destination until you migrate intentionally.

If you must run both temporarily, set in Vercel:

- `STRIPE_WEBHOOK_SECRET` = snapshot destination secret (the one that records gifts)
- `STRIPE_WEBHOOK_SECRET_THIN` = thin destination secret (acknowledges thin pings only; gifts still need snapshot)

Or both in one variable: `STRIPE_WEBHOOK_SECRETS=whsec_snapshot...,whsec_thin...`

Events handled:

- `account.updated`, `capability.updated`, `account.application.deauthorized`
- `payment_intent.succeeded`, `payment_intent.payment_failed`
- `charge.refunded`, `charge.dispute.created`, `charge.dispute.closed`
- `invoice.paid`, `invoice.payment_failed`
- `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`
- `payout.failed`

## Giving enhancements (migration 0016)

Apply `supabase/migrations/0016_giving_enhancements.sql` (or `pnpm db:giving-enhancements` with `DATABASE_URL`):

- `giving_funds`, `giving_donors`, fee/donor columns, `donor_portal_sessions`
- Church `ein` and `statement_address` for year-end PDFs

### Cover-the-fees

Donors can gross up the charge so the church nets the intended gift amount (nonprofit rate 2.2% + $0.30). Stored as `intended_amount_cents`, `fee_covered`, and charged `amount_cents`.

### Apple Pay / Google Pay

Enabled on the Payment Element via `wallets: { applePay: 'auto', googlePay: 'auto' }`. In production:

1. Register and verify your give domain in Stripe Dashboard → Apple Pay.
2. Serve the give page over HTTPS on the production host.

### Donor portal

`/give/{slug}/portal` — magic-link email auth, card update (SetupIntent), recurring pause/cancel/amount change, gift history, annual statement PDF.

### Dashboard

- `/dashboard/giving/gifts` — search, filter, pagination, CSV export, refunds
- `/dashboard/giving/donors` — YTD totals per donor
- Settings → Giving — fund CRUD, EIN, statement address
- QR code on giving home

## Local development

1. Apply migrations `0013_stripe_giving.sql` and `0016_giving_enhancements.sql` to Supabase.
2. Set env vars in `.env.local`.
3. Forward webhooks:

```bash
stripe listen --forward-to localhost:3000/api/webhooks/stripe
```

Use the CLI `whsec_...` value as `STRIPE_WEBHOOK_SECRET`.

4. Give pages are at `/give/[slug]` on your main app URL (e.g. `https://faithform.vercel.app/give/your-church-slug`).

## Sandbox → live cutover

1. Complete Connect platform settings in Stripe Dashboard (test mode).
2. Onboard a test Standard connected account from **Dashboard → Settings → Giving**.
3. Send a test gift on `/give/[slug]` (or your full `NEXT_PUBLIC_SITE_URL/give/[slug]`).
4. Confirm `giving_donations` rows and dashboard totals.
5. Switch to **live** API keys in production env.
6. Create a **new** live webhook endpoint and update `STRIPE_WEBHOOK_SECRET`.
7. Churches complete live Connect onboarding (test connected accounts do not transfer to live).

## Vercel

Optional: add a dedicated give subdomain to Vercel, set `NEXT_PUBLIC_GIVE_HOST` and `NEXT_PUBLIC_GIVE_USE_DEDICATED_HOST=true`. Middleware rewrites `/{slug}` on that host to `/give/{slug}`.

## Architecture summary

- **Standard** connected accounts; **direct charges** on the connected account
- `application_fee_amount` from `PLATFORM_APPLICATION_FEE_AMOUNT` (0 at launch)
- Card data via Stripe Payment Element only (PCI SAQ A)
- Church dashboard: `/dashboard/giving`
- Public give page: `{NEXT_PUBLIC_SITE_URL}/give/{slug}` (e.g. `https://faithform.vercel.app/give/{slug}`)
