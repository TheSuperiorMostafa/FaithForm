# Prompt 8 — Verification Matrix

*Every gate, its command, and its actual output. Anything that could not run is
listed as pending with the reason. A skipped task is not a pass.*

Executed on the Prompt 8 working tree, macOS, Node 24, Swift 6, JDK 17,
PostgreSQL 17.9.

---

## 1. Gates

| Gate | Command | Result |
| --- | --- | --- |
| Lint | `pnpm lint` | **0 errors**, 48 warnings (all pre-existing unused-variable warnings in scripts and types) |
| Types | `pnpm typecheck` | clean |
| Generated contract | `pnpm contract:check` | current across 3 artifacts |
| Design tokens | `pnpm design:check` | current; 22 contrast pairs pass WCAG minimums |
| Localization parity | `pnpm localization:check` | 159 shared keys, 3 documented platform-only |
| Web tests | `pnpm test` | **546 passed, 0 failed, 0 skipped** |
| Database tests | `pnpm test:concurrency` | **72 passed, 0 failed, 0 skipped** |
| Migration baseline | `pnpm test:migrations` | verified after 62 legacy migrations |
| Secret scan | `pnpm scan:secrets` | passed for 1,124 files |
| Next build | `pnpm build` | compiled successfully |
| iOS build | `pnpm ios:build` | build complete |
| iOS tests | `pnpm ios:test` | **263 tests in 25 suites passed** |
| Android tests | `gradlew test :app:testDebugUnitTest` | **BUILD SUCCESSFUL** |
| Android APK | `pnpm android:build` | BUILD SUCCESSFUL |
| Whitespace | `git diff --check` | clean |

### Test counts

| Suite | Before Prompt 8 | After | Added |
| --- | --- | --- | --- |
| Web (`pnpm test`) | 484 | **546** | +62 |
| Database | 41 | **72** | +31 |
| iOS | 217 | **263** | +46 |
| Android `:core:attendance` | 103 | **161** | +58 |
| Android `:app` | 52 | **66** | +14 |
| Android `:core:navigation` | 8 | **13** | +5 |
| Android `:core:contract` | 42 | 42 | — |
| Android `:core:storage` | 7 | 7 | — |
| **Total** | **954** | **1,170** | **+216** |

No Prompt 2–7 test was weakened or deleted. Three were **changed**, each
deliberately and each recorded in §5.

---

## 2. Required testing (§10), item by item

### Server and database

| Requirement | Where | Observed |
| --- | --- | --- |
| One display per occurrence under contention | `checkin-sessions.test.ts` | two connections → one session, one `was_existing` |
| A session cannot be started cross-tenant | same | `occurrence_not_found`, identical to a missing one |
| Refused once check-in closes | same | `too_late` |
| Cancelled service gets no display | same | `occurrence_cancelled` |
| Rotation clamped, not trusted | same | 1 → 15, 100000 → 120 |
| Stopping frees the occurrence | same | second start yields a new session |
| Two pollers converge on one code | same | same `code_id`, same nonce, one row |
| A later window rotates | same | different code and nonce |
| A re-poll returns the same code | same | `was_existing`, original nonce |
| Hash collision falls through | same | `derivation_attempt = 1` |
| All candidates collide → no short code | same | `ok = false`, fails closed |
| A stopped session claims no codes | same | `ok = false` |
| Typed code valid only inside its window | same | refused before and after |
| **A typed code is not consumed** | same | four consecutive redemptions all succeed |
| Stopping kills a live code | same | `session_ended` while still in-window |
| Unknown code reveals nothing | same | no session, occurrence, church or nonce |
| Many accounts, one nonce | same | 3 rows for 3 accounts; repeat is `false` |
| Concurrent identical scans → one row | same | 1 |
| A scan creates no fact by itself | same | 0 facts |
| Pairing spent exactly once under a race | same | 1 winner of 2 |
| Expired and unknown pairing identical | same | same reason |
| Pairing for a stopped display buys nothing | same | refused |
| Kiosk pairs once, code unusable after | same | 1 winner; third attempt refused |
| Kiosk resolves to one occurrence, no role | same | no `user_id`, `role`, `started_by`, `credential_hash` |
| Kiosk idle-locks and unlocks | same | `idle_locked`, then ok |
| **A polling kiosk cannot reset its own lock** | same | both calls fail |
| Expired vs unknown kiosk | same | `ended` vs `unknown` |
| Revocation is immediate | same | `unknown` |
| Kiosk check-in → one fact; retry finds it | same | `counted`, then `already_counted`, same fact |
| **QR + kiosk for one person = one fact** | same | 1 active fact |
| Purge removes capabilities, keeps history | same | session `ended`, not deleted |

### iOS

| Requirement | Observed |
| --- | --- |
| Construction prompts for nothing | `prompts == []` |
| The typed fallback never touches the camera | `prompts == []`, submission still sent |
| Scan raises exactly one prompt | `["camera"]`, then start |
| Granted / denied / restricted / dismissed | four distinct outcomes |
| Availability checked before permission | no prompt on a camera-less device |
| Start failure → unavailable, not denied | `blocked(.cameraUnavailable)` |
| Payload filter accepts only Faithful tokens | 8 negative cases |
| Oversized payload refused client-side | at `MAX_TOKEN_LENGTH` |
| Same code in frame acted on once | 25 reads → 1 request |
| A rotated code acted on immediately | new code passes the debounce |
| Two codes in one interval → one request | single-flight holds |
| Camera released before the request | `stopCount ≥ 1`, not running |
| Every scan a fresh identity | 500 distinct |
| A refusal does not poison the next scan | different keys, second counts |
| Only `counted`/`already_counted` succeed | including `.unknown` → refused |
| A network failure is not a check-in | `blocked(.offline)` |
| Alphabet matches the server | exact string |
| No substitution table | `OOOOOOO` normalises to empty |
| Deep link is inert | no prompt, no start, phase idle |

### Android

Same list, plus:

| Requirement | Observed |
| --- | --- |
| **A real QR decodes from a real luminance plane** | encode → render → decode round-trip |
| **Padded row stride respected** | stride 320 for a 300 px image |
| A 1024-character token decodes | at the contract's exact limit |
| Blank frames and noise return null | no false positive |
| Malformed geometry refused before decoding | 5 cases, no crash |
| The decoder is reusable across frames | blanks then codes then blanks |
| `ImageProxy` translation | through a real `ImageProxy` under Robolectric |
| **Every frame closed, including on a throwing callback** | `closed == true` |
| Soft vs hard denial distinguished | `DENIED_CAN_ASK_AGAIN` vs `DENIED_PERMANENTLY` |
| Manifest declares exactly the expected permissions | exact list assertion |
| No media or audio permission merged in | 5 forbidden entries |
| Camera is optional hardware | `required="false"` |

### Web and kiosk (server side)

| Requirement | Observed |
| --- | --- |
| No check-in route accepts a dashboard session | 4 symbols swept across 6 routes |
| Cookies are `HttpOnly`, `SameSite=Strict`, `Secure`, path-scoped | asserted |
| The public pages do no server work | 4 symbols swept |
| Uniform typed-code errors | exactly `invalid` and `throttled` per route |
| Atomic rate limits on every typed path | `consume_api_rate_limit` |
| Rate-limit keys never carry a code | asserted |

---

## 3. Non-vacuity of the sweeps (§8)

Each sweep walks the filesystem (not `git ls-files` — `apps/` is untracked and a
tracked listing returns nothing), asserts a **minimum file count**, and is proven
to bite by an injected violation.

| Sweep | Files inspected | Minimum asserted |
| --- | --- | --- |
| Native tree | **120 files** | > 60 |
| Native production subset | **96 files** | > 40, and strictly fewer than the whole |
| Server check-in files | **14** | ≥ 12 |
| Client check-in files | **6** | ≥ 4 |
| `lib/**` for the removed QR module | **243 files** | > 40 |

Specific files are asserted to be **inside** the swept set by name —
`AVFoundationScanner.swift`, `CheckInScanner.swift`, `QrScanning.swift`,
`CameraXScanner.kt`, `QrScanning.kt`, `CheckInScanner.kt`, `AndroidManifest.xml`
— because a sweep that misses the scanner proves nothing about the scanner.

### Injected violations, each restored byte-for-byte

| Injection | Into | Caught |
| --- | --- | --- |
| `ImageCapture.Builder().build()` | `CameraXScanner.kt` | 1 offender, correct file |
| `environment["ATTENDANCE_QR_SECRET"]` | `CheckInScanner.swift` | 1 offender, correct file |
| `.from("attendance_facts").insert({…})` | `kiosk-session.ts` | `attendance_facts.insert(` |

And the counterpart risk is tested too: a **comment** naming a forbidden symbol
must not be a violation. `CameraXScanner.kt` explains at length why there is no
`ImageCapture`, and the sweep stays green — otherwise it would be a permanent
false positive, the kind that eventually gets the whole sweep deleted rather than
fixed.

---

## 4. Defects found by executing rather than reading

Six, and every one of them would have shipped.

### 1. Ambiguous column reference — kiosk pairing was entirely broken

```
error: column reference "expires_at" is ambiguous
```

`pair_attendance_kiosk` returns an OUT parameter called `expires_at`, and
`attendance_kiosk_sessions` has a column called `expires_at`. PL/pgSQL resolves
the unqualified reference in the `WHERE` clause to the OUT parameter and raises at
**run time**, not at creation — so the function was created successfully, the
migration applied cleanly, and every kiosk pairing would have failed in
production. Six tests failed on it at once.

Fixed by aliasing the table and qualifying every predicate. The same class of bug
was then audited across all eight functions: `resolve_attendance_kiosk_session`
had it too, on `idle_lock_seconds`.

### 2. A hang that hid every failure

The first database test file cleaned up and closed connections in one `finally`.
The first failing assertion made cleanup throw, the close never ran, and an open
`pg` connection kept Node's event loop alive — so the run hung silently for
minutes instead of reporting the failure that caused it. Fixed by separating
closing from cleaning, so cleaning cannot prevent closing.

### 3. A 1-in-390 flaky test in the Prompt 5 suite

`tests/unit/faithful-provider-auth.test.ts` asserted a raw P-256 signature's first
byte is not `0x30`. That byte is the top byte of `r` and is uniformly random —
measured at **0.26% over 5,000 freshly generated keys**. It failed a Prompt 8
verification run on a perfectly correct signature. The 64-byte length check
already excludes DER; the replacement checks the DER *shape* and cannot fire by
coincidence.

### 4. The dashboard told a pastor to set an environment variable

Caught by the privacy sweep, not by review. A pastor is not the person who edits
`ATTENDANCE_QR_SECRET`, and naming it on screen was one more place a deployment
detail travelled to a browser. The copy now says check-in codes are not set up;
the variable is named in the operations runbook.

### 5. The authority sweep forbade a legitimate read

The first version banned the string `attendance_facts` outright, which made the
kiosk's "already checked in" indicator a violation. Rewritten to distinguish a
write from a read — and a test now asserts *both* directions, so the read stays
allowed and an injected write is still caught.

### 6. A test that tested nothing

An early Android test constructed unused objects and asserted a tautology while
appearing to cover the analyser hand-off. Replaced with one that actually drives
the callback and proves the work happens on the coroutine side, and the
production design was simplified to match iOS in the process.

---

## 5. Prompt 2–7 tests: what changed, and why

No test was weakened or deleted. Three were changed:

| Test | Change | Why |
| --- | --- | --- |
| `no Prompt 8 or out-of-scope feature leaked in` | renamed; camera symbols removed, **eight new forbidden symbols added** | Prompt 7 forbade `AVCaptureSession` and `CameraX` because scanning was Prompt 8's work. The boundary moved. What replaced it is stricter: the camera is reachable from exactly two adapters, no capture-to-disk API exists, and no early surface holds a scanner — plus new bans on other barcode formats, face detection, biometrics and NFC |
| `the manifest declares the three location permissions and no more` | `CAMERA` added to the exact list; a new test asserts the camera is optional hardware | The permission is legitimate and is requested only after an explicit tap. The list stays exact, so anything a library merges in still has to be argued for |
| `the APNs signature is raw r‖s, not DER` | the coincidence-prone byte check replaced with a shape check | It was flaky; see §4.3 |

`tests/unit/attendance-sources.test.ts` was **rewritten around the new modules**,
because `lib/attendance/v2/qr.ts` no longer exists. Every property the old file
asserted has a new home:

| Old assertion | New home |
| --- | --- |
| round-trips, bound to its target | `a capability round-trips and is bound to its session and occurrence` |
| contains no secret and no People data | same name, now also checking `lat`/`lon` |
| a code for another target is refused | `a token minted for one purpose never verifies as another` — **stronger**, at the signature rather than a claim check |
| an expired code is refused | expiry is checked in `resolveScannedToken`; the arithmetic is covered by the window tests |
| a tampered code fails before its contents are trusted | same name |
| malformed input is refused rather than parsed | same name, 8 cases |
| a weak or placeholder secret refuses to sign | same name, now also covering `keyedHash` and `checkinSigningStatus` |
| each mint produces a distinct nonce | replaced by `the QR nonce is a function of the session and window, not of chance` — the semantics changed deliberately, and the *unpredictability* is asserted separately |

Plus twelve assertions the old file could not make: key rotation with a grace,
key ids revealing nothing, sub-key separation across every capability type,
epoch-aligned windows, unbiased character selection, and the alphabet's
confusable-pair removal.

---

## 6. Pending — cannot be run here

Each with the exact reason. **None of these is claimed as passing.**

| Item | Reason it cannot run | How it would be verified |
| --- | --- | --- |
| `AVCaptureSession` frame delivery | `swift test` runs on macOS; no iOS camera, and no simulator vends real frames | Runbook steps 5–12 |
| `ProcessCameraProvider.bindToLifecycle` | Needs a real camera and a real `LifecycleOwner` | Runbook steps 5–12 |
| Scanning a projector at distance | Needs a projector and a phone | Runbook steps 6, 25–27 |
| Short-code legibility from the back row | Needs a room | Runbook step 26 |
| A kiosk on a real tablet | Needs a tablet | Runbook steps 21–24 |
| Applying 0059 to production | Deliberately not done from a test harness | Runbook §2 |
| `pnpm audit:prod` against production | Would need production credentials | It will fail until `ATTENDANCE_QR_SECRET` is set — that is the intended change |
| App Store / Play submission | No app target, no signing key, no listing | `P4_EXTERNAL_SETUP_RUNBOOK.md` |
| Battery cost of scanning | Not measured | Runbook |

**No claim is made that a camera, a QR code on a real screen, a kiosk on a real
device, or any deployment works.** The seams around all of them are tested; the
hardware and the deployment are not.

---

## 7. Scope, honoured

Not implemented: livestreams, recordings, sermon archive, presentations,
donations, mobile payments, new discovery or onboarding behaviour, face
recognition, biometric identification, NFC attendance, permanent printed QR
codes, unattended People-directory browsing, and analytics or advertising
identifiers. Where a symbol can express the exclusion, a sweep asserts it —
see `P8_SECURITY_AND_PRIVACY_MODEL.md` §12.

Two changes outside Prompt 8's own surface, both recorded rather than folded in
silently: the deletion of the superseded `lib/attendance/v2/qr.ts`, and the flaky
APNs assertion. Both are explained in `P8_SECURITY_AND_PRIVACY_MODEL.md` §13.

Migrations **0055, 0056, 0057 and 0058 were not modified**. Two independent
checks, because `git diff` cannot help here — those files are untracked in this
working tree, so there is no committed baseline to compare against:

1. **Modification times.** All four are stamped 2026-08-24, before any Prompt 8
   file existed; `0059` is stamped 2026-08-25 01:50.
2. **Content.** `tests/security/checkin-authority.test.ts` asserts that none of
   the four mentions `attendance_checkin_sessions`,
   `attendance_checkin_codes`, `attendance_display_pairings`,
   `attendance_kiosk_sessions`, or `attendance_qr_scan_redemptions` — so a
   Prompt 8 concept cannot have been added to one of them without failing.
