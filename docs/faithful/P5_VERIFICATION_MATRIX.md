# Prompt 5 — Verification matrix

**Seven statuses, kept separate and not conflated.**

| Layer | Status |
| --- | --- |
| **A — Source completion** | ✅ Complete |
| **B — Local build and test** | ✅ Web, iOS, Android all built and tested here |
| **C — Hosted CI** | ⛔ Pending — workflow written, never run on a hosted runner |
| **D — Device / simulator** | ⛔ Pending — nothing run on a simulator, emulator, or phone |
| **E — Non-production database** | ⛔ Pending — `0054` has never been executed |
| **F — Provider (APNs/FCM)** | ⛔ Pending — signing is implemented and tested; **no credential exists and no notification has ever been sent** |
| **G — Production** | ⛔ Pending — nothing deployed |

A ✅ means a test ran and passed **on this machine**.

## Gate results

| Gate | Result |
|---|---|
| `pnpm ci:verify` | ✅ exit 0 |
| ├ lint | ✅ 0 errors (46 warnings, 44 pre-existing) |
| ├ typecheck | ✅ |
| ├ contract freshness | ✅ 3 artifacts current |
| ├ design tokens | ✅ 22 contrast pairs pass WCAG |
| ├ **localization parity** | ✅ **86 shared keys**, 3 documented Android-only |
| ├ tests | ✅ **280/280** |
| ├ migration baseline | ✅ |
| ├ secret scan | ✅ all repository files |
| └ production build | ✅ 22 mobile route entries emitted |
| `pnpm ios:test` | ✅ **99/99**, 12 suites |
| `pnpm android:test` | ✅ **49/49** |
| `pnpm android:build` | ✅ debug APK |
| `pnpm audit:prod` | ✅ 0 unresolved high/critical |
| `git diff --check` | ✅ |

**Total: 428 automated tests** (280 web + 99 Swift + 49 Kotlin).

## Completion gates

| # | Gate | Evidence | Result |
|---:|---|---|---|
| 1 | Discovery is the primary no-church onboarding path | `getOnboardingState`; `needsOnboarding` computed server-side | ✅ |
| 2 | Invitation onboarding uses no staff membership | no Faithful module touches `church_users` — asserted | ✅ |
| 3 | Search works without location permission | iOS test asserts request count is 0 | ✅ |
| 4 | Nearby uses foreground permission only | provider interfaces cannot express background | ✅ |
| 5 | Education precedes the OS prompt | iOS test: prompt count 0 after education shown | ✅ |
| 6 | Denied/restricted/unavailable fall back without a fix | iOS test, all three | ✅ |
| 7 | Follow/join go through Prompt 3 services | routes delegate to `followChurch`/`requestJoin` | ✅ |
| 8 | All three join policies | Prompt 3 state-machine tests, still green | ✅ |
| 9 | Pending does not block follower content | feed treats `following`+`joined` as followers | ✅ |
| 10 | Blocked fails closed | 3 layers: machine, SQL, cache purge | ✅ |
| 11 | Multi-church switching isolates cache | iOS partition tests | ✅ |
| 12 | Selected church dropped if no longer active | `getOnboardingState` | ✅ |
| 13 | **iOS strings localized and parity-tracked** | 86 shared keys; checker caught 4 leftovers | ✅ |
| 14 | Published projections are authoritative and bounded | `mobile_announcement_feed`, limit ≤50 | ✅ |
| 15 | Draft/scheduled/expired/unpublished never appear | migration test, 6 exclusions | ✅ |
| 16 | Wrong-target content never appears | targeting mapped to relationship states | ✅ |
| 17 | Poster-rich Home in both apps | `AnnouncementCard` ×2 | ✅ |
| 18 | Text-only fallback looks intentional | designed treatment, not a broken box | ✅ |
| 19 | Publication transactionally enqueues push | index-order assertion vs Facebook call | ✅ |
| 20 | Unpublish/delete withdraw and cancel | `withdrawMobilePublication` ×3 | ✅ |
| 21 | Existing publication paths still work | no change to Google/Facebook/email/iCloud | ✅ |
| 22 | Installation lifecycle | register, rotate, retire, invalidate | ✅ |
| 23 | Token never exposed | no field on `InstallationView`; Kotlin reflection test | ✅ |
| 24 | Sign-out/deletion retire installations | asserted both paths | ✅ |
| 25 | Outbox is durable, idempotent, retryable | unique `dedupe_key`, lease, capped backoff | ✅ |
| 26 | Duplicate workers cannot duplicate | `SKIP LOCKED` + unique key | ✅ |
| 27 | Push opens current authorized content | detail route re-authorizes, 404s | ✅ |
| 28 | Payload carries no identifiers | asserted | ✅ |
| 29 | Provider classification correct | 14 adapter tests | ✅ |
| 30 | Credential rejection never wipes tokens | asserted | ✅ |
| 31 | Unconfigured provider fails closed | `skipped`/`not_configured` | ✅ |
| 32 | Caches partitioned and purge correctly | 8 iOS cache tests | ✅ |
| 33 | Offline never fabricates a result | `offlineNoCache` state | ✅ |
| 34 | Nearby never stores or logs a coordinate | asserted: no writes, no `console.*` | ✅ |
| 35 | Coordinates in a body, never a query string | asserted | ✅ |
| 36 | Feed timezone is the church's | iOS test: 10:00 ET vs 07:00 PT | ✅ |
| 37 | Cursors keyset, bounded, no offset | migration test | ✅ |
| 38 | Nearby is a bounded index scan | bounding box asserted; **plan unmeasured** | ⚠️ |
| 39 | Prompt 2–4 tests green | 187 → 280, none removed | ✅ |
| 40 | No attendance/geofence/stream/sermon/payment | forbidden-symbol sweep | ✅ |
| 41 | **Church profile screen** | `ChurchProfileView` + `ChurchProfileScreen` | ✅ |
| 42 | **Church chooser screen** | `ChurchChooserView` + `ChurchChooserScreen` | ✅ |
| 43 | **Android notification education** | `NotificationEducationScreen` | ✅ |
| 44 | Action matrix derived, not stored | 9-case test on both platforms | ✅ |
| 45 | Church switch purges on version bump | iOS test: 2 partitions → 0 | ✅ |
| 46 | Blocked/left cannot be switched to | asserted both platforms | ✅ |
| 47 | Revoked relationship reloads the chooser | iOS test | ✅ |
| 48 | Android channels created at launch | `NotificationChannels.ensureCreated` | ✅ |
| 49 | Channel disabled in system settings is surfaced | `channel_silenced_by_system` | ✅ |
| 50 | iOS push entitlement declared | `Config/Faithful.entitlements`, both xcconfigs | ✅ |
| 51 | iOS token registration idempotent | test: repeat is a no-op | ✅ |
| 52 | Token rotation re-registers | test | ✅ |
| 53 | Failed registration never echoes the token | test | ✅ |
| 54 | Notification tap uses the fail-closed router | test: wrong church refused | ✅ |
| 55 | **APNs signs its own ES256 token** | verified against a generated P-256 key | ✅ |
| 56 | APNs signature is JOSE, not DER | test: 64 bytes, not `0x30` | ✅ |
| 57 | APNs refresh respects Apple's 20/60-minute rules | clock-driven test | ✅ |
| 58 | **FCM exchanges its own OAuth token** | verified against a generated RSA key | ✅ |
| 59 | FCM exchange is single-flight | 10 concurrent → 1 exchange | ✅ |
| 60 | OAuth error body is never read | test asserts `.text()` not called | ✅ |
| 61 | Credentials never become text | `redactForLog`; no `console.*` | ✅ |
| 62 | Rejected credential drops the cached token | both adapters | ✅ |
| 63 | **Worker has a registered invocation path** | `vercel.json` cron, 2 min | ✅ |
| 64 | Cron authorization is constant-time and generic | `compareSecret`, generic 401 | ✅ |
| 65 | Work is bounded per invocation | 25 default, 100 max | ✅ |
| 66 | Concurrent invocations are safe | `SKIP LOCKED` + per-invocation lease | ✅ |
| 67 | Lease recovery, no separate reaper | expiry re-admits the job | ✅ |
| 68 | Dispatch response leaks nothing | asserted on comment-stripped source | ✅ |

### Gate 38 — unmeasured

The nearby query's bounding-box structure is asserted in source, and the index
matches its exact filter. **No query plan has been run**, because that needs a
database with representative cardinality. Until §5 of the runbook is done, the
claim is "designed as a bounded index scan", not "measured as one".

## Test inventory

| Suite | Count |
|---|---:|
| Web unit + security + policies | 280 |
| ├ `faithful-publication-migration` | 20 |
| ├ `faithful-push` (adapters, dedupe) | 14 |
| ├ `faithful-discovery-authorization` | 23 |
| ├ `faithful-provider-auth` (ES256, RS256, refresh, redaction) | 19 |
| └ `faithful-worker-invocation` (cron, lease, retry) | 17 |
| iOS (`swift test`) | 99 |
| ├ Discovery and onboarding | 7 |
| ├ Home feed | 8 |
| ├ Feed formatting | 6 |
| ├ Church profile | 7 |
| ├ Church chooser | 8 |
| └ Push lifecycle | 12 |
| Android (`gradlew test`) | 49 |
| ├ `FeedContractTest` | 11 |
| ├ `ChurchActionTest` | 6 |
| └ `NotificationPromptingTest` | 3 |
| **Total** | **428** |

## Layer C — hosted CI ⛔

The `contract-and-native` job now also runs `localization:check` through
`verify:generated`. **Never executed on a hosted runner.** Unknown until it runs:
macOS runner availability, Android SDK provisioning time, total wall-clock.

## Layer E — non-production database ⛔

| Check | Blocker |
|---|---|
| Apply `0054` from baseline | No authorized database |
| Apply from a representative upgraded copy | No non-production copy |
| Confirm the projection is inert on arrival | No database |
| RLS matrix — 7 principals × 4 tables | No database |
| Two-connection `claim_notification_jobs` race | No database |
| `EXPLAIN (ANALYZE, BUFFERS)` × 4 queries | No representative cardinality |
| Confirm existing publication paths unaffected | No database |

## Layer F — provider ⛔

**No notification has ever been sent.** No APNs key, no FCM service account, no
`google-services.json`, no registered App ID, no notification channel created on
a real device.

**What is no longer pending:** the two known gaps from the first pass are
closed. The server now signs its own APNs ES256 token and exchanges its own FCM
OAuth token from configured credentials, with refresh, single-flight, and
invalidation on rejection. Both are verified without provider access — the tests
generate P-256 and RSA keys in-process and verify the signatures with the
matching public keys.

What remains is genuinely external: obtaining the credentials, registering the
App ID with the Push capability, and adding `google-services.json`.

## Layer D — device ⛔

No simulator, emulator, or physical device run. No rendered golden images. No
VoiceOver or TalkBack traversal. Accessibility semantics are in source and
unit-tested; no assistive technology has traversed either app.

## Explicitly not claimed

- **No push delivery.** Adapters, provider-token signing, and the worker are
  implemented and tested; **nothing has been sent to a real device**, and no
  scheduled invocation has run anywhere.
- **No device readiness.** Neither app has run anywhere but a headless build.
- **No non-production or production readiness.** `0054` has never executed.
- **No performance claim.** No query plan measured.
- **No device-verified accessibility.**
- **No visual parity claim.** Tokens match by construction; no image compared.
