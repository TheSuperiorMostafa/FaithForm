# Prompt 9 — The Mobile-Playability Gate

*Why "published to Faithful" now means "playable by Faithful", how eligibility
is proved, which object the proof is about, and what a church has to do when a
recording fails.*

---

## 1. What was wrong

Prompt 9 made publishing an explicit staff decision. It did not make it a
*correct* one. Three facts, traced from the code rather than assumed:

1. **`sanitizeRecordingFilename` accepts `.mkv`** — and `AVPlayer` cannot decode
   Matroska. A pastor could publish one and every iPhone in the congregation
   would fail while every Android phone worked. `P9_NATIVE_MEDIA_EXPERIENCE.md`
   recorded this as a known mismatch and left it as a device-runbook step. That
   was not good enough: a church cannot be expected to discover a format problem
   from their congregation.

2. **The upload content-type is a claim.**
   `infra/stream-relay/upload-recording.sh` sends
   `content-type: video/mp4` unconditionally, whatever the file contains. From
   this application's point of view the relay is a client, and a client's claim
   about its own payload is not evidence.

3. **Nothing verified the object after it landed.** The webhook proved a file
   existed by minting a signed URL. A truncated upload produced a row
   indistinguishable from a good one.

So "published" meant "a staff member pressed a button on a row that has a file
behind it". It did not mean a phone could play it.

### And two gaps survived the first fix

The first version of this gate proved the container brand and the sample-entry
fourccs, which was a real improvement and still not enough:

4. **A fourcc is not a codec.** `avc1` is the same four bytes at Baseline 3.0 and
   at High 4:4:4 Predictive 10-bit Level 6.2. `mp4a` is the same four bytes for
   AAC-LC and for MP3-in-MP4. The gate accepted all of them equally.

5. **A storage path is mutable.** `upload-recording.sh` uploads with
   `x-upsert: true`, so a verdict recorded against a path said nothing about what
   was at that path afterwards.

§2 closes the first. §3 closes the second.

---

## 2. What eligibility is decided from

**The bytes of the object this server holds.** Nothing else.

### A fourcc is not a codec

The first version of this gate stopped at the container brand and the
sample-entry fourccs. That was a real improvement over a filename and it was
still not sufficient, for a reason worth stating plainly:

> `avc1` is the same four bytes whether the stream is Baseline 3.0, which every
> phone decodes, or High 4:4:4 Predictive 10-bit at Level 6.2, which neither
> platform's hardware path will touch. `mp4a` is the same four bytes whether the
> payload is AAC-LC or MP3-in-MP4.

So the fourcc now selects *which* configuration record to read, and the record
decides. `lib/media/v1/rendition.ts` walks
`moov → trak → mdia → minf → stbl → stsd → entry → avcC | esds` and reads the
decoder configuration itself.

### The container

| | Accepted | Refused |
| --- | --- | --- |
| Container | ISO base media declaring `isom`, `iso2`, `iso4`, `iso5`, `iso6`, `mp41`, `mp42`, `avc1`, `mmp4`, or `M4V ` | Matroska, and anything unrecognised |
| Brand | any of the above, in the major **or** compatible list | `qt  ` alone |
| Video entry | `avc1`, `avc3` (H.264) | `hvc1`, `hev1`, anything else |
| Audio entry | `mp4a` | `ac-3`, `ec-3`, Opus, FLAC, anything else |
| Tracks | at least one `vide` or `soun` | none |
| Index | `moov` locatable and complete | not found |
| Protection | none | `encv`/`enca`, a `sinf` in any entry, a `pssh` in `moov` |

**QuickTime-only files** are refused deliberately: `AVPlayer` plays them and
ExoPlayer usually does, and "usually" is not the standard. A file whose
*compatible* brands include an ISO brand is accepted — that is what a
compatible-brands list is for.

**Encrypted tracks** are refused outright rather than unwrapped to whatever
`frma` says was underneath. Faithful ships no key acquisition and no CDM, so a
protected rendition is unplayable regardless.

### The video configuration — `avcC`

Read from the `AVCDecoderConfigurationRecord`, whose first four bytes carry
exactly what the policy needs, and which for the High family also carries chroma
format and bit depth — so a 10-bit or 4:2:2 stream is refused without decoding a
single SPS bit.

| Field | Accepted | Why |
| --- | --- | --- |
| `profile_idc` | 66 (Baseline), 77 (Main), 100 (High) | see below |
| `level_idc` | ≤ 42 (Level 4.2) | see below |
| `chroma_format` | 1 (4:2:0) | 4:2:2 and 4:4:4 are not in either platform's guaranteed hardware path |
| bit depth | 8 | 10-bit is what a broadcast capture card emits by default |
| `lengthSizeMinusOne` | 0, 1, 3 | 2 is not a value the specification defines |
| `configurationVersion` | 1 | anything else is not this record |
| SPS | present for `avc1`, optional for `avc3` | `avc3` carries parameter sets in-band |

### The audio configuration — `esds`

Read through `ES_Descriptor → DecoderConfigDescriptor → DecoderSpecificInfo`.

| Field | Accepted | Why |
| --- | --- | --- |
| `objectTypeIndication` | `0x40` (MPEG-4 Audio) | an `mp4a` entry can legally carry MP3 (`0x69`, `0x6b`) — the exact case a fourcc check misses |
| audio object type | 2 (AAC-LC), 5 (HE-AAC), 29 (HE-AACv2) | CDD-mandated decoders on Android; long-supported on iOS |
| sampling frequency | 8 000 – 48 000 Hz | Android's stated AAC-LC range. Above it is pointless for a spoken service and is what a misconfigured interface produces |
| channel configuration | 1 or 2 | multichannel AAC on Android is per-device, not mandated. `0` means "defined in the program config element" — not provable at all |

An explicitly signalled sampling frequency (index 15) is read and judged exactly
like an indexed one, so the escape value is not a way around the policy.

### The policy, and where its numbers come from

`lib/media/v1/portable-profile.ts` is the policy, separate from the parser so it
can be read and argued with without reading a box walker. Its bounds are derived
from the targets the projects actually declare — **iOS 17**
(`Package.swift`) and **Android API 26** (`app/build.gradle.kts`) — and Android
is the binding constraint on every one of them.

The guarantee is tiered, and only the first two tiers are written down anywhere
normative:

* **Baseline, Level ≤ 3.0** — Android CDD-mandated on every device.
* **Main, Level ≤ 4.0** — CDD-mandated on every device that plays 720p or 1080p,
  which is every device this app runs on. `ws-ingest.py` encodes
  `-profile:v main`, so the browser publisher lands inside the mandate.
* **High, and Levels 4.1–4.2** — *not* mandated. Accepted anyway.

That last row is a judgement and it is the weakest link in this policy. Every
hardware decoder in an API 26+ device implements High, it is what OBS and
`libx264` defaults produce, and Level 4.2 is required for 1080p at 50 and 60 fps.
Refusing them would refuse most real church recordings in order to honour a
document no shipping device falls short of. It is written down here rather than
hidden, so a real device failure has somewhere obvious to point.

Above 4.2 is 4K territory, where Android decoder support genuinely varies and no
server-side claim is honest. A recording that lands there stays unpublished and
the church lowers its encoder's resolution.

### Two descriptions that disagree

**Every entry in an `stsd` is read, not just the first.** A file can describe one
track two ways, and a parser that reads entry zero and stops can be handed a
compliant first entry and an HEVC second one. Where two entries — or two tracks
of the same medium — describe different encodings, the recording is
`codec_config_conflict`: whichever a device picks, this server cannot say which,
so it cannot promise either. An `stsd` whose declared entry count does not match
its entries is `file_malformed` rather than reconciled.

### What is not consulted

The filename, the extension, the stored content-type, and anything the relay
reported. A sweep asserts the parser never reads a filename and the checker
never reads a content type.

### What is claimed, exactly

That the rendition **conforms to an encoding profile both supported platforms
document support for**. *Not* that a particular device will decode it. No byte
inspection can prove that: a decoder can be busy, a device can be thermally
throttled, and hardware decoders have bugs no bitstream reveals. Real playback
remains a device and provider validation item — runbook §4.

### What this is not

**It is not a transcoder, and no transcoder was added.** The gate reports what is
there. A sweep asserts no `ffmpeg`, `fluent-ffmpeg`, `MediaConvert` or similar
appears in the media path or in `package.json`. Producing a supported rendition
is the relay pipeline's job — see §7.

---

## 3. Which object the proof is about

A verdict says something about *bytes*. A storage path is not bytes — it is a
name, and it is **mutable**.

`infra/stream-relay/upload-recording.sh` uploads with `x-upsert: true`. So
re-running it — which is exactly what the script is for, "when an upload failed
and the file was kept" — replaces the object underneath an unchanged path. And so
can anyone else holding the service key. A verdict recorded against a path
therefore said nothing about what was at that path afterwards: a church could
publish a verified recording and then have it become something else entirely,
with every gate in §4 still reporting green.

So every verdict now carries the identity of the exact bytes it was taken from.

### The four parts, and why not one

| Part | Where it comes from | What it survives |
| --- | --- | --- |
| **Strong ETag** | the provider's response | everything, when the provider returns one |
| **Version id** | `x-amz-version-id` and friends | providers that version objects |
| **Content length** | `Content-Range`, or `Content-Length` | a provider that returns no validator |
| **SHA-256 of the inspected window** | computed here, from bytes already read | a provider that returns *nothing* |

The hash is the part that never depends on the provider. It costs nothing extra —
the bytes were read in order to parse them — and it makes the identity provable
even against storage that advertises no validator at all.

It covers the **inspected window**, not the whole object, because hashing a
three-hour service would mean transferring it. That is a real limit: a change
confined to the middle of a file, outside both the head and tail windows, is
caught by the content length rather than by the hash.

**A weak validator is not an identity.** `W/"abc"` promises semantic
equivalence, not byte equality; two encodings of the same sermon may legitimately
share one. It is discarded rather than stored, because accepting it would mean
accepting exactly the substitution this mechanism exists to detect.

### Why a playable verdict needs two kinds of evidence

The constraint requires the **hash** *and* at least one of ETag, version id or
length. Both halves are load-bearing, and they serve different callers:

* **Publication** compares the hash. It has just re-probed, so it has one.
* **Capability issuance and delivery** cannot re-hash a window — that would mean
  transferring it on every range request — so they compare only what a live
  response advertises.

A verdict carrying only a hash would be publishable and then undeliverable, which
is worse than refusing it up front. So it is refused up front.

### Comparison rules

Any discriminator **both sides know** that disagrees is a mismatch. A
discriminator only one side knows proves nothing either way and is skipped — a
provider that stops returning ETags must not silently invalidate a
congregation's whole archive.

The floor is that *something* must agree: an identity with nothing comparable is
**not** a match, because it is not evidence. That is what keeps this failing
closed rather than degrading to "the path is the same".

### The two halves of a probe must agree with each other

A tail read is a second request. Between the two, the path can be overwritten — so
the head's identity and the tail's are compared before they are parsed together.
Stitching a new file's tail onto an old file's head would prove a rendition that
never existed.

### What a mismatch does

It **withdraws** the row: `mobile_playable` goes false, the reason becomes
`object_changed`, the revision moves, and — through the existing trigger — the
publication version moves with it, invalidating every cached list and every
stored ETag in the same statement.

It is not recorded as "we know it is bad". Nothing was read. The honest state is
*we no longer know*, and the next probe says what is actually there.

`mobile_visibility` is untouched, so a corrected re-upload creates a new identity
and a new revision, and the recording returns on its own.

---

## 4. Where it is enforced

Six places, five of them independent of the dashboard.

```
                    ┌── the object's own bytes ──┐
                    │  lib/media/v1/rendition.ts │  codec configuration
                    │  + SHA-256 of the window   │  + object identity
                    └─────────────┬──────────────┘
                                  │  record_recording_rendition
                                  ▼
                     stream_recordings.mobile_playable   (default FALSE)
                     + mobile_rendition_object_{hash,etag,version,size}
                                  │
   ┌──────────────┬───────────────┼──────────────┬────────────────┐
   ▼              ▼               ▼              ▼                ▼
 dashboard   publish (in the   list & search  detail lookup   playback grant
 canPublish   UPDATE itself)    projection     projection    + identity check
              + identity                                           │
                                                                   ▼
                                                            delivery route
                                                          If-Match + verify
```

1. **Dashboard** — `canPublish` requires `mobile_playable`; the button is absent
   and the row says why.
2. **The publish mutation** — the eligibility check is **inside the `UPDATE`**,
   not before it. There is no read-then-write window in which a verdict could be
   recorded, invalidated, and published against anyway.
3. **List and search** — `mobile_media_archive` filters on `mobile_playable`
   before the search predicate runs, so an ineligible recording's title cannot
   surface through the search box either.
4. **Detail** — `mobile_media_detail` applies the same filter, so a device
   holding a list cached from before a re-probe cannot open the item by id.
5. **Playback capability** — `mobile_media_playback_grant` refuses independently,
   *and* `grantPlayback` confirms the object in storage is still the object that
   was verified before minting a capability. On a mismatch it withdraws the row
   rather than merely refusing this one caller.
6. **The delivery route** — every range request is **pinned** to the verified
   object with `If-Match`, so a cooperating provider answers 412 rather than
   substituting; and the response's own validator is **checked**, so a provider
   that ignores `If-Match` is caught before a byte of the wrong file reaches a
   phone. Pinning alone would trust the provider; checking alone would transfer
   the wrong bytes first.

An earlier version of the grant check asked only whether *something* existed at
the path. That was strictly weaker than it looked, for the `x-upsert` reason in
§3: a replacement passes an existence check while being an entirely different
file.

### The write cannot be forged

Two check constraints require the evidence alongside the flag:

```sql
-- 0061: it must have been verified.
check (not mobile_playable
       or (mobile_rendition_verified_at is not null and mobile_rendition_kind is not null))

-- 0062: and there must be an object the verdict is about.
check (not mobile_playable
       or (mobile_rendition_object_hash is not null
           and (mobile_rendition_object_etag is not null
                or mobile_rendition_object_version is not null
                or mobile_rendition_object_size is not null)))
```

So a direct `update … set mobile_playable = true` from a console, a migration or
a mistaken script fails. Database tests assert both.

### Optimistic concurrency, and identity, are different things

Publishing passes both, and neither is redundant:

* the **revision** proves nothing new was written to the row since the caller
  read it;
* the **identity** proves the row still describes the object in the bucket.

A concurrent re-probe replaces the revision, the row stops matching, and the
caller is told to try again rather than publishing against a verdict that no
longer holds. A caller presenting the right revision and the wrong hash is
refused too, so a publish can never be bound to bytes nobody looked at. Omitting
the hash is not a way around it: `is not distinct from` means a null expectation
matches only a row that also has none.

It is a revision rather than the verification timestamp because a timestamp does
not survive the trip: Postgres stores microseconds and a JavaScript `Date` holds
milliseconds, so the round-tripped value never matched and **every publish failed
as stale**. Found by running it, not by reading it.

---

## 5. No grandfathering

`mobile_playable` defaults to **false**. Applying migration 0061 therefore makes
every recording already published to Faithful **invisible** — in the list, in
search, in detail, and to the playback grant — until a probe proves it.

Migration **0062 does it again**, and on purpose: it sets every `mobile_playable`
back to false before adding the constraint that requires an object identity. A
verdict taken without one is not evidence about the object that is there now, and
0061's own argument applies to 0061's own rows.

That is the intended behaviour, not a migration hazard. The alternative is
trusting rows nobody ever verified — or rows verified against bytes that may
since have been replaced — which is precisely the state that let an MKV be
published.

`mobile_visibility` is **not** cleared. The church's intent survives, so a
recording that fails today and is re-uploaded correctly tomorrow comes back on
its own — nobody has to notice and re-publish it.

### When verification happens

| Moment | What runs |
| --- | --- |
| A recording lands from the relay | probed immediately, non-fatally |
| A staff member opens the media library | the newest unverified or stale rows, capped at 8 per page load |
| A staff member presses **Publish** | **always re-probed**, whatever the row said |
| A verdict is older than 24 hours | treated as stale and taken again |
| A transient failure was recorded | never treated as a verdict |

Bounded on purpose: opening the media page must not become a scan of a church's
whole archive. Publishing re-probes regardless, so nothing is ever published on a
stale verdict.

---

## 6. What a staff member sees

| Badge | Meaning | Publish button |
| --- | --- | --- |
| **Checking the file…** | never probed, or a transient failure | absent |
| **Can't be played on phones** | proved unplayable | absent, with the reason in the row |
| **Ready to publish** | proved playable, not published | present |
| **In Faithful** | published *and* playable | present, to change |

A recording that was published and has since been proved unplayable stops
showing **In Faithful**, because it is not: the projections stopped serving it
the moment the verdict was written, and the dashboard must not claim otherwise.

The explanations name no codec, brand, bucket or path:

> *"This recording is in a format phones can't play. It needs to be re-recorded
> or converted before it can go in the app."*
>
> *"This recording didn't finish uploading properly. Re-upload it from the
> streaming box and try again."*

A pastor needs to know whether to re-record, wait, or call someone. A fourcc
helps none of those. The machine-readable reason is on the row for support.

**A visitor is told nothing at all** — an ineligible recording is simply absent
from their list. A test asserts no visitor-facing DTO carries a container, a
codec, a reason, or a playability flag.

---

## 7. What the contract carries

One field, `PlaybackGrant.renditionKind` — `hls` or `progressive` — generated
consistently into TypeScript, JSON Schema, Swift and Kotlin.

It is not decoration. Media3's `DefaultMediaSourceFactory` picks an extractor
from the URI's path, and the recording delivery route ends in an id rather than
a file extension — so without it a progressive MP4 could be handed to the HLS
extractor. The adapter now sets an explicit MIME type from this field. A real
correctness fix, surfaced by adding the field.

Unknown values fall back to `progressive` on both platforms: a released app must
not break because the server added a rendition form.

---

## 8. The operational prerequisite

**HLS is preferred and does not exist.** The live path already proxies protected
HLS; a VOD playlist would inherit segment-level revocation and adaptive bitrate
for free. Nothing in this repository packages one, so every recording today is
`progressive`. The `hls` value exists so the gate does not need rewriting if that
changes, and its absence is stated rather than implied.

**There is no canonical way in this pipeline to re-encode a recording.** Traced
rather than assumed:

- **The browser publisher already produces a compliant rendition.**
  `ws-ingest.py` transcodes WebM to `-c:v libx264 … -c:a aac` before it reaches
  MediaMTX, so a service published from the studio records H.264 + AAC and
  passes this gate.
- **An RTMP encoder's output is recorded as sent.** MediaMTX does not re-encode,
  so whatever the camera or encoder emits is what lands in storage. This is the
  path that can fail the gate.
- **`ffprobe` is on the box for duration only** — `on-stream-stop.sh` and
  `upload-recording.sh` each call it for `format=duration` and nothing else.
- **`upload-recording.sh` sends `content-type: video/mp4` unconditionally**,
  whatever the file is. Which is the third reason not to trust it.

So when a recording fails the gate, the honest outcome is: it stays unpublished,
and somebody changes the encoder. In order of preference:

1. **Configure the RTMP encoder to send H.264 + AAC.** This is the default on
   essentially every encoder; a church hitting this has usually changed a
   setting or is using an HEVC-capable camera.
2. **Re-record.** For a one-off, the simplest fix.
3. **Convert on the relay box and re-upload** with
   `infra/stream-relay/upload-recording.sh`. `ffmpeg` is already on that box for
   browser ingest. `-c:v libx264 -c:a aac -movflags +faststart` produces a
   rendition this gate accepts. **This is an operator action, not a product
   feature** — nothing in FaithForm runs it, and nothing should without a
   deliberate decision about where the compute lives and who pays for it.

Adding a transcoder to the application would be a second recording authority
with its own queue, its own failure modes and its own storage bill. That is a
product decision, not a closure.

---

## 9. Limits, stated

### The parser

- **It reads at most 1 MiB from the front and 4 MiB from the back.** A file whose
  `moov` is in neither window is reported `index_not_found` and stays
  unpublished. Real recordings do not look like that; a deliberately hostile one
  is refused, which is the right direction to fail in.
- **A 64-bit box size is refused rather than parsed.** A single recording larger
  than 4 GiB will not verify. A real limit, not fixed here.
- **A `moov` larger than 8 MiB is not walked into**, and neither is any other
  container box. `mdat` is never walked into at all, so its size is irrelevant.
- **Nesting is capped at 8 and the box count at 4 096**, and the walk is
  iterative — no recursion, because a stack is not a bound anyone chose. A file
  past either ceiling is `probe_limit_exceeded`, which is a refusal and never a
  verdict of "fine".

### What conformance does and does not prove

- **It proves conformance to the portable profile, not decode on a device.** A
  file that is genuinely H.264 High 4.2 at 1080p60 passes and may still stutter
  on a six-year-old phone under thermal load. Real playback is runbook §4.
- **The gate reads `avcC` and `esds`, not the bitstream.** Profile, level,
  chroma, bit depth, AAC object type, sample rate and channel count all come
  from the normative configuration records. A file whose configuration record
  disagrees with its own SPS is not detected, and is a broken encoder rather than
  a plausible attack.
- **`hls` is a value the schema carries and nothing produces.** Every recording
  today is `progressive`.

### The identity

- **The hash covers the inspected window, not the whole object.** Hashing three
  hours of video would mean transferring it. A change confined to the middle of a
  file, outside both windows, is caught by the content length instead.
- **Grant and delivery compare only what a response advertises** — ETag, version
  id, length. They cannot re-hash a window without transferring it. That is why a
  playable verdict is required to carry one of those three as well as a hash.
- **A provider that returns no validator at all is refused**, not trusted. That
  is fail-closed, and it means a storage backend that stops returning
  `Content-Range` on a 206 would stop delivery until it was fixed.
- **`If-Match` is a request, not a guarantee.** A provider that ignores it is
  caught by the response check instead, which is why both exist.

### Not observed

**Nothing here has been run against a real recording.** Every fixture is a byte
structure built in the tests — real ISO base media layouts with real `avcC` and
`esds` records, but not an MP4 from an actual service, and not a real Supabase
Storage response. The identity comparison has never seen a provider's actual
ETag. That is a device-and-provider runbook step, §4 and §12, and it is the first
thing that should be exercised on a pilot church.
