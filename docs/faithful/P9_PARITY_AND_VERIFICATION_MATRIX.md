# Prompt 9 — Parity and Verification Matrix

*Every gate, its command, its actual output — and, for each behaviour, whether
both platforms do the same thing.*

**Re-run in full after the publication-eligibility closure and the
media-eligibility hardening pass** (`P9_MEDIA_ELIGIBILITY.md`). Every figure
below is from the latest re-run, not from an earlier pass.

Executed on the Prompt 9 working tree: macOS, Node 24, Swift 6, JDK 17,
PostgreSQL 17.9.

---

## 1. Gates

| Gate | Command | Result |
| --- | --- | --- |
| Lint | `pnpm lint` | **0 errors**, 49 warnings (pre-existing unused-variable warnings in scripts and types) |
| Types | `pnpm typecheck` | clean |
| Generated contract | `pnpm contract:check` | current across 3 artifacts |
| Design tokens | `pnpm design:check` | current; 22 contrast pairs pass WCAG minimums |
| Localization parity | `pnpm localization:check` | **189 shared keys**, 3 documented platform-only |
| Web tests | `pnpm test` | **664 passed, 0 failed, 0 skipped** |
| Database tests | `pnpm test:concurrency` | **130 passed, 0 failed, 0 skipped** (fresh database, migrations 0055–**0062** applied) |
| Migration baseline | `pnpm test:migrations` | verified after 65 legacy migrations — **the scanner was broadened first; see §4.8** |
| Secret scan | `pnpm scan:secrets` | passed for 1,169 files |
| Production dependency audit | `pnpm audit:prod` | `unresolvedHighOrCritical: []` |
| Production web build | `pnpm build` | compiled successfully |
| iOS build (host) | `pnpm ios:build` | build complete |
| **iOS build (device)** | `pnpm ios:build:device` | **clean: no errors, no warnings** — new; see §4.12 |
| iOS tests | `pnpm ios:test` | **294 tests in 32 suites passed** |
| Android tests | `gradlew test` | **BUILD SUCCESSFUL** |
| Android app tests | `:app:testDebugUnitTest` | **69 executed** — not `NO-SOURCE` |
| Android debug APK | `gradlew :app:assembleDebug` | BUILD SUCCESSFUL |
| Whitespace | `git diff --check` | clean |

Two gates are run repeatedly rather than once, because a concurrency test that
passes once has not been observed to work:

| Gate | Command | Result |
| --- | --- | --- |
| Web tests under CPU load, ×10 | `pnpm test` | 10/10 green — the injection race is gone (§4.11) |
| iOS tests, ×15 | `pnpm ios:test` | 15/15 green — the single-flight flake is gone (§4.10) |

### Test counts

| Suite | Before Prompt 9 | After Prompt 9 | After the closure | After hardening | Added |
| --- | --- | --- | --- | --- | --- |
| Web | 546 | 591 | 620 | **664** | +118 |
| Database | 72 | 100 | 118 | **130** | +58 |
| iOS | 263 | 292 | 294 | 294 | +31 |
| Android `:core:media` | — | 40 | 44 | 44 | +44 (new module) |
| Android `:core:attendance` | 161 | 161 | 161 | 161 | — |
| Android `:app` | 66 | 69 | 69 | 69 | +3 |
| Android `:core:contract` | 42 | 42 | 42 | 42 | — |
| Android `:core:navigation` | 13 | 13 | 13 | 13 | — |
| Android `:core:storage` | 7 | 7 | 7 | 7 | — |
| **Total** | **1,170** | **1,315** | **1,368** | **1,424** | **+254** |

The closure added **53**: 29 web, 18 database, 2 iOS, 4 `:core:media`.

The hardening pass added **56**: 44 web (23 codec-configuration and parser-safety
tests against real `avcC` and `esds` records, 16 object-identity tests, 5
enforcement sweeps) and 12 database.

No Prompt 2–8 test was weakened or deleted. Three were **changed**, each
deliberately and each recorded in §5. The closure changed one Prompt 9 test
helper — recorded there too.

---

## 2. Required testing, item by item

### Server and database (§6)

| Requirement | Observed |
| --- | --- |
| Publish / unpublish lifecycle | a recording that merely exists is invisible; publishing makes it visible; unpublishing removes it from list **and** detail |
| Scheduled / live / ended / recording-ready transitions | four separate tests, including that `live` requires a session with `ingest_started_at` |
| **Recording not visible until explicitly published** | `a recording that merely exists is invisible`; `publishing a live service does not publish any recording` |
| A processing recording cannot be published | refused even when `mobile_visibility` says otherwise |
| Tenant isolation | `one church never sees another's published media`; cross-church grant refused |
| Relationship isolation | five states asserted; `blocked` sees nothing at all |
| Hidden / unknown / blocked indistinguishable | equal row counts asserted |
| Cursor scope | `media-archive` kind; `decodeCursor` refuses a mismatch |
| ETag semantics | every visitor-visible field bumps the version (6 columns) |
| **No ETag change for provider bookkeeping** | 5 columns changed, version unmoved |
| Capability issuance / expiry / refresh / revocation | 17 unit tests plus 6 database tests |
| Cross-account replay | `a` claim; a mismatch is refused |
| Concurrent publish/unpublish | two connections; the projection agrees with whichever row won |
| Concurrent capability acquisition during an unpublish | both refused |
| Webhook replay/security | **not modified by Prompt 9** — recorded as pre-existing in the privacy model, §10 |
| Cache invalidation / projection versioning | church-wide version moves on any visible change |
| Attendance untouched | the three attendance functions still exist; no `mobile_*` column on `attendance_facts` |
| Legacy stream behaviour preserved | 0034's `published` status remains unused and does **not** publish a recording |

#### Publication eligibility (closure)

| Requirement | Observed |
| --- | --- |
| A valid HLS rendition is publishable and playable | `hls` kind accepted end to end; grant carries `renditionKind: "hls"` |
| A valid progressive rendition is publishable **only** if both platforms are explicitly supported | H.264 + AAC in an ISO brand publishes; HEVC does not, because Android decode is device-dependent |
| **An MKV cannot be published** | refused by the parser (Matroska EBML magic), by the projections, and inside the publish `UPDATE` |
| An unsupported codec or container cannot be published | `ac-3`, `hvc1`, `qt  `-only, and unrecognised bytes each refused, by fourcc not by filename |
| A missing, corrupt, still-processing or deleted rendition cannot be published | four separate refusals; a storage failure is recorded as **transient**, never as a verdict |
| An unverified rendition cannot be published | `mobile_playable` defaults false; no row is publishable before it is proved |
| A direct API bypass is rejected | the gate is **inside the `UPDATE`**, and a check constraint refuses `set mobile_playable = true` without the evidence |
| Existing published rows are **not** grandfathered | a published-but-unverified row is absent from list, search, detail **and** the grant |
| Losing a rendition blocks a new capability | re-probe flips the row; `grantPlayback` also re-checks the object exists |
| Cross-tenant and authorization behaviour unchanged | the isolation tests above still pass against the gated projections |
| Generated TS / Swift / Kotlin / fixtures agree | `renditionKind` generated into all three; `pnpm verify:generated` current |
| Enforced in four independent places | asserted by name: dashboard, publish mutation, projections, grant |
| **No transcoder was added** | sweep over the media path **and** `package.json` |

#### Codec configuration and object identity (hardening)

| Requirement | Observed |
| --- | --- |
| The same `avc1` label with a rejected profile | High 10, High 4:2:2, High 4:4:4 and six intra/CAVLC variants each refused from `avcC`, with the fourcc still `avc1` |
| The same `avc1` label with a rejected level | 4.3 and above refused; 4.2 itself accepted, so the ceiling is inside the policy rather than beside it |
| A supported portable profile/level | every profile in the policy accepted and reported as an RFC 6381 codec string |
| 10-bit and 4:2:2 | refused from `avcC`'s High-profile tail, without decoding an SPS |
| An unsupported AAC profile | AAC-LTP, Scalable, ER, ELD and xHE-AAC refused; LC, HE-AAC and HE-AACv2 accepted |
| An `mp4a` entry carrying MP3 | refused on `objectTypeIndication` — the case a fourcc check misses entirely |
| Channel and sample-rate bounds | 64/88.2/96 kHz refused, indexed **and** explicitly signalled; 0, 6, 8 channels refused |
| Missing codec configuration | `codec_config_missing` — unprovable, never assumed good. `avc3` may omit parameter sets; `avc1` may not |
| Encrypted or protected sample entry | `encv`/`enca`, a `sinf` inside an ordinary entry, and a `pssh` at `moov` level |
| Duplicate/conflicting codec descriptions | a compliant first `stsd` entry with an HEVC second one; two video tracks that disagree |
| Malformed nesting, oversized lengths, overflow | a child past its parent, an `avcC` SPS length of 0xFFFF, a never-terminating `esds` expandable length, an illegal NAL length size, a wrong configuration version |
| Depth and box-count limits | a 12-deep nesting bomb and a 5 000-box file, both refused in under two seconds |
| The counterpart risk | a *legal* four-byte `esds` length still parses — refusing the runaway did not mean refusing the form |
| **Storage object overwritten after probe** | the row is withdrawn from list, search, detail and grant in one statement, and the publication version moves with it |
| **Version/ETag mismatch at publish** | refused inside the `UPDATE`, with the right revision and the wrong hash, and again with the right hash and the wrong ETag |
| Omitting the identity is not a bypass | `is not distinct from` — a null expectation matches only a row that also has none |
| **Mismatch at capability issuance** | `grantPlayback` re-checks and withdraws; `identityMatches` is driven with real 206 headers |
| **Corrected re-upload requires a reprobe** | the withdrawn verdict cannot publish at its own revision *or* at the current one; a fresh probe binds a new identity and the recording returns with nobody re-publishing |
| **Delivery serves the verified object** | `If-Match` on every range request, 412 handled, the response's own validator compared, the body cancelled on mismatch |
| Cached lists cannot bypass invalidation | the publication version moves on withdrawal, so every stored ETag is stale |
| Cross-tenant behaviour unchanged | every identity-bearing function keeps its tenant predicate on the write |
| A weak validator is never an identity | `W/"…"` discarded, and proven unable to authorise *or* invalidate |
| Nothing comparable is not a match | the fail-closed floor, asserted in both directions |

### Swift (§6)

| Requirement | Observed |
| --- | --- |
| Contract fixtures decode | live (present and null), archive, grant, additive-unknown |
| List / detail / cache behaviour | client caches projections under the partition |
| ETag revalidation | `ifNoneMatch` on every projection call; 304 returns the cached value |
| Cache partition and purge | positions isolated across accounts and authorization versions |
| Player façade commands and state mapping | every command and every event |
| **Capability refresh single-flight** | two callers, gated grant, one request — a **rendezvous**, not two hopeful `async let`s, plus a time limit so a regression fails instead of hanging (§4.10) |
| Background / foreground transitions | saves on background; refreshes an expired capability on foreground |
| Resume-position security and bounds | live excluded, 30 s floor, completion tail, 20 entries, 30 days |
| Revocation / unpublish behaviour | refused refresh is terminal; old capability not reused |
| No token logging / persistence | ephemeral session, no `urlCache`, no cookie store; capability absent from the resume store |
| Localization and accessibility | no inline literal; parity check green |

### Kotlin / Android (§6)

| Requirement | Observed |
| --- | --- |
| Contract fixtures decode | generated `Contract.kt` compiles and is asserted by `:core:contract` |
| List / detail / cache behaviour | `MediaScreenState` covers every phase |
| ETag / cache partition / revocation purge | partition key includes the authorization version |
| **Media3 façade request / state / error mapping** | `CapabilityHeaders` + `PlayerFailureMapping.fromPlayerError`, both on the JVM |
| Media3 constants still match the library | `:app` plain JUnit, 9 constants |
| Capability refresh single-flight | mutex; **proven by removing it and watching the test fail**. Deterministic on `runBlocking`'s single thread, where `yield()` is enough; the Swift equivalent needed more (§4.10) |
| Audio focus through a testable boundary | `AudioFocusPolicy`, all four transitions |
| Resume-position security and bounds | same rules as iOS, asserted independently |
| **Android app test task with nonzero executed sources** | 69 tests executed |
| Localization / accessibility | parity green; merged semantics on cards; live region on failures |
| No capability logging / persistence | swept |

### Dashboard (§6)

| Requirement | Observed |
| --- | --- |
| Publication controls and audit record | `publishToFaithful` writes an audit row with the actor; four actions asserted |
| Visibility preview | reads the **same** projection functions the app calls |
| Eligibility states and refusal copy | two new states; the copy names no codec, brand, bucket or path |
| Publish re-probes and uses optimistic concurrency | a stale verdict is refused rather than acted on |
| Live / recording lifecycle states | ten states derived and rendered |
| Unpublish / revoke confirmation | two dialogs; revoke states what it does to someone mid-service |
| Responsive and keyboard-accessible | radio groups in `fieldset`/`legend`, labelled textarea, standard buttons; `flex-wrap` throughout |

---

## 3. Behavioural parity

Same behaviour on both platforms unless the row says otherwise.

| Behaviour | iOS | Android | Same? |
| --- | --- | --- | --- |
| No live area when nothing is live | ✅ | ✅ | ✅ |
| Live / upcoming / recently-ended states | ✅ | ✅ | ✅ |
| Watch button only when on air | ✅ | ✅ | ✅ |
| Archive: search, keyset paging, poster-first cards | ✅ | ✅ | ✅ |
| Two distinct empty states | ✅ | ✅ | ✅ |
| Blocked / offline / retry states | ✅ | ✅ | ✅ |
| Seek on recordings only | ✅ | ✅ | ✅ |
| Resume on recordings only, same bounds | ✅ | ✅ | ✅ |
| Refresh 60 s before expiry, single-flight | ✅ | ✅ | ✅ |
| Refused refresh is terminal | ✅ | ✅ | ✅ |
| One retry on `unavailable`, none on `network` | ✅ | ✅ | ✅ |
| Four error cases, no transport detail | ✅ | ✅ | ✅ |
| Capability in a header, never a URL | resource loader | request properties | ✅ behaviour, ≠ mechanism |
| Audio focus | system-managed | `AudioFocusPolicy` | ❌ platform difference, documented |
| MKV recordings | ~~cannot play~~ | ~~plays~~ | ✅ **the difference is gone** — an MKV cannot be published, so neither platform is offered one |
| Rendition MIME for a progressive file | probed by `AVPlayer` | **declared** from `renditionKind` | ✅ behaviour, ≠ mechanism |
| An unknown `renditionKind` | falls back to `progressive` | falls back to `progressive` | ✅ |

---

## 4. Defects found by executing

Thirteen — five in Prompt 9, six in the closure, two more in the hardening pass —
and every one would have shipped.

### 1. The contract generator emitted `Bool` for every `const`

```
DecodingError.typeMismatch: expected Bool. Path: items[0].kind
```

`nativeType` mapped `node.const !== undefined` to a boolean. That was
*accidentally* right while the only consts in the contract were `ok: true` on the
success and failure envelopes. Prompt 9 added the first `z.literal("recording")`,
and the generator silently produced a Swift `Bool` and a Kotlin `Boolean` that
**compiled and then failed to decode at run time**.

Found by a fixture test. Fixed by deriving the type from the constant's own type,
with a regression test asserting a string literal generates `String` while the
boolean consts still generate `Bool`.

### 2. Robolectric cannot instrument Media3

`:app:testDebugUnitTest` went from 20 seconds to not finishing at all the moment
a Robolectric test constructed a real `PlaybackException`. Isolated by running
the pre-existing tests (fine), then a bare Robolectric probe (fine), then the new
class (hung).

The response was not a workaround. The two things the adapter was still deciding
— what a request carries, and what an error code means — **were decisions living
in the wrong module**, contradicting this project's own "the adapter holds no
decisions" rule. Both moved to `:core:media`, the Media3 objects became lazy, and
what is left in `:app` is a plain JUnit test over compile-time constants.

Runtime went from *never* to 20 seconds, and the coverage got better rather than
thinner.

### 3. The single-flight test was not testing concurrency

The Kotlin version asserted two callers produced one request and failed with
three. The fake granter never suspended, so `runBlocking`'s single thread ran the
two `async` blocks to completion in sequence — the first released the in-flight
flag before the second read it.

A test defect, not a production one. Fixed with a `CompletableDeferred` gate that
holds the first grant open, and then **proven to bite**: removing the mutex makes
it fail, restoring it makes it pass.

### 4. `published` was a dead status, and `visibility` was a trap

Traced during the inspection, not by a test. `getPublishedRecordingForChurch`,
`listStreamRecordings` and `updateStreamRecording` had **zero callers**, and
nothing anywhere set `status = 'published'` — so a gate that filters on exactly
that status could never be passed.

Meanwhile `visibility ∈ {public, unlisted}` from 0047 is a *website listing*
concept. Treating it as a mobile publication signal would have published every
recording a church ever made to every visitor's phone. A database test now
asserts a row carrying the legacy `published` status does **not** appear in the
archive.

### 5. The relay credential assertion moved without its property

Refactoring the upstream fetch into `lib/stream/relay-upstream.ts` broke
`browser and native stream surfaces cannot serialize the persistent publish key`,
which asserted a literal line in the HLS route.

The property is real and now holds in its new home — **and more strongly**: the
test asserts the credential is built in the shared module, that nothing returns
it, and that *neither* route builds one of its own.

### 6. A timestamp is a lossy optimistic-concurrency token *(closure)*

The publish mutation first took `p_expected_verified_at timestamptz` to prove it
was acting on the verdict the dashboard had shown.

Postgres stores microseconds; a JavaScript `Date` holds milliseconds. The value
round-tripped lossily, the equality **never** matched, and **every publish failed
as `verification_stale`**. Not a subtle path — the main one.

Found by running the database tests, not by reading the SQL. Replaced with a
monotonic integer revision, which survives the trip exactly.

### 7. My own Prompt 9 fixtures published unverified rows *(closure)*

Adding the gate turned eighteen previously-passing database tests red, because
their fixtures published recordings nothing had ever verified.

The gate was right and the fixtures were wrong — which is exactly the
production defect this closure exists to prevent, reproduced in the test suite.
`seedRecording` now records a playable verdict when a fixture is published, and
takes `verified: false` explicitly for the tests that exercise the gate itself.

### 8. The migration baseline scanner ignored `create function` *(closure)*

`verify-migration-baseline.mjs` recognised `create or replace function` in three
places and plain `create function` in none. Migration 0061 has to drop and
recreate three functions, because their return types changed and
`create or replace` cannot do that — so the scanner treated them as
uncreated. It flagged the legitimate `grant execute` and, worse, silently
**skipped the pinned-`search_path` check on all three `SECURITY DEFINER`
functions**.

Broadening the three regexes to `create (or replace )?function` fixes the false
positive and closes the hole. Proven non-vacuous by injecting an unpinned
`SECURITY DEFINER` function and a shadowed baseline function — both caught, both
restored byte-for-byte.

### 9. A QuickTime fixture that was wrong about itself *(closure)*

A test built a file with major brand `qt  ` and expected refusal — while still
writing the default compatible brands, which include `isom`.

The parser was right: a file declaring ISO compatibility **is** ISO-compatible,
and that is what a compatible-brands list is for. The fixture was fixed to
declare `qt  ` alone, and a second test now documents the accepting case
deliberately.

### 10. The iOS single-flight test had the Kotlin bug too *(closure)*

The Kotlin single-flight test was already fixed once for exactly this (§4.3).
The Swift one was never re-examined, and re-running the suite for the closure
caught it failing once in twelve runs.

Same root cause, different concurrency model. `async let` creates a child task;
it does not run it. The test opened the gate and released it in the next
statement, so the release could land before either caller reached `grant` — and
then the two refreshes ran one after the other, the first clearing the in-flight
flag before the second read it. The test passed while proving nothing.

`runBlocking`'s single-threaded dispatcher made `yield()` sufficient on Kotlin.
Swift's concurrent executor gives no such ordering, so the fix is a real
rendezvous: `waitUntilCalls(2)` suspends the test until the first caller is
provably parked inside `grant`, and only then does the second one run.

That makes a *broken* single-flight deadlock rather than fail, so the test also
carries `.timeLimit(.minutes(1))`. Removing the flag now reports **two** issues —
the time limit and the count — instead of hanging. Verified: 15 consecutive
green runs with the guard, a clean failure without it.

Found only by running the suite repeatedly. One green run is not evidence about
a concurrency test.

### 11. The non-vacuity proofs raced each other *(closure)*

Six tests proved their sweeps bite by writing a real violation into a real
source file, re-running the real sweep, and restoring the file in a `finally`.

`node --test` runs test **files** in parallel processes, and several of them
sweep the same native tree. So one file's injection window is visible to
another file's sweep. Under load it fired: `AVAssetDownloadTask` reported in
`AVPlayerAdapter.swift` by the Prompt 7 scope guard while
`media-privacy.test.ts` had it injected — one run in eight.

Two problems, not one. The flake is the visible half; the other is that an
interrupted run — a timeout, a `^C` — leaves an injected violation sitting in a
tracked source file.

The injection now goes into a **copy** in a temp directory, and the sweep is
handed that path alongside the real tree. It proves exactly the same thing —
real source text, real sweep, real catch — and touches nothing anyone else can
see. The one property a copy could weaken, *that the walk finds the real file*,
is now asserted directly instead of inferred.

Verified: blinding the sweeps fails all four file-list proofs; 10 consecutive
green runs under the same load that reproduced the race.

Found by running the suite repeatedly under load. Neither the flake nor the
working-tree hazard shows up in a single green run.

### 12. Nothing ever compiled the iOS-only code *(hardening)*

`swift build` and `swift test` compile for the **host**, which is macOS. Every
`#if os(iOS)` block in `FaithfulKit` was therefore invisible to them — the camera
scanner, the AVFoundation player adapter, the resource loader. That is most of
the code that touches a platform framework, and no gate had ever built it.

It was hiding a real break. `AVFoundationScanner` held an `AVCaptureSession` —
not `Sendable`, and never going to be — as actor state, and marked `stop()`
`nonisolated(unsafe)`, where it means nothing at all:

```
error: non-Sendable type 'AVCaptureSession' of property 'session'
       cannot exit actor-isolated context
error: actor-isolated property 'session' cannot be accessed from
       outside of the actor
warning: 'nonisolated(unsafe)' has no effect on instance method 'stop()'
```

Three errors and two warnings, invisible to sixteen green gates.

The compiler's own suggestion — `@preconcurrency import AVFoundation` — would
have turned the errors into warnings and kept the bug. `startRunning()` blocking
an actor's executor is a real defect, not paperwork. So the session and its
output moved into a `CaptureBox`: `@unchecked Sendable` because it owns them and
serialises every touch on one private queue, with the blocking calls off the
actor entirely. The idempotence the facade promises is now real too — the
`isRunning` check happens on the same queue as the start, so two callers cannot
both observe "not running".

Two more iOS-only warnings fell out of the same build: an `await` on a
non-`async` lock-guarded method in `AVPlayerAdapter`, and an unused binding in
`AutomaticAttendance`.

**`pnpm ios:build:device` is the gate that closes this**, added to `package.json`
and to CI. It compiles for `generic/platform=iOS` — no device, no simulator
runtime — and **treats warnings as failures**, because a warning in code no other
gate compiles is a warning nobody will ever see again. Proven non-vacuous by
re-introducing the `nonisolated(unsafe)` and watching it fail.

Found by the user reporting it in Xcode. Worth saying plainly: sixteen green
gates did not find it, because none of them built for the platform the app ships
on.

### 13. A publish would have written two audit rows *(hardening)*

Migration 0062's `publish_recording_to_faithful` picked up an audit insert while
being rewritten. The caller already writes one — it knows the actor and whether
this was a first publication or a visibility change, and the function knows
neither.

It failed loudly rather than quietly, because the invented insert named columns
the audit table does not have. Had the column names happened to match, every
church's publication history would have doubled silently.

---

## 5. Prompt 2–8 tests: what changed, and why

No test was weakened or deleted. Three were changed:

| Test | Change | Why |
| --- | --- | --- |
| `browser and native stream surfaces cannot serialize the persistent publish key` | the relay-credential assertion moved to `relay-upstream.ts`; **two new assertions added** | the upstream fetch was extracted so both HLS front doors share one relay contract; see §4.5 |
| `no Prompt 8 or out-of-scope feature leaked in` → `no out-of-scope feature leaked in` | `AVPlayer` and `ExoPlayer` removed; **nine new forbidden symbols added** | Prompt 7 forbade them because playback was Prompt 9's work. What replaced the guard is stricter: no WebView player, no download API, no cast provider, no comment surface |
| `tests/unit/mobile-contract.test.ts` | **two tests added** | the generator regression from §4.1, and a media-contract provider-detail sweep |

And three more changed in the closure, none weakened:

| Test | Change | Why |
| --- | --- | --- |
| `seedRecording` in `tests/database/media-publication.test.ts` | records a playable verdict when the fixture is published; takes `verified: false` where the gate itself is under test | §4.7 — the old helper published rows nothing had verified, which the gate correctly hid |
| `two callers noticing at once produce one request` (Swift) | a real rendezvous plus a time limit; **one assertion added** | §4.10 — it passed without the callers overlapping, once in twelve |
| The six injected-violation proofs | inject into a temp copy, never the working tree; **five `the walk never reached …` assertions added** | §4.11 — they raced each other, and an interrupted run left a violation in a tracked file |

---

## 6. Non-vacuity of the sweeps

`tests/security/media-privacy.test.ts` walks the filesystem (not `git ls-files` —
`apps/` is untracked and a tracked listing returns nothing), asserts minimum file
counts, and is proven to bite.

| Swept set | Files | Minimum asserted |
| --- | --- | --- |
| Native tree | 120+ | > 60 |
| Native production subset | 96+ | > 40, strictly fewer than the whole |
| Native media files | 6+ | ≥ 6 |
| Server media files | 13 | ≥ 10 |
| Transcoder symbols (closure) | media path **and** `package.json` | none present |

Five specific files are asserted **inside** the swept set by name, because a
sweep that misses the player proves nothing about the player.

### Injected violations, each into a temp copy

Nothing is written into the working tree — see §4.11 for why that mattered.

| Injection | Into | Caught |
| --- | --- | --- |
| `"$url?cap=$cap"` | a copy of `Media3PlayerAdapter.kt` | capability-in-URL sweep |
| `AVAssetDownloadTask` | a copy of `AVPlayerAdapter.swift` | download sweep, correct file |
| `ImageCapture` | a copy of `CameraXScanner.kt` | capture sweep, correct file |
| `ATTENDANCE_QR_SECRET` | a copy of `CheckInScanner.swift` | signing-key sweep, correct file |
| `requestLocationUpdates` | a copy of `PlayServicesGeofencing.kt` | location sweep, correct symbol and file |
| `attendance_facts.insert(` | the *text* of `kiosk-session.ts`, never a file | direct-write sweep |
| Blinding `sweep()` itself | all four file-list proofs | all four fail |
| Mutex removal | `MediaPlaybackCoordinator.kt` | single-flight test (§4.3) |
| `create function … security definer` with no `search_path` | `0061_faithful_media_eligibility.sql` | migration baseline scanner (§4.8) |
| `create function public.consume_api_rate_limit` | `0061_faithful_media_eligibility.sql` | baseline-shadowing check (§4.8) |
| Single-flight guard removal | `MediaPlaybackCoordinator.swift` | the iOS rendezvous — 2 issues in 64 s, no longer a hang (§4.10) |
| `nonisolated(unsafe) func stop()` | `AVFoundationScanner.swift` | the new iOS device build gate (§4.12) |

And the counterpart risk is tested: a **comment** naming a forbidden symbol must
not be a violation. `Media3PlayerAdapter.kt` explains at length why there is no
`DownloadManager`, and the sweep stays green.

---

## 7. Pending — cannot be run here

Each with the exact reason. **None is claimed as passing.**

| Item | Reason | Verified instead by |
| --- | --- | --- |
| `AVPlayer` playback and the resource loader | `swift test` runs on macOS; no iOS media stack | runbook §3–§6 |
| `ExoPlayer` playback and `bindToLifecycle` | needs a `Context`, a `Looper` and a media stack; Robolectric cannot instrument Media3 | runbook §3–§6 |
| Live HLS from a real relay | needs a provider | runbook §3, §9 |
| Recording playback and scrubbing | needs a device and a file | runbook §4 |
| **The parser against a real recording** | every test drives byte structures built in the tests — real ISO layouts with real `avcC` and `esds`, but no MP4 from an actual service | runbook step 26i |
| **The identity against a real provider** | the comparison has never seen a Supabase Storage ETag. Whether it is strong, and whether storage honours `If-Match`, is unknown | runbook steps 26j–26o |
| Decode on a device | the gate proves conformance to the portable profile, not that a given phone will decode it. A conformant 1080p60 file may still stutter under thermal load | runbook §4 |
| Whether the portable policy is right | High profile and Levels 4.1–4.2 are accepted beyond the Android CDD mandate, deliberately and documented. Only a device can say whether that judgement holds | runbook steps 26a–26i |
| The cost of the per-request identity check | it runs on every range request and nothing has measured it | runbook step 26o |
| A recording larger than 4 GiB | a 64-bit box size is refused rather than parsed. A real limit, not fixed here | runbook §4 |
| Revocation timing ("about a minute") | needs a device and a live service | runbook steps 29–32 |
| Battery and thermal | not measured | runbook §11 |
| Captions | no caption surface built; the proxy already serves `text/vtt` | runbook §10 |
| Applying 0060, 0061 and 0062 to staging or production | deliberately not done from a test harness. **0061 and 0062 each hide currently-published recordings until they are re-probed** — see the dashboard document | runbook §12 |
| **An installable iOS app** | `apps/faithful-ios` is a SwiftPM *library*. There is no app target, no `@main`, no `Info.plist`, no Xcode project and no signing identity, so nothing can be installed on a device | `P4_EXTERNAL_SETUP_RUNBOOK.md` |
| App Store / Play submission | no app target, no signing key, no listing | `P4_EXTERNAL_SETUP_RUNBOOK.md` |

**No claim is made that playback works on any device, that any provider stream
was watched, or that anything was deployed.** The seams around all of it are
tested; the media stacks, the provider and the deployment are not.

---

## 8. Scope, honoured

Not implemented: donations, chat, comments, user-generated content, offline video
downloads, ads, analytics tracking, casting, and the Sermon Builder archive
(Prompt 10). Where a symbol can express the exclusion, a sweep asserts it — see
`P9_PRIVACY_SECURITY_AND_ABUSE_MODEL.md` §11.

**No second stream or recording authority was created.** `stream_events` and
`stream_recordings` remain the only ones; Prompt 9 added `mobile_*` columns and
projection functions in the pattern migration 0054 established for announcements.

Migrations **0055–0059 were not modified**. Their modification times all predate
this work, and `tests/security/checkin-authority.test.ts` already asserts none of
them mentions a Prompt 8 table; the same structural argument applies here, since
0060 and 0061 create their own objects and secure only those.

**No transcoder and no second recording authority were added by the closure.**
The gate reads bytes and reports; it never re-encodes. Producing a supported
rendition remains the relay pipeline's job, and where the current pipeline has no
canonical way to do it, the recording stays unpublished and the operational
prerequisite is written down — `P9_MEDIA_ELIGIBILITY.md` §7. **Prompt 10 was not
begun.**
