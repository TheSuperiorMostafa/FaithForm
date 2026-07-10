# FaithForm — Production Deployment Guide

FaithForm is a Next.js 14 church management app backed by Supabase. This guide walks through deploying to Vercel and configuring Supabase for production.

**Stack:** Next.js (App Router) · Supabase (Postgres + Auth) · Vercel · pnpm

---

## Environment Variables

Set these in **Vercel → Project → Settings → Environment Variables** (and in GitHub Actions secrets if using CI). Use the **exact variable names** below — they match what the application code reads.

### Required

| Variable | What it is | Where to get it |
|----------|------------|-----------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL | [Supabase Dashboard](https://supabase.com/dashboard) → your project → **Settings → API** → Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase public (anon) key — safe to expose in the browser | Same page → **Project API keys** → `anon` / publishable key |
| `SUPABASE_SECRET_KEY` | Supabase secret key — server-only; required for reading OAuth tokens and calendar sync | Same page → **secret** key (also accepts `SUPABASE_SERVICE_ROLE_KEY`) |
| `ANTHROPIC_API_KEY` | Claude API key for sermon builder | [console.anthropic.com](https://console.anthropic.com) → API Keys |
| `ESV_API_KEY` | ESV Bible API key for sermon scripture lookup | [api.esv.org](https://api.esv.org) → Account → API Key |
| `N8N_WEBHOOK_SECRET` | Shared secret for n8n webhook calls (attendance) and OAuth state signing | Generate a long random string |
| `INTEGRATION_OAUTH_STATE_SECRET` | Signs Google/Facebook OAuth state (optional; falls back to `N8N_WEBHOOK_SECRET`) | Long random string |
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

### Optional (automations)

| Variable | What it is |
|----------|------------|
| `SMS_MOBILE_API_KEY` | [SMSMobileAPI](https://smsmobileapi.com/doc/) key for attendance follow-up texts (sent from your connected phone) |
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_FROM_NUMBER` | Optional Twilio fallback if `SMS_MOBILE_API_KEY` is not set |
| `RESEND_API_KEY` | Transactional email (onboarding invites) |
| `INTERNAL_ALERT_EMAIL` | Planned for staff alerts |

**Attendance follow-up SMS ops:** Install the SMSMobileAPI app on the church phone, keep it online, and add `SMS_MOBILE_API_KEY` to Vercel. Members need phone numbers on their profiles. Messages escalate (1st miss → template 1, … 5th+ → template 5).

---

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
   | 7+ | Any later migrations through `0010_integration_status_rpc.sql` |

4. Confirm each script completes without errors before running the next.

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
   STREAM_WS_INGEST_UPSTREAM_URL=wss://ingest.stream.faithform.io
   STREAM_HLS_UPSTREAM_URL=https://hls.stream.faithform.io
   ```

   **Named Cloudflare Tunnel (recommended)** — do not rely on ephemeral `trycloudflare.com` URLs after relay restarts:

   1. Install `cloudflared` on the relay box and authenticate: `cloudflared tunnel login`
   2. Create a tunnel: `cloudflared tunnel create faithform-stream`
   3. Route DNS in Cloudflare:
      - `hls.stream.faithform.io` → `http://127.0.0.1:8888`
      - `ingest.stream.faithform.io` → `http://127.0.0.1:8090` (WebSocket upgrade supported)
   4. Run the tunnel as a systemd service so URLs survive reboots.
   5. Update Vercel env vars above and redeploy.

   If you open HLS port `8888` on the relay firewall instead, you can skip the HLS tunnel and keep only the WS ingest tunnel for browser studio.

9. **Scheduled start / syndication retry** — Vercel Hobby allows only daily crons, so poll these endpoints every 2 minutes from an external cron (e.g. cron-job.org) or the relay box:

   - `GET https://faithform.io/api/stream/scheduled-start?secret=YOUR_STREAM_CRON_SECRET`
   - `GET https://faithform.io/api/stream/syndication/retry?secret=YOUR_STREAM_CRON_SECRET`

   Or upgrade to Vercel Pro and add both paths to `vercel.json` crons at `*/2 * * * *`.

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

A workflow at `.github/workflows/ci.yml` runs `pnpm lint` and `pnpm build` on every push and pull request to `main`.

### Add GitHub secrets

Go to your repo → **Settings → Secrets and variables → Actions → New repository secret** and add:

| Secret name | Value |
|-------------|-------|
| `NEXT_PUBLIC_SUPABASE_URL` | Same as Vercel |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Same as Vercel |
| `SUPABASE_SECRET_KEY` | Same as Vercel |
| `ANTHROPIC_API_KEY` | Same as Vercel |
| `ESV_API_KEY` | Same as Vercel |
| `N8N_WEBHOOK_SECRET` | Same as Vercel |

---

## Post-Deploy Verification

Run through these checks after every production deploy:

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

## Known Gaps

Before running the full smoke test, be aware of these items in the current codebase:

1. **Login page is a placeholder** — `app/login/page.tsx` does not yet render the magic-link form. Magic-link login must be restored before the auth smoke tests pass.
2. **No auth callback route** — `app/auth/callback` is not present. Supabase magic-link redirects require this route; add it before testing login end-to-end.
3. **`.env.example` naming drift** — `.env.example` uses `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` and `SUPABASE_SECRET_KEY`, while runtime code expects `NEXT_PUBLIC_SUPABASE_ANON_KEY` for the public key. Use the names in the **Required** table above when configuring Vercel and local `.env.local`.

---

## Local Development Reference

Copy `.env.example` to `.env.local` and fill in values using the variable names from the **Required** table (not the publishable-key alias in `.env.example` unless you align the code).

```bash
pnpm install
pnpm dev      # http://localhost:3000
pnpm lint
pnpm build
```
