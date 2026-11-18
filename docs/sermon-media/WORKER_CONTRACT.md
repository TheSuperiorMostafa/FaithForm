# Sermon media worker contract

The dashboard (Vercel) owns job state in Supabase (`media_jobs`, migration 0167).
The worker (Modal) owns only compute. It never holds a database key, a Facebook
token, or a long-lived storage credential.

## Dispatch

1. A job is enqueued with `enqueue_media_job` (idempotent per `dedupe_key`).
2. `GET /api/sermon-media/dispatch` (Vercel cron, every minute, `CRON_SECRET`) and a
   best-effort inline kick after each enqueue call `claim_media_jobs(kind, cap)`.
   Each claimed job gets a fresh `lease_token` and a dispatch lease (15 min).
3. For each claimed job the dashboard POSTs to the worker submit endpoint
   (`SERMON_MEDIA_WORKER_URL`, Modal `fastapi_endpoint(requires_proxy_auth=True)`,
   headers `Modal-Key` / `Modal-Secret`):

   ```json
   { "job_id": "uuid", "kind": "transcribe" | "render_clip",
     "callback_base": "https://<host>/api/sermon-media/worker/<job_id>",
     "job_token": "<opaque capability>" }
   ```

   The endpoint calls `.spawn()` and returns `{ "call_id": "fc-..." }`, which is
   stored as `dispatch_ref`. A failed hand-off returns the job to the queue.
4. Modal itself caps GPU containers (`max_containers`, default 10). The dashboard
   also caps dispatched jobs globally (`SERMON_MEDIA_GLOBAL_CAP`, default 10) and per
   church (`sermon_media_settings.max_concurrent_jobs`), so queued work waits in
   Supabase, not in Modal, and leases do not expire while waiting.

## Job token

`job_token` is an HMAC-SHA256 capability (`SERMON_MEDIA_WORKER_SECRET`) over
`{ job id, lease token, expiry (6 h) }`. It is valid only for that job's callback
routes and only while that lease is current. The worker must never log it, or any
signed URL; log job id and stage only.

## Callbacks

All callbacks are `POST {callback_base}/<name>` with `Authorization: Bearer <job_token>`
and a JSON body that includes `attempt_id` (a UUID the worker generates once per run).
Responses: `200` with JSON, `409 {"status":"stale"|"cancelled"}` — stop immediately
and exit cleanly, `401` — stop, `5xx` — retry with backoff (bounded, 5 tries).

| name | body | response |
| --- | --- | --- |
| `begin` | `{attempt_id}` | `{status:"ok", kind, params}` — binds this attempt; a duplicate delivery gets 409 |
| `sources` | `{attempt_id}` | media resolved now (see below); call again if URLs near expiry |
| `heartbeat` | `{attempt_id, stage, progress}` | `{status:"ok"}`; send at least every 60 s |
| `transcript` | transcript result (below) | `{status:"ok", version}` |
| `render-result` | render result (below) | `{status:"ok"}` |
| `fail` | `{attempt_id, code, message, retryable, metrics}` | `{status:"ok"}` |

`code` matches `^[a-z0-9_]{1,60}$`; `message` is plain language for staff, no URLs,
no tokens, at most 300 characters.

### `sources` for `transcribe`

```json
{
  "timeline_duration_sec": 5400.0,
  "expires_at": "ISO time",
  "language": "auto" | "en" | "es" | ...,
  "kind": "segments",
  "runs": [
    { "index": 0, "timeline_start_sec": 0.0, "duration_sec": 1800.0,
      "init_url": "https://...", 
      "segments": [ { "seq": 0, "timeline_start_sec": 0.0, "duration_sec": 6.0, "url": "https://..." } ] }
  ],
  "gaps": [ { "timeline_sec": 1800.0, "reason": "discontinuity" | "missing_segment" } ]
}
```

A run is a contiguous block of one take: init + consecutive segments. Runs are
separated by an `EXT-X-DISCONTINUITY` in the player. The timeline has no holes:
reconnect gaps are already removed, so `timeline_start_sec` of run *n+1* equals the
end of run *n*. Decode each run independently and add its `timeline_start_sec`.

For a file recording: `"kind": "file", "file": { "url": "...", "timeline_start_sec": 0 }`.

### Transcript result

```json
{
  "attempt_id": "uuid",
  "language": "en",
  "engine": "parakeet-tdt-0.6b-v3" | "faster-whisper-large-v3-turbo",
  "duration_sec": 5400.0,
  "segments": [
    { "id": "s000001", "start": 12.34, "end": 17.9, "text": "Turn with me to John chapter six.",
      "words": [ { "w": "Turn", "s": 12.34, "e": 12.6, "p": 0.98 } ],
      "conf": 0.93, "flags": [] }
  ],
  "gaps": [ { "start": 0.0, "end": 41.2, "reason": "music" | "silence" | "noise" | "missing_audio" | "discontinuity" } ],
  "audio_events": [ { "start": 3001.0, "end": 3003.9, "label": "applause" | "laughter" | "music" | "crowd", "score": 0.81 } ],
  "metrics": { "stages": { "download_s": 0, "decode_s": 0, "asr_s": 0, "events_s": 0 },
               "audio_sec": 5400, "gpu": "L4", "engine": "...", "rtf": 0.01 }
}
```

Times are seconds on the recording timeline, rounded to milliseconds, strictly
ordered and non-overlapping across segments. Segment ids are stable within a
version (`s` + zero-padded index). `flags` may contain `uncertain` (low confidence),
`noise`, `music`, `overlap_merged`. Words are omitted when the engine gives none.

### `sources` for `render_clip`

```json
{
  "spec": {
    "start_sec": 1234.5, "end_sec": 1290.0,
    "framing": { "mode": "speaker" | "wide_fit" | "manual", "x": 0.5 },
    "captions": [ { "start": 0.0, "end": 2.4, "text": "relative to start_sec" } ],
    "captions_enabled": true,
    "output": { "width": 1080, "height": 1920, "fps": 30 }
  },
  "media": { ...same shape as transcribe sources, limited to runs that overlap the clip... },
  "upload": { "signed_url": "https://...", "storage_path": "clips/<church>/<clip>/<render>.mp4", "content_type": "video/mp4" }
}
```

### Render result

```json
{ "attempt_id": "uuid", "storage_path": "...", "byte_size": 123, "sha256": "hex",
  "probe": { "container": "mp4", "width": 1080, "height": 1920, "fps": 30, "duration_sec": 55.5,
             "video_codec": "h264", "pix_fmt": "yuv420p", "audio_codec": "aac", "audio_rate": 48000,
             "audio_channels": 2, "faststart": true, "gop_sec": 2.0, "bitrate": 8000000 },
  "framing_used": { "mode": "speaker", "fallback": false, "notes": "..." },
  "metrics": { "stages": { "download_s": 0, "render_s": 0, "upload_s": 0 } } }
```

The dashboard re-validates `probe` against the Reels specification before marking
the render ready.
