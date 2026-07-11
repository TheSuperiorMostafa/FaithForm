# Executive Summary

| Item | Value |
|------|-------|
| **Overall risk rating** | **HIGH** |
| **Safe to deliver to first customer today?** | **ONLY AFTER CRITICAL FIXES** |
| **Critical findings** | 4 |
| **High findings** | 11 |
| **Medium findings** | 12 |
| **Low findings** | 6 |
| **Informational findings** | 5 |

FaithForm is a Next.js 14 + Supabase multi-tenant church operations platform. The foundation is reasonable: Supabase Auth with cookie sessions, broad Postgres RLS on tenant tables, Stripe webhook signature verification, and HMAC-signed OAuth state. However, several paths bypass tenant and role controls in ways that would expose real customer data or allow financial abuse before launch.

### Five most urgent issues

1. **Forged donor portal sessions** — `ff_donor_session` cookie payload is unsigned base64 JSON; an attacker who learns UUIDs can impersonate any donor and access statements, subscriptions, and payment APIs.
2. **Unauthenticated Retell webhook** — `/api/webhooks/retell` accepts arbitrary POST bodies and writes `phone_calls` / activity logs using attacker-controlled `church_id` metadata via the service-role client.
3. **Cross-tenant storage tampering** — Supabase storage policies allow any authenticated user to update/delete any object in the public `church-logos` bucket (no folder ownership check).
4. **Cross-tenant member PII via attendance** — Attendance submission does not verify `member_id` belongs to the church; follow-up SMS loads member phone numbers without `church_id` filter via admin client.
5. **Viewer role can refund gifts and export donor PII** — Financial refund API and full CSV export require only church membership, not admin role.

---

# Architecture and Attack Surface

## Technologies used

| Layer | Technology |
|-------|------------|
| Frontend / API | Next.js 14.2.35 (App Router), React 18, Server Actions |
| Auth | Supabase Auth (`@supabase/ssr`), magic link + password |
| Database | Supabase Postgres with RLS |
| Storage | Supabase Storage (public buckets: `church-logos`, `social-graphics`, `sermon-themes`, `social-backgrounds`; private: `bible-text`) |
| Payments | Stripe Connect (PaymentIntents, subscriptions, billing portal) |
| Email | Resend |
| SMS | Twilio (attendance follow-up) |
| AI | Anthropic / OpenAI via Vercel AI SDK |
| Voice | Retell AI webhooks |
| Integrations | Google OAuth (Calendar/Gmail), Facebook Pages |
| Automation | n8n webhooks (`x-faithform-secret`) |
| Deployment | Vercel (`vercel.json`) |

## Authentication model

- **Staff/dashboard users:** Supabase session cookies refreshed in `middleware.ts` → `lib/supabase/middleware.ts`.
- **Donor portal users:** Magic link (hashed token in `donor_portal_sessions`) → **unsigned** session cookie (`lib/giving/portal-session.ts`).
- **Platform super-admin:** `/admin` routes check `platform_admins` table OR hardcoded bootstrap email (`lib/auth/superadmin-emails.ts`).
- **Public giving:** Unauthenticated; church identified by URL slug.
- **Webhooks:** Stripe (signature), n8n (shared secret header), Retell (**no verification**).

## Authorization model

- **Roles:** `admin` and `viewer` in DB (`church_users.role` CHECK constraint); app also references non-existent `owner` role.
- **Church context:** `getChurchAuth()` / `getCurrentChurchId()` — first `church_users` row with `.limit(1)` (unordered).
- **RLS helpers:** `user_church_ids()`, `is_church_admin()` (admin-only writes on members, announcements, integrations).
- **Service role:** Used extensively for giving, onboarding, webhooks, activity logging — app must enforce tenant boundaries.

## Multi-tenant model

- **Tenant key:** `church_id` (UUID on `churches` and child tables).
- **Isolation mechanism:** Postgres RLS on most tables + application-level `church_id` filters in server routes.
- **Gaps:** Storage policies, unsigned donor cookies, webhook handlers using service role without tenant validation, admin-client queries without `church_id`.

## Database

- Migrations in `supabase/migrations/` (38+ files).
- RLS enabled on tenant tables; service-role-only tables: `church_invites`, `donor_portal_sessions`, `stripe_webhook_events`.
- No Prisma; queries via `@supabase/supabase-js`.

## Storage

- Church logos and social graphics in **public** buckets with weak write/update/delete policies.
- Bible text in private bucket; server-side admin reads only.

## External integrations

Stripe, Retell, Twilio, Resend, Google OAuth, Facebook Graph API, n8n automation webhooks, Anthropic/OpenAI.

## Public entry points

- `/give/[slug]/*` — public giving and donor portal
- `/login`, `/onboarding?token=…`
- 48 API routes under `app/api/` (middleware does **not** enforce auth on `/api/*`)
- Webhook endpoints (Stripe, Retell, n8n)
- OAuth callbacks (`/api/integrations/*/callback`)

---

# Findings

## [CRITICAL] Unsigned donor portal session cookie allows session forgery

- **Severity:** Critical
- **Confidence:** Confirmed
- **CWE / OWASP:** CWE-345 (Insufficient Verification of Data Authenticity), OWASP A07:2021 Identification and Authentication Failures
- **Affected files:** `lib/giving/portal-session.ts` lines 68–82, 90–119
- **Affected endpoints:** `/api/give/portal/create-intent`, `create-subscription`, `setup-intent`, `statement`, `subscription`, `sign-out`
- **Evidence:**

```68:82:lib/giving/portal-session.ts
  const sessionToken = generatePortalToken();
  const sessionPayload = JSON.stringify({
    churchId: session.church_id,
    donorId: session.donor_id,
    exp: Date.now() + SESSION_TTL_MS,
  });

  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, `${sessionToken}.${Buffer.from(sessionPayload).toString("base64url")}`, {
```

`getDonorPortalSession` parses the base64 payload and trusts `churchId`/`donorId` after only a slug lookup. The leading `sessionToken` is never validated against any server-side record.

- **Attack scenario:** Attacker obtains or guesses `churchId` and `donorId` UUIDs (from URLs, leaks, enumeration). They craft `ff_donor_session` cookie value `anything.<base64url({"churchId":"…","donorId":"…","exp":…})>` and call portal APIs to view giving statements, manage subscriptions, or create payments attributed to the victim donor.
- **Customer impact:** Unauthorized access to donor giving history, subscription cancellation/modification, fraudulent gifts in victim's name.
- **Reproduction:** Set forged cookie on `/give/{slug}/portal` path; POST to `/api/give/portal/statement?slug={slug}`.
- **Recommended fix:** Sign session payload with HMAC-SHA256 using a server secret, or store session token server-side and validate on each request.
- **Suggested patch:**

```typescript
// lib/giving/portal-session.ts
import { createHmac, timingSafeEqual } from "crypto";

const SESSION_SECRET = process.env.DONOR_PORTAL_SESSION_SECRET!;

function signPayload(payloadB64: string): string {
  return createHmac("sha256", SESSION_SECRET).update(payloadB64).digest("base64url");
}

function verifySignedCookie(raw: string): { churchId: string; donorId: string; exp: number } | null {
  const dot = raw.indexOf(".");
  if (dot < 0) return null;
  const sig = raw.slice(0, dot);
  const payloadB64 = raw.slice(dot + 1);
  const expected = signPayload(payloadB64);
  try {
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  } catch { return null; }
  const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
  if (payload.exp < Date.now()) return null;
  return payload;
}
```

- **Tests required:** Unit test forgery rejected; valid signed cookie accepted; expired cookie rejected.
- **Secrets rotation:** Set new `DONOR_PORTAL_SESSION_SECRET`; existing sessions invalidated (acceptable).

---

## [CRITICAL] Unauthenticated Retell webhook with attacker-controlled tenant ID

- **Severity:** Critical
- **Confidence:** Confirmed
- **CWE / OWASP:** CWE-306 (Missing Authentication for Critical Function), OWASP A01:2021 Broken Access Control
- **Affected files:** `app/api/webhooks/retell/route.ts` lines 12–29; `lib/integrations/retell-calls.ts` lines 31–37, 91–97
- **Affected endpoint:** `POST /api/webhooks/retell`, `POST /api/webhooks/retail-ai`
- **Evidence:**

```12:29:app/api/webhooks/retell/route.ts
export async function POST(request: Request) {
  let body: RetellWebhookPayload;
  try {
    body = (await request.json()) as RetellWebhookPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  // No signature, API key, or IP validation
  const result = await upsertPhoneCallFromRetell(body.call);
```

```31:37:lib/integrations/retell-calls.ts
function readChurchIdFromCall(call: RetellCallPayload): string | null {
  const metadataId = call.metadata?.church_id;
  if (typeof metadataId === "string" && metadataId) return metadataId;
  const dynamicId = call.retell_llm_dynamic_variables?.church_id;
  if (dynamicId) return dynamicId;
```

Writes use `createAdminClient()` bypassing RLS.

- **Attack scenario:** Attacker POSTs fake `call_ended` events with arbitrary `metadata.church_id`, injecting fake phone call records, transcripts, and activity log entries into any church's dashboard.
- **Customer impact:** Data integrity corruption, false analytics, potential exposure of fabricated PII in exports.
- **Reproduction:** `curl -X POST https://{app}/api/webhooks/retell -H 'Content-Type: application/json' -d '{"event":"call_ended","call":{"call_id":"fake-1","metadata":{"church_id":"<victim-uuid>"},"transcript":"injected"}}'`
- **Recommended fix:** Verify Retell webhook signature per their docs; prefer resolving `church_id` only from `agent_id` → `voice_assistant_settings` mapping, never from unauthenticated metadata alone.
- **Suggested patch:**

```typescript
// app/api/webhooks/retell/route.ts
const signature = request.headers.get("x-retell-signature");
if (!verifyRetellSignature(rawBody, signature)) {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}
// lib/integrations/retell-calls.ts — remove readChurchIdFromCall metadata path or require signature + agent_id match
```

- **Tests required:** Reject unsigned requests; accept valid Retell signatures; reject metadata-only church_id without matching agent_id.
- **Secrets rotation:** Configure Retell webhook signing secret in production.

---

## [CRITICAL] Cross-tenant church logo storage tampering

- **Severity:** Critical
- **Confidence:** Confirmed
- **CWE / OWASP:** CWE-284 (Improper Access Control), OWASP A01:2021 Broken Access Control
- **Affected files:** `supabase/migrations/0015_onboarding.sql` lines 87–96
- **Affected bucket:** `church-logos` (public read)
- **Evidence:**

```87:96:supabase/migrations/0015_onboarding.sql
create policy "Authenticated users can update church logos"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'church-logos')
  with check (bucket_id = 'church-logos');

create policy "Authenticated users can delete church logos"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'church-logos');
```

INSERT only requires a folder name, not ownership. Any authenticated FaithForm user (any church) can overwrite `{otherChurchId}/logo.png`.

- **Attack scenario:** Malicious staff member at Church A replaces Church B's public logo with offensive or phishing imagery displayed on Church B's giving page.
- **Customer impact:** Brand damage, phishing, reputational harm.
- **Reproduction:** As authenticated user from Church A, call Supabase storage API to `update` path `{churchB_uuid}/logo.png`.
- **Recommended fix:** Restrict UPDATE/DELETE/INSERT to folders matching `user_church_ids()`:

```sql
AND (storage.foldername(name))[1]::uuid IN (SELECT public.user_church_ids())
```

Or perform all logo uploads exclusively via service role in server actions (remove client storage policies for writes).

- **Tests required:** User A cannot update/delete objects under Church B folder.
- **Secrets rotation:** None.

---

## [CRITICAL] Attendance submission accepts foreign member IDs — cross-tenant PII in SMS follow-up

- **Severity:** Critical
- **Confidence:** Confirmed
- **CWE / OWASP:** CWE-639 (Authorization Bypass Through User-Controlled Key), OWASP A01:2021 Broken Access Control
- **Affected files:** `app/dashboard/attendance/[date]/actions.ts` lines 169–175, 221–224; `supabase/migrations/0002_rls_policies.sql` lines 154–158
- **Affected function:** `submitAttendance` server action
- **Evidence:**

```169:175:app/dashboard/attendance/[date]/actions.ts
  const entryRows = entries.map((entry) => ({
    record_id: record.id,
    church_id: churchId,
    member_id: entry.memberId,
```

RLS `attendance_entries_insert` checks `church_id` only, not that `member_id` belongs to that church.

```221:224:app/dashboard/attendance/[date]/actions.ts
    const { data: memberRows } = await admin
      .from("members")
      .select("id, first_name, last_name, phone")
      .in("id", followUpMemberIds);
```

No `.eq("church_id", churchId)` on member lookup; admin client bypasses RLS.

- **Attack scenario:** Attacker at Church A submits attendance with `memberId` UUIDs from Church B. Follow-up SMS path loads Church B members' names and phone numbers and may send SMS to them.
- **Customer impact:** Cross-tenant PII disclosure (names, phone numbers); unsolicited SMS to another church's members.
- **Reproduction:** Intercept `submitAttendance` request; substitute `memberId` from another church (obtainable if UUIDs are predictable/leaked).
- **Recommended fix:** Before insert, verify all `memberId` values exist in `members` where `church_id = churchId`. Add DB constraint/trigger: `member_id` must reference a member with matching `church_id`.
- **Suggested patch:**

```typescript
const { data: validMembers } = await supabase
  .from("members")
  .select("id")
  .eq("church_id", churchId)
  .in("id", entries.map(e => e.memberId));
if ((validMembers?.length ?? 0) !== entries.length) {
  return { ok: false, error: "Invalid member selection." };
}
```

- **Tests required:** Reject foreign member IDs; follow-up query scoped to church.
- **Secrets rotation:** None.

---

## [HIGH] Viewer role can issue Stripe refunds

- **Severity:** High
- **Confidence:** Confirmed
- **CWE / OWASP:** CWE-862 (Missing Authorization), OWASP A01:2021 Broken Access Control
- **Affected files:** `app/api/dashboard/giving/refund/route.ts` lines 12–16
- **Affected endpoint:** `POST /api/dashboard/giving/refund`
- **Evidence:**

```12:16:app/api/dashboard/giving/refund/route.ts
export async function POST(request: Request) {
  const auth = await getChurchAuth();
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
```

No `auth.isAdmin` check. Compare with `app/api/stripe/connect/onboard/route.ts` which requires admin.

- **Attack scenario:** Church volunteer with `viewer` role refunds legitimate donations, causing financial loss and reconciliation issues.
- **Customer impact:** Unauthorized refunds, audit trail gaps, donor disputes.
- **Reproduction:** Authenticate as viewer; POST `{ "donationId": "<uuid>" }` to refund endpoint.
- **Recommended fix:** Add `if (!auth.isAdmin) return 403`.
- **Tests required:** Viewer receives 403; admin succeeds.
- **Secrets rotation:** None.

---

## [HIGH] Viewer role can export full donor PII CSV

- **Severity:** High
- **Confidence:** Confirmed
- **CWE / OWASP:** CWE-862, OWASP A01:2021 Broken Access Control
- **Affected files:** `app/api/dashboard/giving/export/route.ts` lines 13–17, 49–54
- **Affected endpoint:** `GET /api/dashboard/giving/export`
- **Evidence:** Exports up to 10,000 gifts with donor name, email, amounts — `getChurchAuth()` only, no admin check.

- **Attack scenario:** Viewer exports entire giving database for exfiltration.
- **Customer impact:** GDPR/privacy breach; donor PII exposure.
- **Recommended fix:** Require `auth.isAdmin`; add audit log entry on export.
- **Tests required:** Viewer 403; admin 200 with scoped data.
- **Secrets rotation:** None.

---

## [HIGH] Viewer role can export voice call transcripts

- **Severity:** High
- **Confidence:** Confirmed
- **CWE / OWASP:** CWE-862, OWASP A01:2021 Broken Access Control
- **Affected files:** `app/api/dashboard/voice-assistant/calls/export/route.ts` lines 17–23, 41
- **Affected endpoint:** `GET /api/dashboard/voice-assistant/calls/export`
- **Evidence:** Exports up to 500 calls including full transcripts — church auth only.

- **Attack scenario:** Viewer exfiltrates caller transcripts containing pastoral care conversations.
- **Customer impact:** Sensitive pastoral/visitor PII disclosure.
- **Recommended fix:** Require admin role or explicit permission.
- **Secrets rotation:** None.

---

## [HIGH] OAuth integration callback does not bind to current session user

- **Severity:** High
- **Confidence:** Confirmed
- **CWE / OWASP:** CWE-384 (Session Fixation), OWASP A07:2021 Identification and Authentication Failures
- **Affected files:** `app/api/integrations/google/callback/route.ts` lines 30–37; `app/api/integrations/facebook/callback/route.ts` (same pattern); `lib/integrations/oauth-state.ts`
- **Affected endpoints:** `GET /api/integrations/google/callback`, `GET /api/integrations/facebook/callback`
- **Evidence:** HMAC `state` contains `userId` but callback never verifies `payload.userId === (await supabase.auth.getUser()).data.user?.id` before `exchangeGoogleCode(code, payload.churchId, payload.userId, ...)`.

- **Attack scenario:** Attacker tricks victim into completing OAuth flow using attacker's signed state (from attacker's connect initiation). Victim's Google/Facebook tokens get stored against attacker's church user linkage, or attacker captures OAuth code via redirect interception in shared-device scenario.
- **Customer impact:** Integration hijacking; unauthorized posting to church Facebook; Gmail draft access.
- **Recommended fix:**

```typescript
const { data: { user } } = await supabase.auth.getUser();
if (!user || user.id !== payload.userId) {
  return redirectToSettings({ integration_error: "session_mismatch" }, returnTo);
}
```

- **Tests required:** Callback fails when session user ≠ state userId.
- **Secrets rotation:** None.

---

## [HIGH] Open redirect in Supabase auth callback

- **Severity:** High
- **Confidence:** Confirmed
- **CWE / OWASP:** CWE-601 (URL Redirection to Untrusted Site), OWASP A01:2021 Broken Access Control
- **Affected files:** `app/auth/callback/route.ts` lines 6–14
- **Evidence:**

```6:14:app/auth/callback/route.ts
  const next = searchParams.get("next") ?? "/dashboard";
  ...
      return NextResponse.redirect(`${origin}${next}`);
```

If `next=//evil.com`, redirect becomes `https://faithform.com//evil.com` which browsers may interpret as `https://evil.com`.

- **Attack scenario:** Phishing link after magic-link login sends user to attacker site with session freshly established on legitimate domain first.
- **Customer impact:** Credential phishing, session confusion.
- **Recommended fix:** Allowlist relative paths: `if (!next.startsWith('/') || next.startsWith('//')) next = '/dashboard'`.
- **Tests required:** Reject `//`, `https://`, `\` prefixed paths.
- **Secrets rotation:** None.

---

## [HIGH] Onboarding church profile/logo mutations without authenticated user

- **Severity:** High
- **Confidence:** Confirmed
- **CWE / OWASP:** CWE-306, OWASP A07:2021 Identification and Authentication Failures
- **Affected files:** `app/onboarding/actions.ts` lines 113–134, 163–174
- **Affected functions:** `updateChurchProfile`, `uploadChurchLogo`
- **Evidence:** Only validates invite token + `churchId` match. No `getUser()` or email match (unlike `createOnboardingAccount`).

- **Attack scenario:** Invite link leaked/shared. Anyone with the URL modifies church profile, uploads malicious logo before legitimate admin completes setup.
- **Customer impact:** Account takeover of onboarding flow; brand/defacement.
- **Recommended fix:** Require authenticated session where `user.email` matches invite email (same as Google connect invite flow).
- **Secrets rotation:** None; rotate compromised invite tokens if leaked.

---

## [HIGH] `addMember` bypasses RLS — viewers can create members

- **Severity:** High
- **Confidence:** Confirmed
- **CWE / OWASP:** CWE-863 (Incorrect Authorization), OWASP A01:2021 Broken Access Control
- **Affected files:** `app/dashboard/attendance/[date]/actions.ts` lines 88–99; RLS `members_insert` requires admin (`0002_rls_policies.sql` lines 96–100)
- **Evidence:** Uses `createAdminClient()` for insert, bypassing admin-only RLS policy.

- **Attack scenario:** Viewer adds fraudulent members to pollute attendance records or harvest follow-up workflows.
- **Customer impact:** Data integrity; unauthorized roster changes.
- **Recommended fix:** Use user `supabase` client (RLS-enforced) OR add `isAdmin` check before admin insert.
- **Secrets rotation:** None.

---

## [HIGH] Attendance follow-up webhook updates any entry by ID (global IDOR)

- **Severity:** High
- **Confidence:** Confirmed (exploitable if `N8N_WEBHOOK_SECRET` leaks)
- **CWE / OWASP:** CWE-639, OWASP A01:2021 Broken Access Control
- **Affected files:** `app/api/webhooks/attendance-follow-up-status/route.ts` lines 38–56
- **Evidence:** Service role updates `.eq("id", update.entryId)` with no `church_id` validation.

- **Attack scenario:** Leaked webhook secret allows cross-tenant manipulation of follow-up status fields.
- **Customer impact:** Data integrity across all churches on platform.
- **Recommended fix:** Join/update with `church_id` from payload or lookup entry church first.
- **Secrets rotation:** Rotate `N8N_WEBHOOK_SECRET` if ever exposed.

---

## [HIGH] Sermon outline API updates sermons without `verifySermonAccess`

- **Severity:** High
- **Confidence:** High confidence (RLS mitigates for single-church users; not for multi-church accounts)
- **CWE / OWASP:** CWE-639, OWASP A01:2021 Broken Access Control
- **Affected files:** `app/api/sermon/outline/route.ts` lines 66–75; `lib/queries/sermons.ts` `updateSermon` uses `.eq("id", id)` only
- **Evidence:**

```66:75:app/api/sermon/outline/route.ts
    let sermon =
      sermonId
        ? await updateSermon(sermonId, {
            topic: ctx.topic,
            ...
          })
```

Other sermon routes call `verifySermonAccess` first.

- **Attack scenario:** User belonging to Church A and B passes Church B's `sermonId` while Church A is active context; RLS may still block if user not member of B — but defense-in-depth is missing.
- **Recommended fix:** Call `verifySermonAccess(supabase, sermonId, auth.churchId)` before update.
- **Secrets rotation:** None.

---

## [HIGH] Hardcoded bootstrap super-admin email

- **Severity:** High
- **Confidence:** Confirmed
- **CWE / OWASP:** CWE-798 (Hard-coded Credentials), OWASP A07:2021 Identification and Authentication Failures
- **Affected files:** `lib/auth/superadmin-emails.ts` line 1; `lib/supabase/middleware.ts` lines 87–88
- **Evidence:** `BOOTSTRAP_SUPERADMIN_EMAILS = ["superiormostafa@gmail.com"]` grants `/admin` access without `platform_admins` row.

- **Attack scenario:** Compromise of that email account = full platform admin access to all churches.
- **Customer impact:** Cross-tenant data access at platform level.
- **Recommended fix:** Remove bootstrap list before production; use `platform_admins` table only; require MFA for platform admins.
- **Secrets rotation:** N/A; remove hardcoded email.

---

## [HIGH] No rate limiting on abuse-prone public endpoints

- **Severity:** High
- **Confidence:** Confirmed
- **CWE / OWASP:** CWE-770 (Allocation of Resources Without Limits), OWASP A04:2021 Insecure Design
- **Affected files:** `app/api/give/portal/send-link/route.ts`, `app/api/give/create-intent/route.ts`, `app/api/give/portal/route.ts`, `app/login/actions.ts`
- **Evidence:** Grep for `rateLimit`/`rate-limit` in application source returns no matches. `express-rate-limit` exists only as transitive dependency in lockfile.

- **Attack scenario:** Attacker floods magic-link endpoint → email spam + donor record pollution; floods `create-intent` → Stripe API abuse and cost.
- **Customer impact:** Email deliverability damage; Stripe rate limits; operational cost.
- **Recommended fix:** Vercel WAF/rate limits or Upstash Redis rate limiter per IP + slug.
- **Secrets rotation:** None.

---

## [MEDIUM] Missing security headers (CSP, HSTS, X-Frame-Options)

- **Severity:** Medium
- **Confidence:** Confirmed
- **CWE / OWASP:** CWE-1021 (Improper Restriction of Rendered UI Layers), OWASP A05:2021 Security Misconfiguration
- **Affected files:** `next.config.mjs` (empty), `middleware.ts`, `vercel.json`
- **Evidence:** No `headers()` configuration; no CSP/HSTS/Referrer-Policy.

- **Attack scenario:** Clickjacking of dashboard; XSS impact amplification if introduced later.
- **Recommended fix:** Add headers in `next.config.mjs` or middleware.
- **Secrets rotation:** None.

---

## [MEDIUM] Webhook shared-secret comparison not timing-safe

- **Severity:** Medium
- **Confidence:** Confirmed
- **CWE / OWASP:** CWE-208 (Observable Timing Discrepancy)
- **Affected files:** `app/api/webhooks/attendance-submitted/route.ts` lines 16–20; `attendance-follow-up-status/route.ts`; `announcements-submitted/route.ts`
- **Evidence:** `secret !== expected` vs `timingSafeEqual` used in `oauth-state.ts`.

- **Recommended fix:** Use `crypto.timingSafeEqual` on equal-length buffers.
- **Secrets rotation:** None.

---

## [MEDIUM] `N8N_WEBHOOK_SECRET` reused for OAuth state signing

- **Severity:** Medium
- **Confidence:** Confirmed
- **CWE / OWASP:** CWE-326 (Inadequate Encryption Strength)
- **Affected files:** `lib/integrations/oauth-state.ts` lines 6–8
- **Evidence:** Falls back to `N8N_WEBHOOK_SECRET` if `INTEGRATION_OAUTH_STATE_SECRET` unset.

- **Attack scenario:** Single secret compromise affects both n8n webhooks and OAuth state integrity.
- **Recommended fix:** Require separate `INTEGRATION_OAUTH_STATE_SECRET`; fail startup if missing in production.
- **Secrets rotation:** Rotate both secrets independently.

---

## [MEDIUM] Invite email HTML injection (stored XSS in email clients)

- **Severity:** Medium
- **Confidence:** Confirmed
- **CWE / OWASP:** CWE-79 (XSS)
- **Affected files:** `lib/email/invite.ts` lines 31–33
- **Evidence:** `${params.churchName}` and `${params.adminFirstName}` interpolated without escaping (giving emails use `escapeHtml`).

- **Attack scenario:** Super-admin creates church named `<script>…</script>`; invite email executes in vulnerable clients.
- **Recommended fix:** Apply `escapeHtml` to all dynamic email fields.
- **Secrets rotation:** None.

---

## [MEDIUM] Sensitive tokens logged to console

- **Severity:** Medium
- **Confidence:** Confirmed
- **CWE / OWASP:** CWE-532 (Insertion of Sensitive Information into Log File)
- **Affected files:** `lib/email/invite.ts` lines 83–85, 106–108; `lib/email/giving.ts` line 182
- **Evidence:** Full invite URLs and magic links logged when `RESEND_API_KEY` missing or on success.

- **Attack scenario:** Production logs in Vercel retain full magic links/invite tokens; anyone with log access hijacks accounts.
- **Recommended fix:** Log only message ID / recipient hash, never full URLs with tokens.
- **Secrets rotation:** Rotate if logs may have been exposed.

---

## [MEDIUM] Ambiguous church context for multi-church users

- **Severity:** Medium
- **Confidence:** Confirmed
- **CWE / OWASP:** CWE-441 (Unintended Proxy or Intermediary)
- **Affected files:** `lib/auth/church.ts` lines 22–27; `lib/queries/dashboard.ts` `getCurrentChurchId`
- **Evidence:** `.limit(1)` without `order by` on `church_users`.

- **Attack scenario:** User in two churches gets unpredictable active church; may accidentally act on wrong tenant data.
- **Recommended fix:** Church switcher + session-stored active `church_id`.
- **Secrets rotation:** None.

---

## [MEDIUM] `owner` role in app but not in database schema

- **Severity:** Medium
- **Confidence:** Confirmed
- **CWE / OWASP:** CWE-863
- **Affected files:** `lib/auth/church.ts` line 59; `supabase/migrations/0001_schema.sql` church_users role CHECK
- **Evidence:** `isAdmin: role === "admin" || role === "owner"` but DB only allows `admin`|`viewer`; RLS `is_church_admin` checks `role = 'admin'` only.

- **Impact:** Dead code / future migration risk if `owner` added without RLS update.
- **Recommended fix:** Remove `owner` from app or add to schema + RLS consistently.
- **Secrets rotation:** None.

---

## [MEDIUM] File uploads trust client Content-Type only

- **Severity:** Medium
- **Confidence:** Confirmed
- **CWE / OWASP:** CWE-434 (Unrestricted Upload of File with Dangerous Type)
- **Affected files:** `app/onboarding/actions.ts` lines 185–188; `app/dashboard/settings/giving-actions.ts`
- **Evidence:** `allowed.includes(file.type)` without magic-byte validation.

- **Attack scenario:** Upload polyglot file misidentified as image.
- **Recommended fix:** Validate with `sharp` or file-type sniffing; strip EXIF.
- **Secrets rotation:** None.

---

## [MEDIUM] Public donor portal email enumeration

- **Severity:** Medium
- **Confidence:** Confirmed
- **CWE / OWASP:** CWE-203 (Observable Discrepancy)
- **Affected files:** `app/api/give/portal/route.ts` lines 46–50
- **Evidence:** 404 "No active recurring gift" vs 200 billing portal URL.

- **Attack scenario:** Enumerate which emails have active subscriptions per church.
- **Recommended fix:** Uniform response timing and message; always return generic success for magic-link flow.
- **Secrets rotation:** None.

---

## [MEDIUM] n8n attendance webhook can trigger arbitrary SMS (secret-dependent)

- **Severity:** Medium
- **Confidence:** High confidence
- **CWE / OWASP:** CWE-306
- **Affected files:** `app/api/webhooks/attendance-submitted/route.ts` lines 34–40; `lib/attendance/send-follow-up-texts.ts`
- **Evidence:** Accepts `followUpMembers[].phone` from payload without validating against DB records.

- **Attack scenario:** Leaked `N8N_WEBHOOK_SECRET` → SMS blast to arbitrary numbers via Twilio.
- **Recommended fix:** Load phone numbers from DB by `entryId` only; ignore client-supplied phones.
- **Secrets rotation:** Rotate `N8N_WEBHOOK_SECRET` if exposed.

---

## [MEDIUM] API error responses leak stack traces

- **Severity:** Medium
- **Confidence:** Confirmed
- **CWE / OWASP:** CWE-209 (Generation of Error Message Containing Sensitive Information)
- **Affected files:** `app/api/sermon/outline/route.ts` lines 107–112
- **Evidence:** Returns `e.stack` snippet in JSON `detail` field.

- **Recommended fix:** Log stack server-side only; return generic error to client in production.
- **Secrets rotation:** None.

---

## [MEDIUM] QR code API encodes arbitrary URLs for authenticated users

- **Severity:** Medium
- **Confidence:** Confirmed
- **CWE / OWASP:** CWE-451 (UI Misrepresentation of Critical Information)
- **Affected files:** `app/api/dashboard/giving/qr/route.ts` lines 11–21
- **Evidence:** Any church user can generate QR for arbitrary `url` query param.

- **Attack scenario:** Generate phishing QR codes appearing to originate from church dashboard context.
- **Recommended fix:** Allowlist URLs to church giving domain or pre-approved patterns.
- **Secrets rotation:** None.

---

## [LOW] Middleware does not protect `/api/*` routes

- **Severity:** Low
- **Confidence:** Confirmed
- **CWE / OWASP:** OWASP A05:2021 Security Misconfiguration
- **Affected files:** `middleware.ts`, `lib/supabase/middleware.ts`
- **Evidence:** API auth is per-route; new routes can ship without auth by mistake.

- **Recommended fix:** Default-deny middleware for `/api/dashboard/*`; explicit public allowlist.
- **Secrets rotation:** None.

---

## [LOW] `getChurchAuth` silently falls back to service role

- **Severity:** Low
- **Confidence:** Confirmed
- **CWE / OWASP:** CWE-269 (Improper Privilege Management)
- **Affected files:** `lib/auth/church.ts` lines 34–49
- **Evidence:** If anon client fails to read `church_users`, admin client used.

- **Impact:** Masks RLS misconfiguration; expands blast radius if admin client used incorrectly downstream.
- **Recommended fix:** Fail loudly in production instead of fallback.
- **Secrets rotation:** None.

---

## [LOW] No MFA for administrators

- **Severity:** Low
- **Confidence:** Confirmed
- **CWE / OWASP:** OWASP A07:2021 Identification and Authentication Failures
- **Evidence:** No MFA enrollment, TOTP, or Supabase MFA checks in codebase.

- **Recommended fix:** Enable Supabase MFA for admin/owner accounts before production.
- **Secrets rotation:** None.

---

## [LOW] No password reset flow in application

- **Severity:** Low
- **Confidence:** Confirmed
- **Affected files:** `app/login/` — no reset route
- **Evidence:** Users directed to Supabase defaults only; no branded reset UX.

- **Impact:** Operational/support risk, not direct vulnerability.
- **Recommended fix:** Implement `resetPasswordForEmail` flow.
- **Secrets rotation:** None.

---

## [LOW] No audit log for financial operations

- **Severity:** Low
- **Confidence:** Confirmed
- **Evidence:** Refunds, exports, subscription changes lack dedicated audit trail beyond Stripe dashboard.

- **Recommended fix:** Log admin actions to `activity_log` with actor, IP, resource ID.
- **Secrets rotation:** None.

---

## [LOW] Default webhook secret placeholders in `.env.example`

- **Severity:** Low
- **Confidence:** Confirmed
- **Affected files:** `.env.example` lines 5–6 (`N8N_WEBHOOK_SECRET=replace-me`)
- **Impact:** Deployment risk if copied verbatim.
- **Recommended fix:** Fail CI/deploy if secrets equal placeholder values.
- **Secrets rotation:** Required if placeholders used in any deployed environment.

---

## [INFORMATIONAL] No committed live secrets in git history

- **Severity:** Informational
- **Confidence:** Confirmed (git history search)
- **Evidence:** `git log -S 'sk_live'` shows only `.env.example` placeholders. `.env`, `.env.local`, `.env.vercel*` gitignored per `.gitignore` lines 26–31.

---

## [INFORMATIONAL] Stripe webhook verification implemented correctly

- **Severity:** Informational
- **Confidence:** Confirmed
- **Affected files:** `app/api/webhooks/stripe/route.ts`, `lib/stripe/webhooks.ts` lines 696–719
- **Evidence:** Signature required; idempotency via `stripe_webhook_events`; multiple secret support.

---

## [INFORMATIONAL] Public giving PaymentIntent flow validates fund and church server-side

- **Severity:** Informational
- **Confidence:** Confirmed
- **Affected files:** `app/api/give/create-intent/route.ts` lines 36–44
- **Evidence:** Fund validated against church; amounts server-validated with Zod minimums. Donation recording driven by Stripe webhooks, not client redirect.

---

## [INFORMATIONAL] OAuth state uses HMAC-SHA256 with timing-safe comparison

- **Severity:** Informational
- **Confidence:** Confirmed
- **Affected files:** `lib/integrations/oauth-state.ts` lines 21–40

---

## [INFORMATIONAL] Announcements publish blocked for viewers at RLS layer

- **Severity:** Informational
- **Confidence:** Confirmed
- **Affected files:** `app/dashboard/announcements/actions.ts` (no `isAdmin` check); `0002_rls_policies.sql` lines 183–200
- **Evidence:** `announcements_insert/update` require `is_church_admin`. App-layer gap mitigated by DB.

---

# Multi-Tenant Isolation Matrix

| Resource | Read | Create | Update | Delete | File access | Admin access |
|----------|------|--------|--------|--------|-------------|--------------|
| Churches | ✅ RLS | ⚠️ Service role only | ⚠️ Onboarding token only (no user auth) | ❌ N/A | — | ✅ Platform admin |
| Church users | ✅ RLS | ✅ Admin RLS | ✅ Admin RLS | ✅ Admin RLS | — | ✅ Admin RLS |
| Members | ✅ RLS | ⚠️ Viewer via admin client (`addMember`) | ✅ Admin RLS | ✅ Admin RLS | — | ✅ Admin RLS |
| Attendance records/entries | ✅ RLS | ✅ RLS | ✅ RLS | ✅ RLS | — | ✅ All members write |
| Attendance member linkage | ❌ No member∈church validation | ❌ Foreign member_id accepted | — | — | — | — |
| Announcements | ✅ RLS | ✅ Admin RLS | ✅ Admin RLS | ✅ Admin RLS | ⚠️ Social graphics path validated in app | ✅ Admin RLS |
| Sermons / series | ✅ RLS | ✅ churchId in app | ⚠️ `outline` route skips verify | ⚠️ RLS only on delete | — | ✅ Member access |
| Giving donations/donors | ✅ RLS read | ✅ Service role + slug | ✅ Webhooks | ❌ N/A | — | ⚠️ Viewer can export/refund |
| Integrations / tokens | ✅ RLS + admin RPC | ✅ Admin | ✅ Admin | ✅ Admin | — | ✅ Admin |
| Phone calls | ✅ RLS | ❌ Retell webhook unauthenticated | ❌ Service role by ID | — | — | ⚠️ Viewer can export |
| Activity log | ✅ RLS | ✅ Service role | — | — | — | ✅ Admin write RLS |
| Church logos (storage) | 🌐 Public | ⚠️ Any auth user (folder only) | ❌ Any auth user | ❌ Any auth user | ❌ Cross-tenant | — |
| Social graphics (storage) | 🌐 Public | ⚠️ Any auth user (folder only) | ⚠️ No update policy | ⚠️ No delete policy | ⚠️ Public URLs | — |
| Donor portal sessions | 🔒 Service role only | ✅ Magic link | — | — | ❌ Cookie forgeable | — |
| Platform admin data | 🔒 Own row | Service role | — | — | — | ✅ `/admin` gate |

**Legend:** ✅ Correctly enforced | ⚠️ Partial / defense-in-depth gap | ❌ Missing or broken | 🌐 Intentionally public | 🔒 Service role only

---

# Route and Permission Matrix

| Endpoint | Auth | Roles | Tenant restriction | Validation | Rate limit | Audit log |
|----------|------|-------|-------------------|------------|------------|-----------|
| `POST /api/webhooks/stripe` | Stripe signature | — | Stripe account metadata | ✅ | ❌ | ✅ Idempotency table |
| `POST /api/webhooks/retell` | **None** | — | **Attacker-controlled** | Partial | ❌ | ❌ |
| `POST /api/webhooks/retail-ai` | **None** | — | Same as Retell | Partial | ❌ | ❌ |
| `POST /api/webhooks/attendance-submitted` | Shared secret | — | ❌ Arbitrary phones | Partial | ❌ | ❌ |
| `POST /api/webhooks/attendance-follow-up-status` | Shared secret | — | ❌ ID-only update | Partial | ❌ | ❌ |
| `POST /api/webhooks/announcements-submitted` | Shared secret | — | Stub | ❌ | ❌ | ❌ |
| `POST /api/give/create-intent` | None (public) | — | ✅ Slug + fund | ✅ Zod | ❌ | ❌ |
| `POST /api/give/create-subscription` | None | — | ✅ Slug + fund | ✅ Zod | ❌ | ❌ |
| `GET /api/give/funds` | None | — | ✅ Slug | ✅ | ❌ | ❌ |
| `POST /api/give/portal/send-link` | None | — | ✅ Slug | ✅ Zod | ❌ | ❌ |
| `POST /api/give/portal` | None | — | ✅ Slug | ✅ | ❌ | ❌ |
| `POST /api/give/portal/create-intent` | Donor cookie | — | ⚠️ Forgable cookie | ✅ Zod | ❌ | ❌ |
| `POST /api/give/portal/*` | Donor cookie | — | ⚠️ Forgable cookie | ✅ | ❌ | ❌ |
| `POST /api/dashboard/giving/refund` | Session | **Any member** | ✅ churchId | ✅ Zod | ❌ | ❌ |
| `GET /api/dashboard/giving/export` | Session | **Any member** | ✅ churchId | Partial | ❌ | ❌ |
| `POST /api/dashboard/giving/subscriptions/[id]` | Session | **Any member** | ✅ churchId | ✅ | ❌ | ❌ |
| `GET /api/dashboard/giving/statements/[donorId]` | Session | Any member | ✅ churchId + donorId | ✅ | ❌ | ❌ |
| `GET /api/dashboard/voice-assistant/calls/export` | Session | **Any member** | ✅ churchId | — | ❌ | ❌ |
| `POST /api/stripe/connect/onboard` | Session | **Admin** | ✅ churchId | ✅ | ❌ | ❌ |
| `POST /api/sermon/outline` | Session | Any member | ⚠️ RLS only | Partial | ❌ | ❌ |
| `PATCH/DELETE /api/sermon/[id]` | Session | Any member | ✅ verifySermonAccess | ✅ | ❌ | ❌ |
| `GET /api/integrations/google/connect` | Session / invite | Admin or invite | ✅ churchId in state | ✅ | ❌ | ❌ |
| `GET /api/integrations/google/callback` | OAuth state | **Not bound to session** | State churchId | ✅ HMAC | ❌ | ❌ |
| `POST /api/dashboard/usage/heartbeat` | Session | Any member | ✅ churchId | Partial | ❌ | ❌ |
| `GET /api/reports/monthly/[month]` | Session | Any member | ✅ requireChurchContext | ✅ | ❌ | ❌ |
| `GET /api/reports/attendance/[month]` | Session | Any member | ✅ church_id queries | ✅ | ❌ | ❌ |
| `GET /api/sermon/themes` | None | — | Global catalog | — | ❌ | ❌ |
| `GET /api/dashboard/giving/qr` | Session | Any member | — | ❌ Arbitrary URL | ❌ | ❌ |
| `GET /auth/callback` | OAuth code | — | — | ❌ Open redirect | ❌ | ❌ |
| `POST /auth/signout` | Session | — | — | — | ❌ | ❌ |
| Server: `submitAttendance` | Session | Any member | ⚠️ churchId | ❌ member validation | ❌ | Partial activity |
| Server: `addMember` | Session | **Any (admin bypass)** | ✅ churchId | ✅ | ❌ | ❌ |
| Server: `updateChurchProfile` | **Invite token only** | — | ✅ token+churchId | Partial | ❌ | ❌ |
| `/admin/*` | Session + platform_admin | Super-admin | Cross-tenant by design | Partial | ❌ | ❌ |
| `/dashboard/*` | Middleware session | Church member | ⚠️ limit(1) church | — | ❌ | — |

---

# Dependency Findings

**Audit command:** `pnpm audit` (2026-06-23)  
**Summary:** 24 vulnerabilities — 3 low, 13 moderate, 8 high

| Package | Installed | Severity | CVE/Advisory | Exploitability in FaithForm | Patched | Safe upgrade path |
|---------|-----------|----------|--------------|----------------------------|---------|-------------------|
| `next` | 14.2.35 | High | GHSA-36qx-fr4f-26g5 (CVE-2026-44573) — Middleware bypass with i18n + Pages Router | **Likely not exploitable** — App Router, no i18n config found | ≥15.5.16 | Plan major upgrade to Next 15 LTS; test App Router + middleware |
| `next` | 14.2.35 | High | GHSA (RSC deserialization DoS) | **Requires runtime verification** — uses Server Actions/RSC | ≥15.0.8 per advisory | Upgrade Next with full regression test |
| `glob` | 10.3.10 (via eslint-config-next) | High | GHSA-5j98-mcp5-4vw2 — CLI command injection | **Not exploitable** — dev dependency only, CLI not invoked in prod | ≥10.5.0 | `pnpm update eslint-config-next` when upgrading Next |
| `hono` | (via shadcn MCP dep) | Moderate | Multiple GHSA | **Not in runtime path** — shadcn CLI tooling | 4.12.27 | Low priority; shadcn is dev tooling |
| `form-data` | 4.0.5 (via @anthropic-ai/sdk) | Moderate | CVE-2026-12143 — CRLF injection in field names | **Low** — only if app passes untrusted field names to form-data | 4.0.6 | `pnpm update` or wait for @anthropic-ai/sdk bump |
| `@babel/core` | 7.29.0 | Moderate | GHSA-4x5r-pxfx-6jf8 | **Not runtime** — build tooling | ≥7.29.6 | Transitive via Next/shadcn |

**Supply chain notes:**
- `shadcn` is listed in **production** `dependencies` (`package.json` line 47) but appears to be a CLI tool — consider moving to `devDependencies`.
- Lockfile present (`pnpm-lock.yaml`); no install scripts with network fetch detected in direct dependencies.
- No evidence of packages from non-npm registries.

---

# Production Configuration Findings

| Item | Status | Evidence |
|------|--------|----------|
| `.env` gitignored | ✅ | `.gitignore` lines 27–31 |
| `.env.example` committed (placeholders only) | ✅ | No live keys |
| Security headers | ❌ Missing | Empty `next.config.mjs` |
| HTTPS enforcement | ✅ Vercel default | Cookie `secure: true` in production (`portal-session.ts:78`) |
| CORS | Default same-origin | No permissive CORS headers |
| Debug/source maps | ⚠️ Default Next behavior | No explicit `productionBrowserSourceMaps` (defaults off) |
| Stripe webhook secrets | ✅ Required | Throws if unset |
| Webhook placeholder secrets | ⚠️ Risk | `replace-me` in `.env.example` |
| Middleware auth for dashboard/admin | ✅ | `lib/supabase/middleware.ts` |
| API default deny | ❌ | Per-route auth only |
| MFA | ❌ Not configured | — |
| Rate limiting | ❌ Not implemented | — |
| Bootstrap super-admin | ❌ Hardcoded email | `superadmin-emails.ts` |

---

# Privacy and Sensitive Data Findings

| Data type | Where stored | Exposure risk |
|-----------|--------------|---------------|
| Member PII (name, phone) | `members` | Cross-tenant via attendance follow-up (Critical) |
| Donor PII (email, giving history) | `giving_donors`, `giving_donations` | Viewer export; forged portal session |
| Call transcripts | `phone_calls` | Viewer export; Retell injection |
| Integration tokens | `church_integrations` | Admin RPC gated ✅ |
| Magic links / invite tokens | Logs | Medium — console logging |
| Passwords | Supabase Auth | Not in app DB ✅ |
| Card data | Stripe only | PCI scope reduced via Stripe.js ✅ |
| Church logos | Public storage bucket | Cross-tenant tampering |

**GDPR/privacy gaps:** No documented data retention/deletion workflow in code; no member/donor erasure API found; public buckets serve images without access logging.

---

# Required Fixes Before Customer Delivery

## 1. Blockers (must fix before delivery)

1. Sign donor portal session cookies (HMAC or server-side sessions).
2. Add Retell webhook authentication; stop trusting unauthenticated `metadata.church_id`.
3. Fix storage policies for `church-logos` (and `social-graphics` INSERT) with `user_church_ids()` folder ownership.
4. Validate `member_id ∈ church` on attendance submission; scope follow-up member queries by `church_id`.
5. Require `isAdmin` on refund, export, and subscription management APIs.
6. Remove hardcoded bootstrap super-admin email before production (use `platform_admins` only).

## 2. High-priority fixes (fix before or immediately at launch)

7. Bind OAuth callbacks to authenticated session user.
8. Fix open redirect in `/auth/callback`.
9. Require authenticated invitee on onboarding profile/logo actions.
10. Fix `addMember` to use RLS or admin check.
11. Add `church_id` validation to attendance follow-up webhook updates.
12. Add `verifySermonAccess` to sermon outline route.
13. Implement rate limiting on public giving/portal/login endpoints.
14. Stop logging invite URLs and magic links.
15. Use timing-safe comparison for webhook secrets.

## 3. Fixes acceptable immediately after launch

16. Add security headers (CSP, HSTS, X-Frame-Options, Referrer-Policy).
17. Separate `INTEGRATION_OAUTH_STATE_SECRET` from n8n secret.
18. Escape HTML in invite emails.
19. Church switcher for multi-church users.
20. MFA for church admins and platform admins.
21. Audit logging for refunds, exports, role changes.
22. File upload magic-byte validation.
23. QR code URL allowlist.

## 4. Long-term hardening

24. Default-deny API middleware with explicit public allowlist.
25. DB constraint: `attendance_entries.member_id` must match `church_id`.
26. Virus scanning strategy for uploads.
27. WAF / bot protection on public endpoints.
28. Dependency upgrade path to Next.js 15+.
29. Data retention and erasure APIs for GDPR.
30. Remove `shadcn` from production dependencies.

---

# Verification Checklist

### Blocker 1: Donor portal session signing
```bash
# Unit test
pnpm test lib/giving/portal-session.test.ts  # after adding tests

# Manual: forge cookie without valid HMAC → expect 401 on portal APIs
curl -X POST "https://<app>/api/give/portal/statement" \
  -H "Cookie: ff_donor_session=forged.<payload>" \
  -d '{"slug":"<slug>"}'
```

### Blocker 2: Retell webhook auth
```bash
# Unsigned request must return 401
curl -X POST "https://<app>/api/webhooks/retell" \
  -H "Content-Type: application/json" \
  -d '{"event":"call_ended","call":{"call_id":"test"}}'
# Expect 401, not 200
```

### Blocker 3: Storage isolation
```sql
-- As user from church A, attempt update on church B path — must fail
-- Run in Supabase SQL editor with authenticated role JWT
```

### Blocker 4: Attendance member validation
```bash
# Integration test: submitAttendance with foreign memberId → expect error
# Verify follow-up query includes .eq("church_id", churchId)
```

### Blocker 5: Admin-only financial APIs
```bash
# As viewer JWT:
curl -X POST "https://<app>/api/dashboard/giving/refund" -d '{"donationId":"..."}'
# Expect 403

curl "https://<app>/api/dashboard/giving/export"
# Expect 403
```

### Blocker 6: Bootstrap super-admin removed
```bash
grep -r "BOOTSTRAP_SUPERADMIN" lib/
# Should return empty or feature-flagged off in production
```

### High: Open redirect
```bash
# Visit /auth/callback?code=invalid&next=//evil.com — must redirect to /dashboard not external
```

### High: Rate limiting
```bash
# 100 rapid POSTs to /api/give/portal/send-link — expect 429 after threshold
```

### Dependencies
```bash
pnpm audit
pnpm build  # after Next upgrade
```

---

# Areas Not Fully Verified

The following require runtime/production access to confirm:

1. **Supabase project dashboard settings** — whether anon key is appropriately restricted, whether RLS is enabled on all tables in deployed project (migrations applied).
2. **Vercel environment variables** — actual production values for webhook secrets (not `replace-me`).
3. **Retell dashboard** — whether any webhook signing is configured server-side but not yet in code.
4. **Next.js RSC CVE exploitability** — requires targeted testing against deployed Server Actions.
5. **Twilio/Resend account configuration** — sender verification, spending limits.
6. **Stripe Connect live vs test mode** in production.
7. **Backup and restoration procedures** — not defined in repository.
8. **Whether deleted/suspended Supabase users retain access** — depends on Supabase Auth config, not app code.

---

*Report generated: 2026-06-23*  
*Scope: Full repository static analysis, migration review, dependency audit, targeted code path tracing*  
*Method: Read-only audit — no production behavior was modified*
