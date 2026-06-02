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
| `NEXT_PUBLIC_SITE_URL` | Public URL of the deployed app (no trailing slash) | Your Vercel production URL, e.g. `https://faithform.vercel.app` |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID | [Google Cloud Console](https://console.cloud.google.com) → APIs & Services → Credentials |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret | Same as above |
| `GOOGLE_REDIRECT_URI` | OAuth callback URL | `https://your-app.vercel.app/api/integrations/google/callback` |
| `FACEBOOK_APP_ID` | Meta app ID | [Meta for Developers](https://developers.facebook.com) → your app → Settings → Basic |
| `FACEBOOK_APP_SECRET` | Meta app secret | Same as above |
| `FACEBOOK_REDIRECT_URI` | Facebook OAuth callback | `https://your-app.vercel.app/api/integrations/facebook/callback` |

### Optional (automations)

| Variable | What it is |
|----------|------------|
| `N8N_ATTENDANCE_WEBHOOK_URL` | n8n Webhook trigger URL for attendance follow-up SMS (import `n8n/attendance-follow-up.json`) |
| `SMS_MOBILE_API_URL` / `SMS_MOBILE_API_KEY` | SMS provider credentials (configure in n8n, not in the Next.js app) |
| `RESEND_API_KEY` | Planned for transactional email |
| `INTERNAL_ALERT_EMAIL` | Planned for staff alerts |

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
     `https://your-app.vercel.app/api/integrations/google/callback`
   - Scopes used: Calendar events, Gmail compose, user email

2. **Meta for Developers**
   - Create an app with **Facebook Login** and **Pages** products
   - Add OAuth redirect:  
     `https://your-app.vercel.app/api/integrations/facebook/callback`
   - Permissions: `pages_show_list`, `pages_manage_posts`, `pages_read_engagement`
   - The connecting user must manage at least one Facebook Page

3. In FaithForm **Settings → Integrations**, connect Google then Facebook as a church admin.

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
2. Set **Site URL** to your Vercel production URL, e.g. `https://faithform.vercel.app`
3. Under **Redirect URLs**, add:
   - `https://faithform.vercel.app/auth/callback`

> After your first Vercel deploy, return here and update these URLs to match your actual production domain (see [Vercel Deploy Steps](#vercel-deploy-steps) below).

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

1. Copy the production URL (e.g. `https://faithform.vercel.app`).
2. Set `NEXT_PUBLIC_SITE_URL` in Vercel to that URL (if not already set).
3. Go back to **Supabase → Authentication → URL Configuration**:
   - Update **Site URL** to the production Vercel URL.
   - Add the production URL to **Redirect URLs**: `https://your-vercel-domain.vercel.app/auth/callback`
4. Redeploy if you changed environment variables.

---

## Custom Domain (Optional)

If you want a custom domain (e.g. `app.faithform.io`):

1. **Vercel Dashboard** → your project → **Settings → Domains**.
2. Add your domain (e.g. `app.faithform.io`).
3. At your domain registrar, add a **CNAME** record pointing to `cname.vercel-dns.com`.
4. Wait for DNS propagation and Vercel to issue an SSL certificate.
5. Update **Supabase → Authentication → URL Configuration**:
   - **Site URL:** `https://app.faithform.io`
   - **Redirect URLs:** `https://app.faithform.io/auth/callback`
6. Update `NEXT_PUBLIC_SITE_URL` in Vercel to `https://app.faithform.io` and redeploy.

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
