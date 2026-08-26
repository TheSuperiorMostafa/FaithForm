# Prompt 9 — The Native Media Experience

*What a visitor sees on each platform, what the two share, where they honestly
differ, and what was actually exercised.*

---

## 1. The shape, on both platforms

```
        ┌───────────────────────────────────────────────────┐
        │  MediaPlaybackCoordinator        (pure, tested)    │
        │  · when to refresh                                 │
        │  · what a failure means                            │
        │  · whether a position is worth keeping             │
        │  · what a revocation does                          │
        └──────────────────┬────────────────────────────────┘
                           │  MediaPlayerFacade
        ┌──────────────────┴────────────────────────────────┐
        │  AVPlayerAdapter      │  Media3PlayerAdapter       │
        │  (translation only, no decisions)                  │
        └───────────────────────────────────────────────────┘
```

The same pattern as Prompt 7's Core Location and Prompt 8's camera, for the same
reason: the code most likely to be subtly wrong is the code only reachable on a
device, so none of the decisions live there.

On Android this was enforced the hard way. An earlier `:app` test constructed
real Media3 objects under Robolectric and **hung the runner outright** —
instrumenting `media3-exoplayer` does not finish in any reasonable time. The
response was not a workaround but a correction: `CapabilityHeaders` and
`PlayerFailureMapping.fromPlayerError` moved into `:core:media`, and what is left
in `:app` is a translation with one job.

---

## 2. Home

A **live hero** appears when, and only when, the church has something published
and on air.

| Server says | Card shows |
| --- | --- |
| `live` | "Live now", the title, and a **Watch live** button |
| `upcoming` | "Starting soon" and the time, in the church's zone |
| `recent_ended` | "Today's service has ended — the recording will appear here once it is ready" |
| *nothing* | **no card at all** |

The last row is the one that matters. The API returns `live: null`, the model
carries null through, and neither platform renders a container. There is no
placeholder, no grey box, and no "not live right now" strip on a Tuesday —
asserted on both platforms by a test on the state type rather than by reading a
layout.

`recent_ended` exists so the card does not vanish mid-Sunday and look broken. It
is bounded to twenty-four hours.

---

## 3. The archive

Published recordings, newest first, keyset-paginated, with a search box.

| State | What is shown |
| --- | --- |
| Loading | a spinner with an accessible label |
| Loaded, with items | poster-first cards: title, series, date in the **church's** zone, length, speakers |
| Loaded, empty, no search | "No services have been published yet." |
| Loaded, empty, with a search | "Nothing matches that." |
| Blocked | "This church is not available to you" |
| Offline | "Faithful could not reach the server" and **Try again** |

The two empty states are different sentences on purpose: showing "no recordings"
to someone who has typed a search reads as though the church has none at all.

Search runs **after** the publication and relationship filters, in SQL. A private
recording's title cannot surface through the search box — the usual way private
metadata leaks out of an otherwise correct list. A database test searches the
exact private title and requires nothing back.

Only the unfiltered first page is cached. Caching every query someone typed would
build a local record of what they searched for.

---

## 4. Detail and playback

Poster, title, church, date, summary, series, speakers — and nothing that is not
in the published projection. No internal status, no trim values, no storage
path, no view count.

| Control | Live | Recording |
| --- | --- | --- |
| Play / pause | yes | yes |
| Seek | **no** | yes |
| Resume position | **no** | yes |
| Completion | n/a | yes |

A live stream is not seekable because the playlist window is a few seconds wide;
a scrubber over it would promise something the format cannot deliver.

### Errors a person can act on

`PlayerFailure` has four cases and no payload:

- **network** — "Playback stopped because the connection dropped."
- **unavailable** — "This is no longer available to watch."
- **unsupported** — "This recording cannot be played on this device."
- **unknown** — "Playback stopped unexpectedly."

A test asserts no message contains `http`, `://`, a status code, or a framework
name.

### Unpublish and revocation while watching

A recording taken down mid-sermon produces a 403 on the next range request. The
coordinator treats a first `unavailable` as possibly-just-expired, forces one
refresh, and — when that is refused too — stops and says the item is no longer
available. Roughly a minute, and no retry loop.

---

## 5. Resume positions

**Device-local, deliberately not synced.**

A server-held position would be a per-person, per-recording, cross-device record
of what someone watched and how far they got — person-level viewing analytics
under another name, which §5 of this prompt forbids. The requirement is "resume
on the same device", and that is what is built. **There is no server endpoint for
it, and none should be added.**

| Rule | Value |
| --- | --- |
| Live edge | **never stored** |
| Below | 30 s — they meant to start over |
| Within | 30 s of the end — resuming at 99% shows the credits |
| At most | 20 entries, newest first |
| Older than | 30 days — dropped on read and on write |
| Partition | `environment \| account \| church \| authorizationVersion` |

Partitioning by authorization version means a revoked relationship or a sign-out
moves the partition, so the old positions become unreachable and are then purged.
A test asserts a position written under one account is invisible to another and
to a bumped version.

iOS stores them in the Keychain (`SecureStoring`); Android in the same encrypted
store the rest of the app uses. Neither ever writes a capability: a
`ResumePosition` has four fields and none of them is a credential, asserted on
the type.

---

## 6. Lifecycle

| Event | Both platforms |
| --- | --- |
| Background | position saved **immediately** — there may be no later tick |
| Foreground | a capability that expired while suspended is refreshed **before** anything is asked of the player |
| Leaving the screen | position saved, player stopped, session cleared |
| Audio focus (Android) | policy in `:core:media`: transient → pause, duckable → **duck**, permanent → stop |

Ducking rather than pausing on a duckable loss is the difference between a sermon
that survives a navigation prompt and one that stops for it.

---

## 7. Where the platforms honestly differ

| | iOS | Android |
| --- | --- | --- |
| Header injection | `AVAssetResourceLoaderDelegate` + custom scheme | `setDefaultRequestProperties` |
| Why | `AVPlayer` has no public header API | Media3 has one |
| Audio focus | the system manages it | the app decides, via `AudioFocusPolicy` |
| Container support | H.264 + AAC in an ISO container | the same, plus more |
| Rendition MIME | inferred by `AVPlayer` | **declared** from `renditionKind` |

The container row used to read "MKV will not play on iOS" and it was a real
mismatch: `sanitizeRecordingFilename` permits `.mkv` and `AVPlayer` cannot
decode it. It is **closed now**, upstream of both players — a recording is only
publishable once the server has proved from the object's own bytes that both
platforms can play it, so the narrower platform sets the bar for both. See
`P9_MEDIA_ELIGIBILITY.md`. The player still maps a decode failure to
`unsupported` rather than `unavailable`, because a rendition can still be
replaced with a bad one after publication.

The MIME row is not symmetry for its own sake. Media3's
`DefaultMediaSourceFactory` picks an extractor from the URI path, and the
recording delivery route ends in an id with no file extension — so the adapter
sets `APPLICATION_M3U8` or `VIDEO_MP4` explicitly from the grant's
`renditionKind` rather than letting it guess. `AVPlayer` probes the response, so
iOS needs no equivalent.

---

## 8. Accessibility

- **Dark mode** — both platforms use the existing theme tokens; nothing hardcodes
  a colour.
- **Dynamic Type / font scaling** — every text style comes from the design
  system, and cards use `fixedSize(horizontal: false, vertical: true)` on iOS so
  they grow rather than truncate.
- **VoiceOver / TalkBack** — the live hero and each archive card are a single
  merged element with a composed label. A card read as five fragments is a card
  nobody listens to twice.
- **Reduced motion** — the live indicator is a filled dot, not a pulse. An
  animation someone cannot switch off is a distraction, not a signal.
- **Live regions** — a playback failure is announced as it appears. Someone whose
  sermon just stopped is not looking at the screen.
- **Localization** — 189 shared keys, parity-checked. No inline user-facing
  literal in either platform's views.

---

## 9. What was exercised, and what was not

### Exercised, automatically, in CI

| Behaviour | Platform | Where |
| --- | --- | --- |
| Contract fixtures decode, including a null live projection | both | contract tests |
| A grant's URL carries no credential | both | contract tests |
| Refresh schedule, and that it does not fire early | both | coordinator tests |
| **Single-flight refresh under genuine concurrency** | both | coordinator tests; proven on Android by removing the mutex |
| A refused refresh stops and does not reuse the old capability | both | coordinator tests |
| One retry on `unavailable`, none on `network` | both | coordinator tests |
| Every error mapping, including unknown | both | mapping tests |
| Media3 error constants still match the library | Android | `:app` plain JUnit |
| Resume bounds, live exclusion, completion tail | both | policy tests |
| Resume isolation across accounts and authorization versions | both | store tests |
| Background saves, foreground refreshes | both | lifecycle tests |
| Audio-focus policy, all four transitions | Android | policy tests |
| Which affordances appear in every state | Android | `MediaScreenState` tests |
| Header is a live view, not a copy | Android | `CapabilityHeaders` tests |

### **Not** exercised

| Path | Why | Verified instead by |
| --- | --- | --- |
| `AVPlayer` playback, playlist and segment fetching | `swift test` runs on macOS; no iOS media stack, no simulator segments | runbook |
| `AVAssetResourceLoaderDelegate` end to end | same | runbook |
| `ExoPlayer` playback and `bindToLifecycle` | needs a `Context`, a `Looper` and a media stack; Robolectric cannot instrument Media3 in reasonable time | runbook |
| Actual HLS from a real relay | needs a provider | runbook |
| Scrubbing a real recording | needs a device and a file | runbook |
| Battery and thermal behaviour | not measured | runbook |

**No claim is made that playback works on a device.** The seams around it are
tested; the media stacks are not.
