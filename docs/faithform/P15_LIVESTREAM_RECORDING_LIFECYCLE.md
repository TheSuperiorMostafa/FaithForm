# P15 — Livestream → automatic recording → on-demand publishing

Status: implemented in this change. This document is the audit that preceded
the work, the architecture it produced, and the operating notes that go with
it.

The mental model a church sees is:

```text
Prepare → Go Live → FaithForm records everything → End → Review → Publish
```

Everything below exists to make that sentence true without the church ever
having to think about the machinery underneath it.

---

## 1. Audit: what existed before this change

### 1.1 The provider

FaithForm does not use a hosted video provider. The "provider" is FaithForm's
own relay at `stream.faithform.io` (`infra/stream-relay/`):

* **MediaMTX** accepts RTMP/SRT/WebRTC ingest on `live/{churchId}`. Publishing
  is authorized by `/api/stream/publish-auth` against the church's permanent key
  or a short-lived capability.
* `on-stream-ready.sh` (MediaMTX `runOnReady`) fans the stream out to
  YouTube/Facebook with one `ffmpeg -c copy` per destination, heartbeats
  `/api/stream/lifecycle`, and **records one progressive MP4 per encoder
  connection**.
* `on-stream-stop.sh` (`runOnNotReady`) stops the recorder, asks the app for a
  signed upload URL, `PUT`s the whole MP4 to the private `stream-recordings`
  bucket, and calls `/api/stream/recording-complete`.
* Live playback goes through FaithForm's authorizing HLS proxies
  (`/api/stream/hls` for the website, `/api/media/v1/live` for the apps).

Changing providers was not warranted. MediaMTX and ffmpeg already produce
everything needed; what was missing was a **durable recording pipeline**, a
binding between a recording and its broadcast, and a lifecycle the dashboard
could present honestly.

### 1.2 The canonical media domain (kept, extended)

| Concept | Table | Notes |
| --- | --- | --- |
| Broadcast | `stream_events` | scheduled / live / ended / cancelled, mobile publication columns (0060) |
| Go-live attempt | `stream_sessions` | preparing / waiting_for_encoder / live / ended / error |
| Recording asset **and** published media item | `stream_recordings` | series, tags, artwork (0047/0080), mobile publication + playability gate (0060–0062) |
| Publication audit | `stream_media_publication_audit` | append-only |

Migration 0060 deliberately chose "no second media table": the recording row
*is* the member-facing media item, projected to phones by security-definer SQL
(`mobile_media_*`). This change keeps that decision.

### 1.3 What "Publish to App" actually did

`FaithFormPublishingPanel` on *Live Stream → Media* listed recent events and
recordings. "Publish" on a recording called `publishToFaithForm`, which
re-probed the MP4's bytes (`lib/media/v1/rendition*.ts`) and, if the file was a
portable H.264/AAC MP4, flipped `mobile_visibility` through
`publish_recording_to_faithful`. The gate itself was sound. The problem was that
**almost nothing reached it**.

### 1.4 Why no usable recording was being produced

Evidence from production (read-only query, 2026-09-19): one church, seven
sessions, four of which actually carried video (1, 3, 5 and 10 minutes). Only
**two** recordings exist:

| Broadcast | Result |
| --- | --- |
| 10 min | no recording row, no object in storage |
| 5 min | no recording row, no object in storage |
| 3 min | 50 MB object, **no MP4 index** (`index_not_found`), duration 0, unplayable |
| 1 min | 13 MB object, playable |

Both surviving rows have `stream_session_id = null` and `stream_event_id = null`.
Neither was ever published.

The causes, all in the recording path rather than in publishing:

1. **The MP4 index was written last and raced.** The recorder was
   `ffmpeg -f mp4 -movflags +faststart`, which writes the `moov` index only when
   ffmpeg exits cleanly, and then rewrites the whole file to move it to the
   front. `on-stream-stop.sh` sent `SIGTERM` and immediately ran `ffprobe` and
   the upload, while ffmpeg was still finalizing. Result: a truncated file with
   no index (the 3-minute service).
2. **One giant upload at the very end.** The entire service went up in a single
   non-resumable `PUT` after the stream stopped. Anything beyond roughly 50 MB
   (about three minutes at typical church bitrates) was refused by storage's
   object size limit, so the 5- and 10-minute services never landed. Nothing
   retried automatically; `upload-recording.sh` was a manual tool.
3. **Nothing was durable during the service.** Every byte lived only on the
   relay's disk until the stream ended. A relay restart, a crash, or a killed
   hook lost the entire service.
4. **Recordings were never bound to their broadcast.** `recording-complete`
   looked up the church's *active* session, but the stop hook fires after the
   operator has ended it — so the lookup always returned nothing. Every
   recording was an orphan titled "Service recording" with no artwork and no
   link to the event, and the publishing panel showed every ended service as
   "Waiting for recording" forever.
5. **Recording followed the encoder, not the broadcast.** Preview time before
   Go Live and anything after End was recorded; every reconnect produced a
   separate recording.
6. **The website ignored publication.** `/live/[slug]/watch/[id]` played *any*
   recording (unpublished, unverified) through a four-hour signed URL.
7. **No live → replay identity**, no seek bar on recordings in either app, no
   member notifications, no reconciliation job, and relay callbacks were
   authenticated by a static secret header with no signature, timestamp, or
   replay protection.

---

## 2. Architecture after this change

```text
Encoder ─RTMP/SRT/WebRTC─▶ MediaMTX live/{churchId}
                              │
          on-stream-ready.sh  ├─▶ fan-out ffmpeg ×N (YouTube, Facebook)   (unchanged)
                              │
                              └─▶ faithform-recorder.py take  (detached, one per connection)
                                    ffmpeg → 6 s fMP4 HLS segments on local disk
                                    uploader: prepare → PUT → commit, every few seconds
                                    heartbeat: recorder health every 20 s
                                         │  signed webhooks (HMAC, timestamp, nonce)
                                         ▼
                  /api/stream/relay/recording/{prepare,commit,take}, /api/stream/relay/heartbeat
                                         │
                   FaithForm attributes each segment to the broadcast whose
                   window contains it, stores it in the private bucket, and
                   indexes it in stream_recording_segments
                                         │
             End ──▶ processing ──▶ finalize (all segments in) ──▶ verify init segments
                                         │                          (existing byte-level probe)
                                         ▼
                                 ready ──▶ Publish (one click, or automatic)
                                         │
     mobile_media_* projections ◀────────┤──────▶ website watch page
     VOD playlist built from the segment index, served through the
     authorizing proxy (delivery token in the path, like live)
```

### 2.1 Recording is continuous, incremental and durable

* The relay records every authorized ingest as **6-second fragmented-MP4 HLS
  segments** (`-c:v copy`, audio normalized to AAC-LC 48 kHz stereo so
  browser-studio Opus also records portably). A segment is a complete, playable
  file the moment ffmpeg closes it; a crash loses at most the segment in
  progress.
* Each segment is uploaded within seconds, as its own immutable object
  (`upsert: false`), so no object is ever near a size limit and a service is
  already in storage while it is still on air.
* The relay keeps every segment on disk until FaithForm has acknowledged it,
  and a once-a-minute sweeper (`faithform-recorder.py sweep`) resumes any take
  whose uploader died — relay reboot, app outage, network drop.
* Encoder reconnects are separate **takes**. The VOD playlist joins them with
  `EXT-X-DISCONTINUITY`, so a service with three reconnects is still one
  recording.

### 2.2 Recording is bound to the broadcast, by time

Segments carry their wall-clock start (`EXT-X-PROGRAM-DATE-TIME`). FaithForm
attributes a segment to the session whose window contains it:
`session.created_at ≤ segment end` and `segment start < session.ended_at` (or
the session is still active). Consequences:

* Recording starts automatically at Go Live — there is no Record button and
  no way to run a normal FaithForm livestream without recording.
* Preview time before Go Live and trailing time after End are not recorded
  into the service (segments outside any broadcast are skipped and deleted from
  the relay).
* Late, retried or out-of-order uploads land in the right recording, because
  attribution never depends on "whatever is active now".
* The recording row is created **at Go Live**, carrying the event's title,
  event id and session id, so the live event and its recording are one content
  lifecycle from the first second.

### 2.3 Recording lifecycle

`stream_recordings.status`:

| status | meaning | staff sees |
| --- | --- | --- |
| `recording` | broadcast live; segments arriving | ● Recording |
| `processing` | broadcast ended; waiting for final segments / verification | Preparing your recording |
| `ready` | every segment in, verified playable | Ready to publish (or Published) |
| `ready` + not playable | verified, but not playable on phones | Needs attention |
| `failed` | nothing was recorded, or finalization could not complete | Needs attention |
| `deleted` | deleted by an admin; media purged; history kept | (hidden) |

Finalization (`lib/stream/recording-lifecycle.ts`) is reached when, for every
take that overlapped the broadcast, the relay has either reported the take
ended or uploaded a segment that starts after the broadcast ended, **and** no
segment is still awaiting upload. A recording that never reaches that point
(relay destroyed, disk lost) is finalized with what arrived after a grace
period, so a church is never left with "processing" forever.

Verification reuses the existing byte-level probe on every take's init segment
(the part that declares the codecs) and binds the verdict to an identity — a
SHA-256 over the init segments plus the segment manifest — so a publish can
never be bound to a segment list nobody verified.

### 2.4 Publishing is one idempotent, verified transaction

`publish_recording(...)` (SQL, service role only) locks the row, validates
(ready, playable, not deleted, title present, sane duration, church matches,
verdict revision and identity unchanged), sets app **and** website
publication, and writes the audit row only if something changed. Repeated
clicks, network retries and concurrent staff publish the same row once.

After the write, `lib/media/v1/publication.ts` reads the item back through the
**production read path** — `mobile_media_detail`, `mobile_media_playback_grant`
and the website's own query — and only then reports "Published". A publish that
cannot be confirmed is reported as a failure, never as success.

Auto-publish (church setting) runs the same function from the reconciler once
a recording reaches verified `ready`, with the church's default visibility and
series.

### 2.5 Playback

* **Apps.** `mobile_media_playback_grant` now returns `rendition_kind = 'hls'`
  for segment recordings. `grantPlayback` hands out
  `/api/media/v1/recording/{slug}/{id}/{deliveryToken}/index.m3u8`; the route
  re-authorizes (cached ≤15 s, like live), builds the VOD playlist from the
  segment index honouring the trim, and proxies init and media segments from
  private storage by id. Both native players already chose their pipeline by
  `renditionKind`; AVPlayer and Media3 play the VOD playlist natively with
  seeking.
* **Legacy MP4 recordings** keep the existing progressive route unchanged.
* **Website.** `/live/[slug]/watch/[id]` plays only website-published, playable
  recordings, through a short-lived signed web capability on the same VOD
  route family (`/api/stream/recordings/...`). The public live page lists the
  church's published services.
* **Dashboard preview.** Staff watch through the same web route with a
  staff-audience capability.

### 2.6 Reliability: webhooks plus reconciliation

* Relay → FaithForm calls are signed: `HMAC-SHA256(secret, ts.nonce.body)`,
  ±5 minutes, nonce recorded in `stream_relay_webhook_nonces` (replays refused),
  event type allow-listed by route, payloads parsed with Zod, tenant resolved
  from the MediaMTX path **and** re-checked against FaithForm's own take and
  session rows. The legacy static-header routes remain for relays not yet
  redeployed.
* All relay operations are idempotent by natural key (take id, take+seq), so
  duplicate and out-of-order delivery converge.
* `/api/stream/recordings/reconcile` (Vercel cron, every 2 minutes, plus
  opportunistically from the dashboard status poll) repairs: recordings stuck
  in `recording` after their session ended; `processing` recordings that are
  complete; complete-but-unverified recordings; auto-publish that did not run;
  live sessions whose encoder has been silent for an hour; pending storage
  purges after deletion; and old webhook nonces.

### 2.7 Security

* Every table added is RLS-enabled with church-scoped admin reads and no
  client writes; all writes go through the service role after a server-side
  admin check.
* Storage paths are derived by FaithForm from church and recording ids, never
  taken from the relay.
* Stream keys are revealed only in a server action reply (never page props),
  rate limited, audited, and can now be **rotated**.
* Playback authorization is always server-side; an HLS URL is not a
  credential on its own.

---

## 3. Operating notes

### 3.1 Deploy order

1. Apply `supabase/migrations/0095_livestream_recording_lifecycle.sql`.
2. Deploy the app (Vercel). The legacy relay keeps working against it.
3. Deploy the relay: `./infra/stream-relay/deploy.sh --install-recorder-cron`.
   New recorder only; MediaMTX keeps running. Do this outside service hours.
4. Ensure `STREAM_RELAY_WEBHOOK_SECRET` is set on both sides (unchanged) and
   `CRON_SECRET` is set in Vercel.

### 3.2 Remaining limitations

* Single rendition. The recording is served at the encoder's own quality; an
  adaptive ladder would need a transcoder on the relay.
* Trimming is segment-accurate (≤ 6 s), by design — no re-encode.
* No captions: FaithForm has no video caption or transcription infrastructure
  today. The VOD playlist can carry a WebVTT rendition when one exists.
* Downloads are not offered for segment recordings.
