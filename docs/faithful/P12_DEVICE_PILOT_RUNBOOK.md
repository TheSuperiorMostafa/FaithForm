# Prompt 12 — Device Pilot Runbook

*One checklist for iPhone and Android, with every item labelled by how far it has
actually been verified.*

---

## Legend

| Label | Means |
| --- | --- |
| **AUTO** | verified by an automated gate on this machine |
| **SIM** | verified on a simulator or emulator |
| **DEVICE** | needs a physical phone. **Nothing has this label yet.** |
| **STAGING** | needs a deployed staging environment. **Nothing has this label yet.** |
| **PROD** | needs production. **Nothing has this label yet.** |
| **BLOCKED** | cannot be done without a credential or provider access nobody here has |

Every row below is **AUTO**, **SIM**, or **BLOCKED**. Not one row has been
verified on a device, on staging, or in production, and this document does not
pretend otherwise.

---

## 1. Sign-in exists on both platforms

**RESOLVED.** The gap this section used to record — no sign-in flow anywhere —
has been closed, and each of the four items it demanded now exists:

1. A first-run screen on each platform: **Create Account** (email + password),
   **Sign In**, and **Forgot password**, against Supabase's GoTrue endpoints
   directly (`SupabaseAuthClient` in FaithfulKit / `SupabaseAuthClient.kt` in
   `core:network`), with typed error mapping — no provider wording ever
   reaches a screen.
2. Configuration on both platforms, empty by default and failing closed:
   `FAITHFUL_SUPABASE_URL` / `FAITHFUL_SUPABASE_ANON_KEY` on iOS (fed from the
   gitignored `Local.xcconfig` in Debug), `faithful.supabaseUrl` /
   `faithful.supabaseAnonKey` Gradle properties or `local.properties` on
   Android.
3. An Android refresher wired into `AndroidSessionStore` through the same
   client — an expired session renews instead of dying at its first hour.
4. First-run policy acceptance: the account screens carry the agreement
   sentence, and the first bootstrap with no recorded versions posts
   `account/consent` with the required ones.

Past sign-in, the server's `GET /onboarding` decides the first screen: no
active church → the welcome flow (find a church, or redeem an invitation —
including one held across sign-in from a `faithful://invite/<token>` link);
otherwise home. The signed-out, offline, and failed states all carry an
action; none is a dead end. Automated coverage: `AuthAndOnboardingTests.swift`
(iOS), `FirstRunTest.kt` / `SupabaseAuthClientTest.kt` (Android).

**DEVICE rows below remain unverified on hardware** — that labelling still
stands.

---

## 2. Install and configuration

| # | Step | Status |
| --- | --- | --- |
| 1 | iOS app compiles for a device, warnings as errors | **AUTO** — `pnpm ios:app:build` |
| 2 | iOS app tests run | **SIM** — 16 tests, iPhone 16 Pro simulator |
| 3 | Android debug APK builds | **AUTO** — `pnpm android:build` |
| 4 | Android staging APK builds | **AUTO** — `assembleStaging` |
| 5 | A build with no origin shows "not set up" and makes no request | **AUTO** — both platforms |
| 6 | A cleartext origin is refused outside development | **AUTO** — both platforms |
| 7 | Install on an iPhone | **BLOCKED** — no signing identity; see `P12_IOS_APP_TARGET_AND_SIGNING.md` §6 |
| 8 | Install on an Android phone | **DEVICE** — a debug APK exists and has not been installed |
| 9 | Sign in | **SIM** — flow exists (§1); model paths **AUTO**; hardware run still **DEVICE** |

---

## 3. Church discovery and joining

| # | Step | Status |
| --- | --- | --- |
| 10 | Search for a church by name | **AUTO** for the model paths; wired into first-run on both platforms; **DEVICE** run outstanding |
| 11 | Nearby churches, with location permission asked at the right moment | **BLOCKED** |
| 12 | Join a church with an open policy | **BLOCKED** |
| 13 | Request to join an approval-required church, and be approved from the dashboard | **BLOCKED** |
| 14 | An invite link opens the right church and nothing else | **AUTO** — deep-link parsing and the four route gates |

---

## 4. Announcements

| # | Step | Status |
| --- | --- | --- |
| 15 | The feed shows only what this relationship allows | **AUTO** — database tests |
| 16 | A members-only announcement is invisible to a follower | **AUTO** |
| 17 | It renders on a phone | **BLOCKED** |
| 18 | A push notification arrives and opens the right item | **BLOCKED** — no APNs key, no FCM credentials |

---

## 5. Automatic attendance

| # | Step | Status |
| --- | --- | --- |
| 19 | The education screen appears before any OS prompt | **AUTO** — asserted on both platforms |
| 20 | "When in use" is asked once, only when undetermined | **AUTO** |
| 21 | Restricted, denied and "services off" are three different answers | **AUTO** |
| 22 | Walking into a real geofence produces a check-in | **DEVICE** — needs a phone, a church, and a walk |
| 23 | Nothing is checked in from the car park across the road | **DEVICE** |
| 24 | Geofences survive a reboot | **DEVICE** — the receiver is asserted; the reboot is not |
| 25 | Battery over a Sunday morning | **DEVICE** — never measured |

---

## 6. QR and short-code check-in

| # | Step | Status |
| --- | --- | --- |
| 26 | The camera is untouched until "Scan the code" is tapped | **AUTO** — asserted on both platforms |
| 27 | A generated QR decodes | **AUTO** — a real generated image, decoded on the JVM |
| 28 | A real camera reads a real screen | **DEVICE** |
| 29 | A typed short code works when the camera is refused | **AUTO** for the logic, **DEVICE** for the camera refusal |
| 30 | One person scanning twice is counted once | **AUTO** — a unique index, driven concurrently |
| 31 | The kiosk total matches the dashboard | **AUTO** for the arithmetic, **DEVICE** for the kiosk |

---

## 7. Live streams and recordings

| # | Step | Status |
| --- | --- | --- |
| 32 | Only published recordings appear | **AUTO** |
| 33 | An MKV or HEVC recording cannot be published at all | **AUTO** — against byte fixtures |
| 34 | A real recording from a real service passes the gate | **BLOCKED** — the parser has never met a real file |
| 35 | Live HLS plays from the relay | **BLOCKED** — no relay access |
| 36 | A recording plays and scrubs on a phone | **DEVICE** |
| 37 | Revoking mid-playback stops it within about a minute | **DEVICE** — the number is a claim, not a measurement |

---

## 8. Sermon presentation

| # | Step | Status |
| --- | --- | --- |
| 38 | — | **Does not exist.** Prompt 10 was never built: no route, no service, no screen. The destination is unregistered and the capability is off on purpose |

---

## 9. Giving

| # | Step | Status |
| --- | --- | --- |
| 39 | Only published funds appear, and only for a charge-enabled church | **AUTO** |
| 40 | The amount is bounded three independent ways | **AUTO** |
| 41 | One logical attempt produces one payment intent | **AUTO** — concurrently, against PostgreSQL |
| 42 | A payment sheet opens | **BLOCKED** — no Stripe test key configured |
| 43 | A test-mode donation with `4242 4242 4242 4242` | **BLOCKED** |
| 44 | 3-D Secure with `4000 0025 0000 3155` reaches *processing*, not success | **BLOCKED** |
| 45 | The webhook confirms and the receipt appears | **BLOCKED** |
| 46 | Force-quitting mid-sheet and reopening produces **one** intent | **BLOCKED** — the most important unverified step in this document |
| 47 | Apple Pay / Google Pay | **BLOCKED** — neither is configured |

---

## 10. Switching, revocation, and purge

| # | Step | Status |
| --- | --- | --- |
| 48 | Switching church changes the cache partition | **AUTO** — the key includes the church |
| 49 | Being blocked removes every church-scoped tab | **AUTO** — both platforms |
| 50 | An authorization-version bump invalidates every cached partition | **AUTO** |
| 51 | Signing out purges everything, across every church | **AUTO** |
| 52 | The next person to sign in on the same phone sees nothing of the last | **DEVICE** |

---

## 11. Lifecycle and recovery

| # | Step | Status |
| --- | --- | --- |
| 53 | Background and foreground during a donation | **AUTO** — the state machine; **DEVICE** for the real thing |
| 54 | Airplane mode mid-request | **DEVICE** |
| 55 | Offline shows cached content marked stale, never invented rows | **AUTO** |
| 56 | Offline with no cache says so | **AUTO** |
| 57 | A cold start from a deep link | **AUTO** for parsing and authorization; **DEVICE** for the launch |

---

## 12. Accessibility

| # | Step | Status |
| --- | --- | --- |
| 58 | Localization parity across platforms | **AUTO** — 247 shared keys |
| 59 | No inline user-facing literal in a view | **AUTO** |
| 60 | Contrast meets WCAG minimums | **AUTO** — 22 pairs |
| 61 | VoiceOver and TalkBack read a card as one thing | **AUTO** — semantics asserted; **DEVICE** for how it sounds |
| 62 | Largest Dynamic Type / font scale does not truncate | **DEVICE** |
| 63 | Dark mode | **DEVICE** |
| 64 | Reduced motion | **AUTO** — there is no motion to reduce |

---

## 13. Failure and rollback drill

| # | Step | Status |
| --- | --- | --- |
| 65 | Take every church out of the apps with three `update` statements | **AUTO** — the statements are exercised by the database suite |
| 66 | Confirm the dashboard and the website's giving are untouched | **AUTO** |
| 67 | Do it against staging, under load, with someone watching | **STAGING** |
| 68 | Restore a backup taken beforehand | **BLOCKED** — no backup exists |

---

## 14. What to report back

For each numbered step: pass, fail, or not attempted — and for any failure, the
exact behaviour rather than a summary. In particular:

* **Step 46.** If force-quitting mid-payment ever produces two intents in the
  Stripe dashboard, stop the pilot. That is the failure the whole giving design
  exists to prevent and the one thing no local test can fully prove.
* **Step 34.** The first real recording through the eligibility parser. Record
  both codec strings verbatim, whatever they are.
* **Steps 22–25.** Automatic attendance is the feature most likely to behave
  differently outdoors than in a test.
* **Step 25.** There is no battery figure at all yet.
