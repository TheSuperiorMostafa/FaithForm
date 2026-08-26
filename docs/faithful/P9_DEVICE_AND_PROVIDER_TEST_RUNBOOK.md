# Prompt 9 — Device and Provider Test Runbook

**Nothing in this document has been executed.** Every step needs a phone, a
provider, a relay, or a deployment — none of which exists in this environment.
The automated coverage is in `P9_PARITY_AND_VERIFICATION_MATRIX.md`; this is what
is *left*.

---

## 0. Completion ladder

| Stage | Status |
| --- | --- |
| **Source complete** | ✅ publication model, projections, capability, delivery routes, dashboard, both native experiences |
| **Local automated verification complete** | ✅ 591 web, 100 database, 292 Swift, 332 Kotlin; lint, typecheck, contract, migrations, secrets, build |
| **Simulator / emulator complete** | ❌ not attempted |
| **Physical-device complete** | ❌ not attempted |
| **Provider / staging complete** | ❌ not attempted |
| **Production complete** | ❌ not attempted |

---

## 1. Before you start

You need:

- a staging FaithForm with migration 0060 applied and `STREAM_PLAYBACK_SECRET`
  set;
- a relay reachable at `STREAM_HLS_UPSTREAM_URL` with
  `STREAM_RELAY_PLAYBACK_SECRET`;
- **two** churches, so cross-tenant steps are real;
- an encoder or the browser publisher, to actually go live;
- at least one completed recording in the `stream-recordings` bucket;
- an iPhone and an Android phone, both on the staging build.

Do not run any of this against production.

---

## 2. Publish and unpublish, from the dashboard

| # | Step | Expect |
| --- | --- | --- |
| 1 | Open **Live streaming → Library** on a fresh install of 0060 | Every item says **Not in Faithful**. Nothing is published by the migration. |
| 2 | Open Faithful, go to the church | No live area. Empty archive. |
| 3 | Publish one recording as *Anyone using Faithful* | It appears in the app within one pull-to-refresh. |
| 4 | **Preview what visitors see** | Shows exactly the item you published, and nothing else. |
| 5 | Change it to *People who have joined* | A visitor who only follows stops seeing it. A member still does. |
| 6 | **Remove** it | It disappears from the list. Opening its detail by a stale link says it is no longer available. |
| 7 | Publish it again | It returns, and the history shows four rows with your name. |
| 8 | Try to publish a **processing** recording | The button is absent; the state says *Processing*. |
| 9 | Publish a scheduled service, then cancel the service | It vanishes from the app. |

---

## 3. Live playback

| # | Step | Expect |
| --- | --- | --- |
| 10 | Publish a scheduled service, do not start it | The app shows **Starting soon**, no watch button. |
| 11 | Start the broadcast and attach the encoder | Within one refresh the card becomes **Live now** with a watch button. |
| 12 | Start the broadcast but do **not** attach an encoder | The card must **not** say live. |
| 13 | Tap **Watch live** on iPhone | Video plays within a few seconds. |
| 14 | Same on Android | Same. |
| 15 | Watch for **six minutes** | No stall at the five-minute mark. The capability refreshed silently. |
| 16 | Try to scrub | No scrubber is offered on a live stream. |
| 17 | End the broadcast | The player stops cleanly. The card becomes **Today's service has ended**. |

---

## 4. Recording playback

| # | Step | Expect |
| --- | --- | --- |
| 18 | Open a published recording on iPhone | Poster, title, church, date, length, speakers. Play works. |
| 19 | Scrub forwards and backwards | Seeking works. This is the byte-range proxy; if it does not, check `Accept-Ranges`. |
| 20 | Same on Android | Same. |
| 21 | Watch five minutes, leave, come back | It resumes where you left off. |
| 22 | Watch to within twenty seconds of the end, leave, come back | It starts from the beginning — a finished service is not resumed. |
| 23 | Watch ten seconds, leave, come back | Starts from the beginning — a glance is not a position. |
| 24 | A recording with a **trim start** | Playback begins at the trimmed point, not on the empty room. |
| 25 | Upload an **MKV** recording, then open the dashboard media library | The row says **Can't be played on phones**. There is **no Publish button**. It must never reach a phone at all — the old expectation, "fails on iPhone and plays on Android", is now a bug if you see it. |
| 26 | Try to publish that MKV by calling the publish action directly | Refused. It is refused inside the write, not by the button being hidden. |
| 26a | Upload an **HEVC/H.265** MP4 | Same refusal. This is deliberate: Android HEVC support is device-dependent, so it is not promised on either platform. |
| 26b | Truncate an MP4 mid-upload, or upload one with no `moov` | The row says the upload did not finish. No Publish button. |
| 26c | Take a recording published and playing in the app, replace the object in storage with an MKV, and wait for the next probe | It **disappears** from the list, from search, and from detail on both phones. A capability already in flight plays to the end of what is buffered; a new one is refused. |
| 26d | Re-upload a good H.264/AAC MP4 over that same recording | It **comes back on its own**. Nobody re-publishes it: the church's intent was never cleared, only its eligibility. |
| 26e | Upload an MP4 encoded `-profile:v high10` or `-pix_fmt yuv422p` | Refused. Same `avc1` fourcc, a configuration neither platform's hardware path is promised for. |
| 26f | Upload an MP4 at **Level 5.1** (e.g. 4K) | Refused. Above 4.2 Android decoder support varies by device. |
| 26g | Upload an MP4 whose audio is MP3 in an `mp4a` box (`ffmpeg -c:a libmp3lame -f mp4`) | Refused. The box says `mp4a`; the payload is not AAC. |
| 26h | Upload a 5.1-channel or 96 kHz AAC recording | Refused, with the encoder-settings message. |
| 26i | **Watch the first probe of a real recording.** Check `mobile_rendition_video_profile` and `mobile_rendition_audio_profile` on the row | This is the **first time this parser has met a real file from a real service** — every test fixture is a byte structure built in the tests. Record the two codec strings verbatim, whatever they are. If a recording that plays fine on both phones is refused here, that is the bug, and this step is how it is found. |

### 4a. The object, not the path

The identity binding (`P9_MEDIA_ELIGIBILITY.md` §3) has never met a real
provider. These steps are the first evidence that Supabase Storage returns what
this code expects it to.

| # | Step | Expect |
| --- | --- | --- |
| 26j | Publish a recording, then read its row | `mobile_rendition_object_etag`, `..._size` and `..._hash` are all populated. **If the ETag is null, or comes back weak (`W/"…"`), say so** — the gate still works on length and hash, but that is a provider fact worth writing down. |
| 26k | Watch a network trace of one delivery request | The request to storage carries `If-Match`. Note whether storage **honours** it — a 412 on a changed object — or ignores it. Both are handled; which one happens is unknown until this step runs. |
| 26l | While a recording is published, re-run `upload-recording.sh` for it with a *different* file | The recording **disappears** from both phones' lists, from search and from detail. A capability already in flight plays out what is buffered; the next range request is refused. |
| 26m | Try to publish it again immediately | Refused with "this recording's file changed since it was checked". Not a codec message — nothing was read. |
| 26n | Wait for the re-probe, then publish | Succeeds, bound to the **new** identity. Check the row's hash changed. |
| 26o | Seek repeatedly in a long published recording | Every seek is a fresh identity check. Seeking must stay smooth — **if scrubbing became slow, that is this check and it is worth reporting.** |

---

## 5. Expiry, revocation and unpublish during playback

| # | Step | Expect |
| --- | --- | --- |
| 27 | Start a recording. Watch a network trace | Every request carries `Authorization: Bearer`. **No URL contains a capability.** |
| 28 | Watch for six minutes | One extra `POST /media/playback` around the five-minute mark. Playback does not stall. |
| 29 | While playing, press **Remove** in the dashboard | Playback continues to the end of what is buffered, then stops with "no longer available". |
| 30 | While playing, press **Revoke** | Playback stops within about a minute. |
| 31 | Revoke while the person is **browsing** | The item disappears on their next refresh; opening it by id says unavailable. |
| 32 | Block the visitor's relationship while they are watching | Same as revoke. |
| 33 | Sign out and back in mid-session | The old capability stops verifying; a new grant is issued. |
| 34 | Capture a delivery URL and open it in a browser | **401.** It carries no credential. |
| 35 | Capture a capability and use it from another account's session | **401.** |

---

## 6. Background, foreground and network

| # | Step | Expect |
| --- | --- | --- |
| 36 | Background the app mid-recording, return after ten seconds | Resumes at the right position. |
| 37 | Background for **ten minutes**, return | The capability expired; it refreshes before anything is asked of the player. First thing you see is not an error. |
| 38 | Turn on airplane mode mid-playback | "Playback stopped because the connection dropped." Not "no longer available". |
| 39 | Turn it off and retry | Plays again from the remembered position. |
| 40 | Throttle to slow 3G | Buffering indicator appears. No crash, no false "unavailable". |
| 41 | Receive a phone call mid-sermon (Android) | Audio pauses, then resumes. |
| 42 | Trigger a navigation prompt (Android) | Audio **ducks** rather than stopping. |
| 43 | Lock the screen | Behaviour is whatever the platform default is; record what it does. |

---

## 7. Two churches, and switching

| # | Step | Expect |
| --- | --- | --- |
| 44 | Join two churches, both publishing | Each church's screen shows only its own media. |
| 45 | Switch churches mid-browse | The list changes completely; no item from the first appears. |
| 46 | A recording published by church A, opened with church B's slug | Unavailable. |
| 47 | Resume a recording at church A, switch to B, come back | The position survived. |
| 48 | Sign out | Every resume position is gone. Sign back in and confirm nothing resumes. |

---

## 8. Logged out and refused visitors

| # | Step | Expect |
| --- | --- | --- |
| 49 | Browse a church signed out | Public published recordings are listed. |
| 50 | Tap play signed out | Sign-in is required; no capability is issued. |
| 51 | A `pending` relationship | Sees public items only. |
| 52 | A `blocked` relationship | Sees **nothing at all** — the church reads as unavailable. |
| 53 | A church that is not discoverable | Indistinguishable from one that does not exist. |

---

## 9. Provider interruption

| # | Step | Expect |
| --- | --- | --- |
| 54 | Kill the relay mid-live | The player reports a network failure, not "unavailable". |
| 55 | Bring it back | Playback recovers, or a retry does. |
| 56 | Point `STREAM_HLS_UPSTREAM_URL` at nothing | 502 from the delivery route; the app says the connection dropped. **No host name reaches the phone.** |
| 57 | Rotate `STREAM_RELAY_PLAYBACK_SECRET` mid-service | Live playback breaks for everyone until both sides match; the website breaks identically. Record how long it takes. |
| 58 | Delete a recording from the bucket, leave the row | 503 from the delivery route; the app says the connection dropped, not that the church removed it. Consider whether this should be a distinct state. |

---

## 10. Captions

| # | Step | Expect |
| --- | --- | --- |
| 59 | Check whether any recording has a sidecar `.vtt` | The relay proxy already sets `text/vtt`, but **no caption surface is built** in Prompt 9. Record whether any exist; if they do, captions are a follow-up, not a claim. |

---

## 11. Battery and thermal

| # | Step | Expect |
| --- | --- | --- |
| 60 | Watch a full service on each phone, screen on | Record battery drain and any thermal warning. **No figure is claimed anywhere in this repository**; this step exists to produce one. |
| 61 | Compare with the same service in the platform browser | Record the difference. |

---

## 12. Staging then production

| # | Step | Expect |
| --- | --- | --- |
| 62 | Apply 0060 to staging; run `pnpm test:concurrency` against it | 100 passing. |
| 63 | Confirm nothing is published after the migration | Every church's app shows an empty archive. |
| 64 | Run one real service end to end on staging | Publish → live → end → recording lands → publish → visitors watch. |
| 65 | Apply 0060 to production **outside a service window** | Additive; no downtime expected, but do not do it at 10:55 on a Sunday. |
| 66 | Confirm production publishes nothing on its own | Same as step 63. |
| 67 | Publish one recording for one pilot church | Confirm with them before publishing anything else. |

---

## 13. What must be reported back

For each numbered step: pass, fail, or not attempted — and for any failure, the
exact behaviour rather than a summary. In particular:

- steps 25–26d exercise the eligibility gate (`P9_MEDIA_ELIGIBILITY.md`). None
  of them is expected to fail. If an MKV or an HEVC file reaches a phone at all,
  stop and report it — that is the gate not holding, and it is the one thing
  this closure exists to prevent. **The parser has never been run against a real
  recording from a real service**, only against byte structures built in tests,
  so step 25 is also the first real evidence either way;
- step 26a is worth a note either way: if the church's encoder produces HEVC by
  default, the answer is an encoder setting, not a product change (§8 of the
  eligibility document);
- **steps 26i and 26j–26o are the highest-value steps in this runbook.** They are
  the only ones that put a real file and a real provider in front of code that
  has so far only ever seen fixtures. Report their results verbatim, including
  the two codec strings and whether the ETag is strong;
- step 26o should produce a subjective note on seek smoothness, because the
  identity check now runs on every range request and nothing here has measured
  its cost;
- steps 29–32 should produce a measured revocation window; the documentation
  claims "about a minute" and that number should be replaced with a real one;
- step 60 should produce a battery figure, because there is not one yet.
