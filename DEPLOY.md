# FaithForm — Production Deployment Guide

FaithForm is a Next.js 15 church management app backed by Supabase. This guide walks through deploying to Vercel and configuring Supabase for production.

**Stack:** Next.js (App Router) · Supabase (Postgres + Auth) · Vercel · pnpm

---

## Environment Variables

Set these in **Vercel → Project → Settings → Environment Variables** (and in GitHub Actions secrets if using CI). Use the **exact variable names** below — they match what the application code reads.

### Required

| Variable | What it is | Where to get it |
|----------|------------|-----------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL | [Supabase Dashboard](https://supabase.com/dashboard) → your project → **Settings → API** → Project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase public key — safe to expose in the browser; also accepts `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Same page → **Project API keys** → publishable / `anon` key |
| `SUPABASE_SECRET_KEY` | Supabase secret key — server-only; required for reading OAuth tokens and calendar sync | Same page → **secret** key (also accepts `SUPABASE_SERVICE_ROLE_KEY`) |
| `ANTHROPIC_API_KEY` | Claude API key for sermon builder | [console.anthropic.com](https://console.anthropic.com) → API Keys |
| `ESV_API_KEY` | ESV Bible API key for sermon scripture lookup | [api.esv.org](https://api.esv.org) → Account → API Key |
| `N8N_WEBHOOK_SECRET` | Shared secret for n8n webhook calls (attendance) and OAuth state signing | Generate a long random string |
| `INTEGRATION_OAUTH_STATE_SECRET` | Signs Google/Facebook OAuth state; required in production | Separate random string of at least 32 characters |
| `NEXT_PUBLIC_SITE_URL` | Public URL of the deployed app (no trailing slash) | `https://faithform.io` |
| `STREAM_RELAY_HOST` | RTMP relay hostname shown in Settings | `stream.faithform.io` |
| `NEXT_PUBLIC_STREAM_RELAY_HOST` | Optional client-facing copy of relay hostname | `stream.faithform.io` |
| `STREAM_RELAY_WEBHOOK_SECRET` | Shared secret used between MediaMTX and FaithForm stream routes | Long random string |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID | [Google Cloud Console](https://console.cloud.google.com) → APIs & Services → Credentials |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret | Same as above |
| `GOOGLE_REDIRECT_URI` | OAuth callback URL | `https://faithform.io/api/integrations/google/callback` |
| `YOUTUBE_CLIENT_ID` | YouTube OAuth client ID (for live automation) | Google Cloud Console → APIs & Services → Credentials |
| `YOUTUBE_CLIENT_SECRET` | YouTube OAuth client secret | Same as above |
| `YOUTUBE_REDIRECT_URI` | YouTube OAuth callback URL | `https://faithform.io/api/integrations/youtube/callback` |
| `FACEBOOK_APP_ID` | Meta app ID | [Meta for Developers](https://developers.facebook.com) → your app → Settings → Basic |
| `FACEBOOK_APP_SECRET` | Meta app secret | Same as above |
| `FACEBOOK_REDIRECT_URI` | Facebook OAuth callback | `https://faithform.io/api/integrations/facebook/callback` |

The production request validator in `lib/env/production.ts` also requires:

| Variable | Requirement |
|----------|-------------|
| `DONOR_PORTAL_SESSION_SECRET` | Donor session signing; at least 32 characters |
| `RATE_LIMIT_KEY_SECRET` | Rate-limit key signing; at least 32 characters |
| `STREAM_RELAY_PLAYBACK_SECRET` | Relay playback authorization; at least 32 characters |
| `STREAM_INGEST_SIGNING_SECRET` | Browser ingest authorization; at least 32 characters |
| `STREAM_PLAYBACK_SECRET` | Mobile playback authorization; at least 32 characters |
| `CRON_SECRET` | Vercel worker authorization; at least 32 characters |
| `ATTENDANCE_QR_SECRET` | QR, display, pairing and kiosk signing; at least 32 characters |
| `STREAM_HLS_UPSTREAM_URL` | HTTPS relay HLS endpoint |
| `STREAM_WS_INGEST_UPSTREAM_URL` | WSS or HTTPS browser ingest endpoint |
| `STRIPE_SECRET_KEY`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Matching Stripe account/mode; live when accepting real gifts |
| `STRIPE_WEBHOOK_SECRET` | Stripe destination signing secret; at least 32 characters |
| `RESEND_API_KEY` | Transactional email provider key |

`N8N_WEBHOOK_SECRET`, `INTEGRATION_OAUTH_STATE_SECRET`, and
`STREAM_RELAY_WEBHOOK_SECRET` also need at least 32 characters. Give each of the
application signing secrets its own value. `NEXT_PUBLIC_SITE_URL` and
`NEXT_PUBLIC_SUPABASE_URL` must use HTTPS. `STREAM_CHAT_API_KEY` and
`STREAM_CHAT_API_SECRET` are optional together; configuring only one is refused.

Run `pnpm pilot:readiness` with the intended deployment environment available.
It uses the same mandatory checks as production requests and checks optional
push configuration without contacting any provider. A successful check proves
configuration shape, not delivery, payment processing, schema parity or uptime.
Missing required configuration causes production requests to return HTTP 503.

### Optional (automations)

| Variable | What it is |
|----------|------------|
| `SMS_MOBILE_API_KEY` | [SMSMobileAPI](https://smsmobileapi.com/doc/) key for attendance follow-up texts (sent from your connected phone) |
| `SMS_MOBILE_API_DEVICE_SID` | Optional device ID (`sIdentifiant`) for the legacy server-wide SMSMobileAPI phone; church connections save their own device ID in the admin panel |
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_FROM_NUMBER` | Optional Twilio fallback if `SMS_MOBILE_API_KEY` is not set |
| `INTERNAL_ALERT_EMAIL` | Planned for staff alerts |

**Attendance follow-up SMS ops:** Install the SMSMobileAPI app on the church phone, keep it online, and add `SMS_MOBILE_API_KEY` to Vercel. Members need phone numbers on their profiles. Messages escalate (1st miss → template 1, … 5th+ → template 5).

---

## Stripe giving notifications

Successful payments reach the church's Giving dashboard through Stripe webhooks.
Accepting a payment alone does not create a `giving_donations` record.

1. Set `STRIPE_SECRET_KEY` and `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` from the same
   Stripe platform account and mode (live for production).
2. In that platform's live Stripe Workbench, create an event destination for
   **Connected accounts**, using snapshot events, at
   `https://faithform.io/api/webhooks/stripe`. With the webhook endpoint API, use
   `connect: true`. FaithForm creates direct charges on each church's connected
   account, so a destination for the platform's own payments will not receive them.
3. Subscribe to the events handled by `lib/stripe/webhooks.ts`:
   `account.updated`, `capability.updated`, `account.application.deauthorized`,
   `payment_intent.succeeded`, `payment_intent.payment_failed`, `charge.refunded`,
   `invoice.paid`, `invoice.payment_failed`, `customer.subscription.created`,
   `customer.subscription.updated`, `customer.subscription.deleted`,
   `charge.dispute.created`, `charge.dispute.closed`, and `payout.failed`.
4. Save the destination's signing secret as the sensitive production variable
   `STRIPE_WEBHOOK_SECRET`, or add it to the comma-separated
   `STRIPE_WEBHOOK_SECRETS` when retaining an existing destination. Redeploy to
   activate environment changes. Never commit signing secrets.
5. Verify a successful event receives HTTP 200, its `stripe_webhook_events` row
   is `processed`, and exactly one matching payment appears in `giving_donations`
   for the expected church. Refresh Giving and compare the amount and fund.

When switching Stripe platform accounts, recreate the connected-account event
destination and replace its signing secret too. An old account's destination
does not receive the new account's payments. For missed gifts, recover the
original Stripe events through the existing idempotent webhook handler; do not
create another charge or invent donation records from a browser success callback.

Reference: [Stripe Connect webhooks](https://docs.stripe.com/connect/webhooks).

## Supabase Production Setup

### 1. Create a Supabase project

1. Go to [supabase.com](https://supabase.com) and sign in.
2. Click **New project**.
3. Choose an organization, name the project (e.g. `faithform-prod`), set a strong database password, and pick a region close to your users.
4. Wait for the project to finish provisioning.

### 2. Run database migrations

1. Open your project in the Supabase Dashboard.
2. Go to **SQL Editor**.
3. Run each migration file **in filename order** (copy the full file contents, paste, click **Run**):

   | Order | File |
   |-------|------|
   | 1 | `supabase/migrations/0001_schema.sql` |
   | 2 | `supabase/migrations/0002_rls_policies.sql` |
   | 3 | `supabase/migrations/0003_indexes.sql` |
   | 4 | `supabase/migrations/0004_lockdown_helpers.sql` |
   | 5 | `supabase/migrations/0005_announcement_scheduling.sql` |
   | 6 | `supabase/migrations/0006_sermon_builder.sql` |
   | 7+ | Every later migration currently in `supabase/migrations/`, in full filename order (including files with shared legacy prefixes) |

4. Confirm each script completes without errors before running the next.
   For an existing environment, inspect its migration ledger and schema first;
   do not reapply the entire chain blindly. Rehearse the complete current chain
   and restore a backup before production rollout. The historic P12 runbook's
   0055–0063 list is a feature-specific subset, not the current full chain.

   Apply `0129_durable_delivery_and_gift_cancellation.sql` before deploying the
   resumable notification worker and durable recurring-gift cancellation code.
   It adds delivery progress, an audience index, and a server-only cancellation
   queue that survives account deletion. The existing hourly account-deletion
   endpoint drains this queue independently of deletion requests. Monitor its
   cancellation retry counts; provider failures stay queued until they succeed.
   Reverting application code must leave this queue and its pending jobs intact.

### Google & Facebook setup (announcements)

1. **Google Cloud Console**
   - Enable **Google Calendar API** and **Gmail API**
   - Configure OAuth consent screen (add test users while in testing)
   - Create OAuth 2.0 Web client; authorized redirect URI:  
     `https://faithform.io/api/integrations/google/callback`
   - Scopes used: Calendar events, Gmail compose, user email

2. **Meta for Developers**
   - Create an app with **Facebook Login** and **Pages** products
   - Add OAuth redirect:  
     `https://faithform.io/api/integrations/facebook/callback`
   - Permissions: `pages_show_list`, `pages_manage_posts`, `pages_read_engagement`
   - The connecting user must manage at least one Facebook Page

3. In FaithForm **Settings → Integrations**, connect Google then Facebook as a church admin.

### YouTube Live API setup (automation)

1. In Google Cloud Console, enable **YouTube Data API v3** for your production project.
2. Configure OAuth consent screen and add your production domain.
3. Create OAuth web credentials with redirect URI: `https://faithform.io/api/integrations/youtube/callback`.
4. Add `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET`, and `YOUTUBE_REDIRECT_URI` to Vercel env.
5. In FaithForm **Live Streaming**, connect YouTube under Platform API automation.

### Live streaming relay

1. Point `stream.faithform.io` at your relay box and add the three stream env vars above to Vercel.
2. Run the new Supabase migration `0030_stream_relay.sql` (or `pnpm db:stream-relay` with `DATABASE_URL` set).
3. Upload the contents of `infra/stream-relay/` to the relay server and run:

   ```bash
   sudo bash ~/scripts/bootstrap.sh
   ```

4. Add the same `STREAM_RELAY_WEBHOOK_SECRET` value to `/etc/faithform-stream-relay.env` on the relay.
5. In FaithForm **Live Streaming**, connect YouTube/Facebook, schedule services, and copy the watch URL + encoder credentials.

6. Run stream scheduling migrations: `pnpm db:stream-scheduling` (applies `0033`–`0035`).

7. Set `NEXT_PUBLIC_STREAM_HLS_BASE_URL=https://stream.faithform.io:8888` and `STREAM_CRON_SECRET` in Vercel.

8. **Browser studio ingest (WebSocket)** — the relay runs `ws-ingest.py` on port `8090`. Expose it through a stable HTTPS/WSS endpoint and set in Vercel:

   ```bash
   STREAM_WS_INGEST_UPSTREAM_URL=wss://ingest.faithform.io
   STREAM_HLS_UPSTREAM_URL=https://hls.faithform.io
   ```

   Keep tunnel hostnames **one level deep**. Cloudflare's Universal SSL covers
   `faithform.io` and `*.faithform.io` but not `*.stream.faithform.io`, so a
   name like `ingest.stream.faithform.io` resolves to Cloudflare and then fails
   the TLS handshake outright — the browser studio cannot connect at all, with
   no useful error.

   **Named Cloudflare Tunnel (recommended)** — do not rely on ephemeral `trycloudflare.com` URLs after relay restarts:

   1. Install `cloudflared` on the relay box and authenticate: `cloudflared tunnel login`
   2. Create a tunnel: `cloudflared tunnel create faithform-stream`
   3. Route DNS in Cloudflare:
      - `hls.faithform.io` → `http://127.0.0.1:8888`
      - `ingest.faithform.io` → `http://127.0.0.1:8090` (WebSocket upgrade supported)
   4. Run the tunnel as a systemd service so URLs survive reboots.
   5. Update Vercel env vars above and redeploy.

   If you open HLS port `8888` on the relay firewall instead, you can skip the HLS tunnel and keep only the WS ingest tunnel for browser studio.

9. **Scheduled start / syndication retry** — these endpoints are not registered
   in `vercel.json`. Configure an external scheduler or the relay box to call
   `GET https://faithform.io/api/stream/scheduled-start` every two minutes with
   an `Authorization: Bearer <STREAM_CRON_SECRET>` header. The scheduled-start
   handler also retries syndication, so one job covers both. A separate retry
   job can call `GET https://faithform.io/api/stream/syndication/retry` with the
   same header. Query-string secrets are not accepted.

   Alternatively register `/api/stream/scheduled-start` in `vercel.json` at
   `*/2 * * * *` on a hosting plan that supports that frequency. Vercel sends
   `CRON_SECRET`; leave `STREAM_CRON_SECRET` unset so the handler uses that
   fallback. If `STREAM_CRON_SECRET` is set, external callers must use that
   value instead. Verify successful job responses and an actual scheduled start.
   The other workers already registered in `vercel.json` also require a plan
   supporting their configured minute/hour schedules.

   Or run only the sermon migration locally:

   ```bash
   DATABASE_URL="postgresql://postgres.[ref]:[password]@...pooler.supabase.com:6543/postgres" pnpm db:sermon
   ```

### 3. Run the seed file

1. Still in **SQL Editor**, open `supabase/seed/seed.sql`.
2. Paste and run the full file.
3. This creates a test church (**Grace Community Church**) and sample members.

After your first admin signs up via magic link, link them to the seed church:

```sql
insert into public.church_users (church_id, user_id, role)
values (
  '11111111-1111-1111-1111-111111111111',
  '<your-auth-user-uuid>',
  'admin'
);
```

Replace `<your-auth-user-uuid>` with the user's ID from **Authentication → Users**.

### 4. Enable email auth (magic links)

1. Go to **Authentication → Providers → Email**.
2. Enable **Magic Link**.
3. Disable **Email + Password** (FaithForm does not use password login).

### 5. Configure site URL and redirects

1. Go to **Authentication → URL Configuration**.
2. Set **Site URL** to `https://faithform.io`
3. Under **Redirect URLs**, add:
   - `https://faithform.io/auth/callback`

---

## Vercel Deploy Steps

### First-time: push code to GitHub

If the project is not yet in a Git repository:

```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/YOUR_ORG/faithform.git
git push -u origin main
```

### Deploy on Vercel

1. Push the repo to GitHub (if not already there).
2. Go to [vercel.com](https://vercel.com) → **Add New Project** → **Import Git Repository**.
3. Select the FaithForm repository.
4. **Framework preset:** Next.js (auto-detected).
5. **Build command:** `pnpm build`
6. **Install command:** `pnpm install`
7. Add every **required** environment variable from the table above.
8. Click **Deploy**.

### After first deploy

1. Confirm `faithform.io` is the primary domain in **Vercel → Settings → Domains**.
2. Set `NEXT_PUBLIC_SITE_URL` in Vercel to `https://faithform.io` (if not already set).
3. Go back to **Supabase → Authentication → URL Configuration**:
   - Update **Site URL** to `https://faithform.io`.
   - Add **Redirect URLs**: `https://faithform.io/auth/callback`
4. Redeploy if you changed environment variables.

---

## Custom Domain

Production runs at `https://faithform.io`.

1. **Vercel Dashboard** → your project → **Settings → Domains**.
2. Add `faithform.io` and set it as the **primary** production domain.
3. At your domain registrar, add the DNS records Vercel provides (apex `A` records or `CNAME` as instructed).
4. Wait for DNS propagation and Vercel to issue an SSL certificate.
5. Update **Supabase → Authentication → URL Configuration**:
   - **Site URL:** `https://faithform.io`
   - **Redirect URLs:** `https://faithform.io/auth/callback`
6. Update `NEXT_PUBLIC_SITE_URL`, `GOOGLE_REDIRECT_URI`, and `FACEBOOK_REDIRECT_URI` in Vercel to use `https://faithform.io` and redeploy.

---

## GitHub Actions CI (Recommended)

A workflow at `.github/workflows/ci.yml` runs the complete web gate and
dependency audit, native builds/tests, and disposable PostgreSQL migration,
tenant-isolation and concurrency tests on pushes and pull requests to `main`.
The compile jobs use deliberately unusable configuration fixtures. They do not
need production credentials and their success does not prove provider delivery.

---

## Post-Deploy Verification

Run read-only smoke checks after every production deploy. Perform the test
writes below in an explicitly selected staging church/environment; do not use
customer attendance, announcements or real gifts as test fixtures.

- [ ] Visit production URL — loads without error
- [ ] Request magic link login — email arrives within 60 seconds
- [ ] Login redirects to `/dashboard`
- [ ] Dashboard loads church name and stats
- [ ] Attendance page loads member list
- [ ] Submit a test attendance record — confirm DB write in Supabase
- [ ] Announcements page loads
- [ ] Submit a test announcement — confirm status updates in Supabase
- [ ] Sermon builder generates and downloads a `.pptx`
- [ ] Library page loads
- [ ] Logout works and redirects to `/login`

---

## Verify deployed integrations

The repository includes web and mobile sign-in and callback routes. Verify
magic-link delivery, allowed Supabase redirect URLs, sign-in, refresh, and logout
against the deployed environment. Confirm provider event delivery, scheduled
jobs, schema parity, backup restoration and rollback before admitting churches.
A local build or readiness command cannot establish those external results.

Rehearse payment interruption, out-of-order refund/dispute delivery, pause and
resume, and database-write retries with Stripe test-mode accounts. On both
native apps, delay a bootstrap while signing out and switching accounts; the
previous account must never reappear. Revoke a session inside a feature and
confirm private views, snapshots, notification registration and automatic
attendance state are cleared. Exercise automatic attendance with actual device
movement, background execution and battery-saving modes.

Recovery must cover database rows **and uploaded files**. Supabase database
backups contain Storage metadata, not the objects themselves; maintain a
separate copy of required media/images and restore it with a matching database
backup into an isolated target. Verify recovered files are readable and retain
the intended ownership/access rules. Record the tested application revision,
target, backup time, restore result and rollback outcome before launch. See
[Supabase backup limits](https://supabase.com/docs/guides/platform/backups).

Confirm successful worker invocations and a way to notice failed or stalled
payment, notification, deletion and messaging jobs. The public mobile health
endpoint reports API reachability/version only; it does not query the database
or establish worker/provider health. Minute/hour cron expressions require a
hosting plan that supports them; see
[Vercel cron restrictions](https://vercel.com/docs/cron-jobs/manage-cron-jobs).

---

## Local Development Reference

Copy `.env.example` to `.env.local` and fill in values. Runtime accepts the modern
Supabase publishable/secret names and the legacy anon/service-role aliases.

```bash
pnpm install
pnpm dev      # http://localhost:3000
pnpm lint
pnpm build
```
