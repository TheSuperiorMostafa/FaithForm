# FaithForm Context

## 1. Project Overview

- FaithForm is a church operations web app. It helps a church team track weekly attendance, manage announcements, measure automation time savings, generate sermon materials, and download operational reports.
- The app is built around a multi-tenant church model: authenticated users are linked to churches through `church_users`, and almost every dashboard feature is scoped to the current church.
- The problem it solves is reducing manual ministry administration across attendance, announcements, reports, social/email publishing, and sermon prep.
- Target users appear to be church staff, administrators, pastors, ministry coordinators, and possibly church volunteers with dashboard access.
- Current status:
  - Built: Supabase login, dashboard shell, attendance flow, announcements calendar/publish flow, sermon builder, library/report downloads, Google/Facebook integration settings, and Supabase SQL migrations.
  - In progress or incomplete: support route is listed in navigation but no `/dashboard/support` route exists; webhook routes validate/log payloads but contain TODOs for n8n forwarding; docs in `DEPLOY.md` contain stale known-gaps notes that no longer match the current login/callback files; no app test suite is present.

## 2. Tech Stack

- Frontend framework: Next.js 14 App Router, React 18, TypeScript.
- UI and styling:
  - Tailwind CSS with CSS-variable theming.
  - `tailwindcss-animate`, `tw-animate-css`, `tailwind-merge`, `clsx`, `class-variance-authority`.
  - shadcn-style component patterns under `components/ui`.
  - Base UI (`@base-ui/react`) for some primitives.
  - Lucide icons and Recharts for dashboard charts.
- Backend/runtime:
  - Next.js Server Components, Server Actions, Route Handlers, and middleware.
  - Runtime target is the standard Next.js Node/Vercel environment.
- Database and query layer:
  - Supabase Postgres.
  - Direct Supabase client queries via `@supabase/supabase-js` and `@supabase/ssr`.
  - No Prisma schema or ORM found.
- Auth:
  - Supabase Auth with SSR cookie handling.
  - Magic-link login and password login are both implemented in `app/login/actions.ts`.
  - Middleware protects `/dashboard` routes and refreshes the Supabase session.
- External APIs and third-party services:
  - Supabase Auth/Postgres/RLS.
  - Vercel deployment assumptions and `VERCEL_URL` fallback.
  - Anthropic and OpenAI through the Vercel AI SDK for sermon generation.
  - Google OAuth, Calendar, and Gmail draft creation.
  - Facebook Graph API for Page posting.
  - ESV API for scripture lookup, with a public Bible API fallback in code.
  - n8n is referenced through webhook shared-secret handling, but actual forwarding is not fully wired.
- Dev tooling:
  - Package manager: pnpm.
  - Scripts: `pnpm dev`, `pnpm build`, `pnpm start`, `pnpm lint`, `pnpm db:sermon`.
  - TypeScript strict mode with `@/*` path alias.
  - Tailwind and PostCSS configs are present.
  - GitHub Actions CI runs install, lint, and build.
  - No root test framework config or test files were found.
  - No root ESLint config file was found, although `next lint` is configured.

## 3. Architecture

- The app uses the Next.js App Router under `app`.
- Frontend/backend communication happens through:
  - Server Components that query Supabase directly on the server.
  - Server Actions for form submissions and mutations.
  - Route Handlers under `app/api` for integrations, reports, scripture lookup, webhook endpoints, and sermon generation/export APIs.
- Persistent state lives primarily in Supabase. There is no global client state library such as Redux or Zustand.
- Client-side state is local to interactive components such as forms, dialogs, calendars, tabs, theme toggles, sermon editors, and wizard screens.
- UI preferences use cookies in places, such as sidebar collapsed state and theme.
- Auth flow:
  - `middleware.ts` calls `lib/supabase/middleware.ts` to refresh auth cookies and redirect unauthenticated dashboard requests to `/login`.
  - `app/login/page.tsx` renders the login form.
  - `app/login/actions.ts` sends Supabase magic links and supports password sign-in.
  - `app/auth/callback/route.ts` exchanges Supabase auth codes for a session and redirects to `/dashboard` by default.
  - `app/auth/signout/route.ts` signs the user out and redirects to `/login`.
  - `lib/auth/church.ts` resolves the current church and role through `church_users`.
- Authorization model:
  - SQL RLS policies use `user_church_ids()` and `is_church_admin()`.
  - Most records carry `church_id`.
  - The database role check in `0001_schema.sql` allows `admin` and `viewer`; `lib/auth/church.ts` also treats `owner` as admin, which does not match the current table check.
- Notable patterns:
  - Feature routes are grouped under `app/dashboard`.
  - Feature UI is grouped under `components/<feature>`.
  - Data access helpers live under `lib/queries`.
  - External integrations live under `lib/integrations`.
  - Supabase client factories live under `lib/supabase`.
  - Database changes are SQL migrations in `supabase/migrations`.

## 4. Project Structure

- `app/`: Next.js App Router source.
  - `app/page.tsx`: root redirect logic; handles auth code redirects that land on the site root.
  - `app/login`: login page, form, and server actions.
  - `app/auth`: Supabase callback and signout routes.
  - `app/dashboard`: authenticated dashboard pages and colocated server actions.
  - `app/api`: route handlers for integrations, webhooks, reports, scripture, and sermon generation/export.
- `components/`: React components grouped by feature.
  - `components/dashboard`: dashboard shell, nav, cards, charts, skeletons.
  - `components/announcements`: calendar, verify dialog/form, published list.
  - `components/sermon-builder`: sermon list, editor, wizard, exports, series planning, social/discussion views.
  - `components/settings`: integrations and AI settings forms.
  - `components/library`: PDF report document components.
  - `components/ui`: reusable UI primitives.
  - `components/brand`, `components/theme-*`: branding and theme controls.
- `lib/`: server/client utilities and domain logic.
  - `lib/supabase`: browser/server/admin clients and middleware.
  - `lib/auth`: current church auth helper.
  - `lib/queries`: dashboard, attendance, announcements, sermons, and library queries.
  - `lib/integrations`: Google, Gmail, Facebook, OAuth state, token/status helpers, app URL handling.
  - `lib/ai`: AI provider selection, prompts, schemas, JSON repair.
  - `lib/sermon`, `lib/sermon-builder`: sermon generation/export utilities and older sermon builder helpers.
  - `lib/scripture`, `lib/bible`: scripture lookup and rendering helpers.
  - `lib/reports`, `lib/utils`: report auth, dates, calendar helpers, formatting, shared utilities.
- `supabase/`: Supabase project files.
  - `supabase/migrations`: SQL schema, RLS, indexes, feature migrations, integration RPCs.
  - `supabase/seed/seed.sql`: seed church and members.
  - `supabase/config.toml`: local Supabase project metadata.
- `scripts/`: utility scripts. Currently includes `apply-sermon-migration.mjs`.
- `types/`: shared TypeScript domain types. `types/sermon.ts` defines sermon-related shapes.
- `n8n/`: currently contains only a placeholder `.gitkeep`.
- `public/`: present but no files were found.
- `.github/workflows/ci.yml`: CI workflow.
- Generated/local folders such as `.next` and `node_modules` exist locally and should not be treated as source.

## 5. Key Features

- Authentication:
  - Supabase magic-link login.
  - Supabase password login.
  - Auth callback and signout routes.
  - Dashboard protection through middleware and layout checks.
- Dashboard:
  - Hours-saved hero metric.
  - Stat row for operational metrics.
  - Weekly inputs/quick actions.
  - Attendance chart and range parsing.
- Attendance:
  - Last eight Sundays list.
  - Attendance record detail by service date.
  - Member attendance entries with present/absent status.
  - Follow-up requested tracking.
  - Member add flow.
  - Activity logging and internal webhook call after attendance submission.
- Announcements:
  - Google Calendar month view.
  - Announcement verification/editing.
  - Publish tracking.
  - Google Calendar event association.
  - Gmail draft ID tracking.
  - Facebook post ID tracking.
  - Published announcements list.
- Sermon Builder:
  - Simple mode for scripture slide decks and themed PowerPoint exports.
  - Advanced mode for outlines, drafts, discussion questions, social snippets, and exports.
  - Sermon series planning.
  - PDF and PPTX export routes.
  - AI provider/settings support per church.
- Library:
  - Monthly attendance report downloads.
  - Monthly time-saved report downloads.
  - Support/help cards; at least one support video card is placeholder-like.
- Settings:
  - Google and Facebook integration connection status/actions.
  - AI provider, model override, translation, preaching style, denomination, and sermon builder mode preferences.
- Partially built or notable gaps:
  - `/dashboard/support` appears in `components/dashboard/nav-items.ts` but no matching page exists.
  - Webhook endpoints for attendance and announcements check `N8N_WEBHOOK_SECRET` and log/accept payloads, but forwarding to n8n is marked as TODO or otherwise unclear.
  - `components/dashboard/quick-actions.tsx` appears to be superseded by `quick-actions-section.tsx`.

## 6. Data Models

Main schema source: `supabase/migrations`.

- `churches`
  - Tenant root entity.
  - Fields include `name`, `timezone`, and later `google_calendar_id`.
- `church_users`
  - Joins Supabase `auth.users` to a church.
  - Includes `role`.
  - Current SQL check allows `admin` and `viewer`.
- `members`
  - Church member records with name, phone, email, photo URL, and active flag.
  - Belongs to a church.
- `attendance_records`
  - One service attendance record per church/date.
  - Stores service date, submitted timestamp, totals, and notes.
- `attendance_entries`
  - Per-member attendance rows tied to an `attendance_record`.
  - Stores `present`/`absent` and `follow_up_requested`.
- `announcements`
  - Announcement/event records scoped to a church.
  - Initial fields include event title/date/location, push flags, notes, and status.
  - Later migrations add `title`, `body`, scheduling fields, Google/Facebook/Gmail IDs, publish metadata, and errors.
- `activity_log`
  - Tracks automation type/category/task/time saved and execution source/time.
  - Used by dashboard and time-saved reporting.
- `phone_calls`
  - Stores call metadata such as caller number, call type, duration, outcome, sentiment, score, transcript URL, notes, and call timestamp.
- `weekly_inputs`
  - Weekly manual inputs with follow-up and phone-call counts.
  - Appears to support dashboard metrics.
- `attendance`
  - A simpler church/date/count table added separately from detailed `attendance_records`.
  - Appears to support earlier or alternate dashboard metrics.
- `church_metrics`
  - Stores monthly hours saved by church.
- `church_settings`
  - Per-church AI and sermon settings.
  - Includes AI provider, model override, default translation, preaching style, denomination, and sermon builder mode.
- `sermon_series`
  - Sermon series with title, theme, description, planned week count, and JSON plan.
- `sermons`
  - Sermon or slide-deck records.
  - Includes church, creator, optional series, scripture refs, topic, audience, duration, style notes, status, kind, theme, translation, outline/content JSON, and model used.
- `sermon_assets`
  - Generated or exported assets associated with sermons.
  - Asset kinds include discussion questions, social snippets, PDF exports, and PPTX exports.
- `church_integrations`
  - OAuth tokens for Google and Facebook per church.
  - Stores access/refresh tokens, expiry, metadata, connected user, and timestamps.
  - RLS restricts visibility to church admins, but server-side admin helpers are used where token access is required.
- RPC/helper functions:
  - `user_church_ids()` returns churches for the current authenticated user.
  - `is_church_admin(target_church_id)` checks admin role.
  - `get_church_integration_status(...)` exposes connection status.
  - `get_church_integration_tokens(...)` exposes integration tokens for server/admin flows.
- Seed data:
  - `supabase/seed/seed.sql` creates a sample "Grace Community Church" and sample members.
  - A new Supabase Auth user must be manually linked to the seed church via `church_users`.

## 7. Environment & Configuration

Environment variables referenced by source or documented config:

- `NEXT_PUBLIC_SUPABASE_URL`: Supabase project URL.
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`: Supabase public anon key used by browser/server SSR clients.
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`: alternate public Supabase key supported by the code and shown in `.env.example`.
- `SUPABASE_SECRET_KEY`: server-only Supabase admin/secret key.
- `SUPABASE_SERVICE_ROLE_KEY`: fallback server-only Supabase service role key.
- `NEXT_PUBLIC_SITE_URL`: canonical app URL for auth redirects and integration callback defaults.
- `VERCEL_URL`: Vercel deployment URL fallback for redirects.
- `N8N_WEBHOOK_SECRET`: shared secret for webhook routes and fallback OAuth state signing.
- `INTEGRATION_OAUTH_STATE_SECRET`: HMAC secret for Google/Facebook OAuth state.
- `GOOGLE_CLIENT_ID`: Google OAuth client ID.
- `GOOGLE_CLIENT_SECRET`: Google OAuth client secret.
- `GOOGLE_REDIRECT_URI`: Google OAuth callback URL.
- `FACEBOOK_APP_ID`: Meta/Facebook app ID.
- `FACEBOOK_APP_SECRET`: Meta/Facebook app secret.
- `FACEBOOK_REDIRECT_URI`: Facebook OAuth callback URL.
- `ANTHROPIC_API_KEY`: Anthropic API key for sermon AI generation.
- `OPENAI_API_KEY`: OpenAI API key for sermon AI generation.
- `ANTHROPIC_MODEL`: optional Anthropic model override.
- `OPENAI_MODEL`: optional OpenAI model override.
- `ESV_API_KEY`: ESV scripture API key.
- `DATABASE_URL`: Postgres connection string used by `pnpm db:sermon`.
- `SUPABASE_DB_URL`: alternate Postgres connection string for `pnpm db:sermon`.

Important config files:

- `.env.example`: sample environment variable names.
- `package.json`: scripts and dependencies.
- `pnpm-lock.yaml`: locked dependency graph.
- `tsconfig.json`: strict TypeScript, App Router types, `@/*` alias.
- `next.config.mjs`: currently empty Next config.
- `tailwind.config.ts`: Tailwind content globs, dark mode, theme tokens, animation plugin.
- `postcss.config.mjs`: Tailwind PostCSS plugin.
- `supabase/config.toml`: Supabase local project ID and Postgres version.
- `.github/workflows/ci.yml`: CI install/lint/build workflow.
- `DEPLOY.md`: production deployment instructions, but its "Known Gaps" section is partially stale relative to current source.

## 8. Getting Started

1. Install dependencies:

   ```bash
   pnpm install
   ```

2. Create local environment config:

   ```bash
   cp .env.example .env.local
   ```

   Fill in Supabase, auth, integration, and AI variables as needed. Do not commit real secrets.

3. Set up Supabase:
   - Create a Supabase project.
   - Run migrations in `supabase/migrations` in filename order.
   - Optionally run `supabase/seed/seed.sql` to create the Grace Community Church sample data.
   - After creating a Supabase Auth user, link that user to a church in `church_users`.

4. Run the app locally:

   ```bash
   pnpm dev
   ```

   The app expects to run at `http://localhost:3000` unless `NEXT_PUBLIC_SITE_URL` says otherwise.

5. Useful checks:

   ```bash
   pnpm lint
   pnpm build
   ```

6. Sermon-specific migration helper:

   ```bash
   DATABASE_URL="postgresql://..." pnpm db:sermon
   ```

   This applies `0006_sermon_builder.sql` and `0008_simple_sermon_mode.sql` only. For a full setup, run all migrations in order.

## 9. Roadmap / Known Issues

- Build or remove `/dashboard/support`; it is in navigation but has no route.
- Complete n8n forwarding or clarify the webhook architecture. Current webhook routes validate secrets and accept/log payloads, but the automation handoff is incomplete or unclear.
- Add an app test strategy. No Vitest, Jest, Playwright, or test files were found.
- Add or verify ESLint config. `pnpm lint` uses `next lint`, but no root ESLint config file was found.
- Reconcile docs drift:
  - `DEPLOY.md` says login/callback are missing, but `app/login` and `app/auth/callback/route.ts` exist.
  - `DEPLOY.md` says password login is not used, but the current login form includes password mode.
  - `DEPLOY.md` warns about Supabase key naming drift, while the current code supports both `NEXT_PUBLIC_SUPABASE_ANON_KEY` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
- Reconcile role drift. `lib/auth/church.ts` treats `owner` as admin, but the current SQL check only allows `admin` and `viewer`.
- Clarify the relationship between `attendance_records`/`attendance_entries` and the simpler `attendance` table.
- Review generated/local files before committing. `.next` and `node_modules` are present locally and should stay uncommitted.
- Consider documenting local Supabase CLI workflow if the team uses one; current setup instructions are mostly manual SQL from `DEPLOY.md`.
