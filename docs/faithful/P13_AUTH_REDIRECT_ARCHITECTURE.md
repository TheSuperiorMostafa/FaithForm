# Visitor auth: the redirect architecture

Two products share one Supabase identity. They have never shared a post-auth
destination, and this document is the record of which destination belongs to
which — plus the external configuration that must exist for either to work.

**Everything below is split into two parts on purpose.** "Verified locally"
means a test or a build in this repository proves it. "Required external
configuration" means a person must do it in a dashboard this repository cannot
reach, and until they do, the flow will not work no matter what the code says.

---

## 1. The two surfaces

| | FaithForm dashboard (web) | Faithful (iOS + Android) |
|---|---|---|
| Who | Church staff | Visitors / congregation |
| Auth entry | `/login`, `/setup`, `/onboarding` | In-app sign-up and sign-in |
| Post-auth destination | `{site origin}/auth/callback` | `faithful://auth/callback` |
| Flow | Supabase SSR cookie session | PKCE, code exchanged in-app |
| After success | Dashboard shell (staff role required) | Visitor bootstrap → discovery or home |

The single source of truth for both is
[`contracts/faithful/v1/auth-callback.json`](../../contracts/faithful/v1/auth-callback.json).
The TypeScript, Swift, and Kotlin test suites all read that same file, so a
destination cannot be widened on one platform and stay narrow on the others.

### The rule that was broken

The mobile app called Supabase's `/auth/v1/signup` **without a `redirect_to`**.
Supabase then falls back to the project's **Site URL** — which is the staff
dashboard. So a visitor confirming their email from Faithful was delivered to
FaithForm's web dashboard, where they had no staff role.

Redirects are now **configuration, never input**:

- iOS reads `AuthCallbackLink.canonicalURL`, compiled in.
- Android reads `AuthCallbackLink.CANONICAL`, compiled in.
- The web derives its callback from `getCanonicalSiteUrl()` via
  `dashboardEmailRedirect()` in [`lib/auth/auth-redirects.ts`](../../lib/auth/auth-redirects.ts).

No code path anywhere accepts a redirect destination supplied by a request, a
link, or a provider response. The dashboard's `next` parameter is the one
client-supplied value, and it is passed through `safeRedirectPath`, which
accepts only same-origin **relative paths** — an absolute URL, a
protocol-relative `//host`, a backslash trick, or `faithful://…` all collapse to
`/dashboard`.

---

## 2. The corrected flow

### Mobile confirmation (the flow that was broken)

```
Faithful app: create account
  │  POST /auth/v1/signup?redirect_to=faithful%3A%2F%2Fauth%2Fcallback
  │  body: { email, password, code_challenge, code_challenge_method: "s256" }
  │  ── verifier saved to Keychain / EncryptedSharedPreferences BEFORE the
  │     request leaves, because the person is about to switch to Mail and the
  │     process may not survive the trip
  ▼
Supabase sends the confirmation email
  ▼
Person taps the link → Supabase verifies the address
  │  302 → faithful://auth/callback?code=…
  ▼
OS opens the app directly (custom scheme — no browser page as a final stop)
  ▼
AuthCallbackLink.parse(url)  ── strict: exact scheme, host, path; code matched
  │                             against ^[A-Za-z0-9._~-]{8,512}$
  ▼
POST /auth/v1/token?grant_type=pkce { auth_code, code_verifier }
  │  ── the URL comes from build configuration; nothing in the callback can
  │     point the exchange anywhere else
  ▼
Session adopted (stamped with this build's environment key), verifier cleared
  ▼
GET /api/mobile/v1/account/bootstrap   → account, relationships, capabilities
GET /api/mobile/v1/onboarding          → the server decides the first screen
  ▼
No church  → discovery / onboarding flow
Has church → visitor home
```

**Staff dashboard routes are never entered.** The mobile app has no concept of
them; it only ever calls `/api/mobile/v1/*`.

### Dashboard auth (unchanged, now explicit)

```
/login, /setup, or /onboarding
  ▼  emailRedirectTo = dashboardEmailRedirect([next])  → {origin}/auth/callback
Supabase email → {origin}/auth/callback?code=…
  ▼  exchangeCodeForSession
  ├─ recovery session (amr claim)      → /set-password?reason=recovery
  ├─ next starts with /dashboard, and
  │  the account has no staff role     → /login  (renders "no dashboard access")
  ├─ platform admin, no church         → /admin
  └─ otherwise                         → {origin}{safe next}
```

### Why the dashboard page was blank

`/login` sent every authenticated user to `/dashboard`; `/dashboard`'s layout
sent everyone without a `church_users` row back to `/login`. A Faithful visitor
account is exactly that — a real Supabase identity with no staff row — so the
two rules chased each other and the browser rendered nothing.

The fix is one total function,
[`resolveSignedInLanding`](../../lib/auth/signed-in-landing.ts): every
combination of inputs has exactly one destination, and "no access" is a **page**
rather than another redirect.

**Authorization is unchanged.** `/dashboard` still requires the existing staff
membership. Nothing creates a `church_users` row, relaxes RLS, or infers a
People identity from an email address.

---

## 3. Failure states

The generic "Something went wrong" is gone from the auth path. Each state below
is distinct, actionable, and carries no provider wording, token, code, address,
or other personal data.

| Situation | Mobile | Dashboard |
|---|---|---|
| Link expired / already used | `auth_error_link_expired` — "…expired or was already used. Sign in with your email and password." | `/login?error=auth` banner |
| Link malformed / truncated | `auth_error_link_invalid` | `/login?error=auth` banner |
| Email not confirmed yet | `auth_error_email_unconfirmed` | provider message |
| Sign-in cancelled | leaving the screen; no error state | — |
| Offline / network failure | `auth_error_offline` — **code stays retryable**, tap the link again | — |
| App not configured | `auth_error_unconfigured` | — |
| Signed in, bootstrap failed | `error_title` + the server's own redacted sentence, with **Try again** and **Sign out** | — |
| Signed in, no church | discovery / onboarding — a real destination, not an error | — |
| Visitor at the dashboard | — | "This account can't open the dashboard", with sign-out |

Diagnostics are privacy-safe by construction:

- iOS `FaithfulLog` accepts a `StaticString` event name, a request id, and a
  typed error code — a secret cannot be passed to it.
- Android surfaces `AuthException.Kind`, never a provider string.
- The web callback logs `callbackDiagnosticCode(...)`, which only emits a value
  matching `^[a-z][a-z0-9_]{0,39}$` and otherwise `unrecognised` — so newlines,
  provider wording, and anything resembling an address stay out of the log.

---

## 4. Required external configuration

None of the following is in this repository, and none of it can be verified
here. Each item must be set by a person with access to the relevant console.

### 4.1 Supabase → Authentication → URL Configuration

Per project (each environment is its own Supabase project):

**Site URL** — the dashboard origin for that environment. This is the fallback
for any redirect not on the allow-list, which is why it must be the dashboard
and why the mobile app must never rely on it.

| Environment | Site URL |
|---|---|
| Development | `http://localhost:3000` |
| Staging | *(your staging origin — this repository deliberately invents none)* |
| Production | `https://faithform.io` |

**Redirect URLs (allow-list)** — add **both** rows for every environment:

| Environment | Rows to add |
|---|---|
| Development | `http://localhost:3000/auth/callback`<br>`faithful://auth/callback` |
| Staging | `{staging origin}/auth/callback`<br>`faithful://auth/callback` |
| Production | `https://faithform.io/auth/callback`<br>`faithful://auth/callback` |

> `faithful://auth/callback` is the same string in every environment — there is
> one custom scheme. Environments stay separated at the identity provider: each
> talks to its own Supabase project, the PKCE verifier is stored per
> environment key, and a code minted by one project cannot be spent against
> another. **If this row is missing, Supabase silently falls back to the Site
> URL and the original bug returns.**

### 4.2 Supabase → Authentication → Email Templates

The **Confirm signup** template must use the token-hash confirmation URL so the
`redirect_to` the client supplied is honoured:

```
{{ .ConfirmationURL }}
```

No template change is required for the fix; verify only that the template has
not been customised to a hardcoded dashboard URL. If it has, that hardcoded URL
overrides everything above.

### 4.3 Supabase → Authentication → Providers → Email

- **Confirm email**: ON. The flow depends on it, and nothing here bypasses it.
- **Secure email change**: leave as configured.

### 4.4 iOS

Already in the repository, no console work needed:

- `apps/faithful-ios/App/Resources/Info.plist` registers `CFBundleURLSchemes`
  = `faithful`.
- **Universal Links are deliberately not used.** They need a verified
  `apple-app-site-association` file on a domain this repository does not
  establish, and `com.apple.developer.associated-domains` is intentionally
  absent rather than declared and broken. The custom scheme opens the app
  directly, so no browser page is the final destination.

Per-environment values come from the `.xcconfig` for the configuration being
built. Debug reads `FAITHFUL_DEV_SUPABASE_URL` / `FAITHFUL_DEV_SUPABASE_ANON_KEY`
from the gitignored `App/Configuration/Local.xcconfig`. **Staging and Release
ship with these empty and fail closed** — supply them at build time:

```
FAITHFUL_API_ORIGIN, FAITHFUL_SUPABASE_URL, FAITHFUL_SUPABASE_ANON_KEY
```

If you later want `https://` confirmation links to open the app, that is a
separate change: host the association file, add the entitlement, and add the
`https` rows to the allow-list. The custom scheme keeps working either way.

### 4.5 Android

Already in the repository, no console work needed:

- `apps/faithful-android/app/src/main/AndroidManifest.xml` declares the
  `android:scheme="faithful"` intent filter on `MainActivity`, which is
  `launchMode="singleTask"` — so a link into a running app arrives at
  `onNewIntent` and is handled identically to a cold start.
- **App Links are deliberately not used**, for the same reason as iOS: they
  need a verified Digital Asset Links file on a domain this repository does not
  establish.

Per-environment values are supplied at build time and are **empty by default**:

```
-Pfaithful.stagingOrigin=…  -Pfaithful.releaseOrigin=…
-Pfaithful.supabaseUrl=…    -Pfaithful.supabaseAnonKey=…
```

(or from the gitignored `local.properties` for local work).

### 4.6 Dashboard

`NEXT_PUBLIC_SITE_URL` must be set per deployment and must match the origin
allow-listed in that environment's Supabase project. It is the only input to
`dashboardEmailRedirect()`.

---

## 5. Physical-device test steps

**These have not been run.** No real email was sent, opened, or clicked in this
work, and no deep link was delivered on physical hardware. Everything verified
here is listed in §6. Run this before believing the flow works end to end.

**Prerequisites:** §4.1 complete for the environment under test; a build
pointing at that environment; a real inbox on the device.

1. **Install** the Debug/Staging build on a physical phone (not the simulator —
   simulators resolve custom schemes differently from a real Mail client).
2. **Create an account** in Faithful with a real address. Confirm the app shows
   "Check your email", not an error.
3. **Inspect the email before tapping.** Long-press the button and read the URL.
   It must contain `redirect_to=faithful%3A%2F%2Fauth%2Fcallback`. *If it points
   at the dashboard origin, the allow-list row in §4.1 is missing — stop and fix
   that; nothing downstream can compensate.*
4. **Tap the link.** Expected: the browser opens for a moment, then **Faithful
   comes to the front**. The dashboard must never render.
5. **Watch the front door.** "Confirming your email…" appears, then the app
   proceeds to the discovery/onboarding flow (no church yet).
6. **Replay the link.** Return to Mail and tap the same link again. Expected: the
   app foregrounds and quietly refreshes. No error, no sign-out, no second
   exchange, no duplicate account.
7. **Kill and relaunch.** Force-quit, reopen. Expected: still signed in, straight
   to where you were — the session is restored from the Keychain / encrypted
   store.
8. **Restart mid-flow.** Create a second account, force-quit the app *before*
   opening the email, then tap the link. Expected: it still completes — the PKCE
   verifier survived the process death.
9. **Expired link.** Wait past the OTP lifetime (or reuse a spent link).
   Expected: "That confirmation link has expired or was already used. Sign in
   with your email and password." Then sign in with the password and confirm it
   works.
10. **Offline.** Enable airplane mode, tap a fresh link. Expected: the offline
    sentence. Disable airplane mode, tap the **same** link again. Expected: it
    completes — offline never burns the code.
11. **The dashboard cross-check.** In a browser, sign in to the dashboard with
    that same visitor account. Expected: "This account can't open the dashboard",
    with a working Sign out. **Never a blank page, and never the dashboard.**
12. **Staff regression.** Confirm a real staff account still signs in to
    `/dashboard` normally, and that a password reset still lands on
    `/set-password`.
13. **Android repeat.** Steps 1–12 on Android, including a link tapped while the
    app is already running (exercises `singleTask` + `onNewIntent`).

---

## 6. What was verified locally

Everything in this section was run in this repository.

| Check | Result |
|---|---|
| `swift test` (FaithfulKit) | 374 tests, 48 suites — pass |
| `build-ios-app.sh --test` (app target, simulator) | 16 tests, 3 suites — pass |
| `gradlew test` (all Android modules) | 689 tests — pass |
| `pnpm test` (web unit + security + policies) | 778 tests — pass |
| `pnpm typecheck` | clean |
| `pnpm lint` | 0 errors (43 pre-existing warnings, none in changed files) |
| `pnpm verify:generated` | contract, design tokens, and iOS/Android string parity current |
| `pnpm scan:secrets` | passed, 1306 files |
| `git diff --check` | clean |
| `scripts/build-ios-app.sh` | app target builds, no errors, no warnings |
| `gradlew :app:assembleDebug` / `:app:assembleStaging` | both build |

**Not verified, and not claimed:** a real confirmation email, a real deep link
on physical hardware, and any Supabase console configuration. Those are §5 and
§4 respectively.

Two bugs were found by running things rather than by reading them, and both are
now pinned by contract vectors:

- `URLComponents.percentEncodedQuery` **traps** when handed already-decoded
  text containing a space, so a real provider error carrying `%20` would have
  crashed the iOS app. The fragment is now split by hand.
- Java's `URI` **throws** on a malformed percent escape, so Android read a
  broken-escape error link as "not our link" instead of as a failure. That
  parser is now manual and total too. This one was initially masked by a stale
  Gradle result — the test task did not track the contract file as an input,
  which is now fixed in `core/navigation` and `core/contract`.
