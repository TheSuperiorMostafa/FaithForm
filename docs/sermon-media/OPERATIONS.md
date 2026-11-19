# Sermon media: rollout and operations

Transcripts of saved recordings, a staff-confirmed sermon range, lessons built
from what the pastor said, and Facebook Reels clips. Contract with the worker:
[WORKER_CONTRACT.md](./WORKER_CONTRACT.md). Worker: [workers/sermon-media](../../workers/sermon-media/README.md).

## Shape

| Piece | Where | Notes |
| --- | --- | --- |
| Job state, transcripts, ranges, clips, posts | Supabase (0170) | service-role only; RLS on with no browser grants |
| Lesson Builder marker | Supabase (0171) | `sermons.builder` ('sermon' / 'lesson') |
| Dashboard + authorized requests | Vercel | `app/api/sermon-media/**`, `app/api/lessons` |
| Dispatch / reconcile | Vercel cron `* * * * *` | `/api/sermon-media/dispatch` (CRON_SECRET) |
| Transcription | Modal, L4, scale to zero | `Transcriber`, `max_containers` (default 10) |
| Clip render | Modal, CPU | `render_job`, FFmpeg |
| Reels publish | Vercel route + cron | Graph `v27.0` (`FACEBOOK_REELS_GRAPH_VERSION`) |

## Rollout slices (each reviewable on its own)

1. **Schema** — apply `0170_sermon_media.sql`, then `0171_lesson_builder.sql`. Both are
   additive; old app versions keep working. Rehearse on a disposable database first:
   `FAITHFORM_PG_PORT=<port> pnpm test:sermon-media-database`.
2. **Lesson Builder split** — ships with 0171 and is independent of the flag below.
3. **Worker** — deploy Modal (README steps), create the proxy token.
4. **Dashboard env** (Vercel): `SERMON_MEDIA_WORKER_SECRET` (32+ chars), `SERMON_MEDIA_WORKER_URL`,
   `MODAL_PROXY_TOKEN_ID`, `MODAL_PROXY_TOKEN_SECRET`, `SERMON_MEDIA_CALLBACK_ORIGIN`
   (the public https origin), optional caps. Leave `SERMON_MEDIA_ENABLED=0` until ready.
5. **Turn on** `SERMON_MEDIA_ENABLED=1`. Nothing happens for any church yet.
6. **Per church** (pilot first): in the platform admin, turn on the church's
   **Transcripts & Clips** feature switch (it ships off). Non-admin staff also need the
   feature granted. That is all: the church gets the defaults below, and its admins can
   change them in **Clips → Posting schedule**. The `sermon_media_settings` row is only
   created when someone changes a setting.

   | Default | Value |
   | --- | --- |
   | Transcribe each new service automatically | on |
   | Confirm the sermon range automatically when confidence ≥ 0.8 | on |
   | Prepare clips automatically after each service | on, 3 per service |
   | Post approved clips | weekdays 12:00, one a day, church time zone |

   Turning the switch off hides both sections, stops new jobs and holds scheduled posts.

Rollback: turn the church's switch off, or `SERMON_MEDIA_ENABLED=0` for all.
The tables can stay; nothing else reads them.

## After each service (the studio)

transcript ready → sermon range confirmed automatically when the evidence is strong
(staff can move it; their confirmation replaces FaithForm's) → the best clips found,
captioned, cropped 9:16 and rendered → **Clips → Ready to review**: an admin watches each
final video and approves with one tap → approved clips post at the next free slot on the
church's schedule. An edit after approval withdraws it. At post time everything is
re-checked (current video, same Facebook Page, feature still on); a clip that no longer
qualifies goes back to review with the reason instead of posting.

## How work flows

- A recording verified playable → `onVerifiedReady` hook (fast path) and the cron sweep
  (durable path, last 3 days) queue one `transcribe` job per verified revision.
  Older recordings: "Start transcript" on the recording page.
- Dispatch claims within the global cap and each church's `max_concurrent_jobs`,
  issues a fresh lease, signs a job token, and hands the job to Modal. A failed hand-off
  returns the job to the queue; an expired lease is reclaimed (bounded attempts, backoff).
- The worker resolves media at execution time (`sources`, URLs signed for 2 h), heartbeats,
  and posts results. SQL accepts results only from the current lease + attempt.
- Staff confirm the sermon range → lessons and clips use only that range (enforced server-side).
  Moving the range or correcting text inside it bumps the input version and flags lessons
  and clips built on the old input. Saved and posted versions are not changed.
- Post to Facebook: admin only, bound to the render watched (spec hash), the Page shown,
  and the caption. One post per render and Page unless the earlier one definitively failed.
  The provider video id is saved before upload; an ambiguous finish becomes `needs_check`
  and is reconciled from Meta's status, never re-sent blindly.

## Deletion

Deleting a recording hides its transcript, clips and range at once (every route checks
`deleted_at`) and cancels its jobs. When the recording reconciler purges its media,
the sermon-media cleanup removes rendered clips from storage and deletes transcripts and
clip drafts. Lessons already saved stay (they are the church's documents); their link to
the recording goes. Reels already on Facebook stay on Facebook.

## Observability

One JSON log line per event, `msg: "sermon_media"`: `job_enqueued`, `job_dispatched`
(with `queueAgeMs`), `job_started`, `transcript_committed`, `range_suggested`,
`render_committed`, `job_failed` (code, retryable), `reel_post_requested`, `reconciled`
(per-step durations, queue depth, oldest queued age). Job rows keep stage durations,
audio seconds and engine in `metrics`. No tokens, signed URLs or transcript text are logged.

Useful queries:

```sql
-- Queue now
select kind, status, count(*), max(now() - created_at) as oldest
  from public.media_jobs where status in ('queued','dispatched','running') group by 1, 2;
-- Failures this week
select last_error_code, count(*) from public.media_jobs
 where status = 'failed' and finished_at > now() - interval '7 days' group by 1 order by 2 desc;
-- GPU seconds this week (cost = seconds × L4 rate)
select sum((metrics->'stages'->>'asr_s')::numeric) from public.media_jobs
 where kind = 'transcribe' and finished_at > now() - interval '7 days';
```

## Capacity (Sunday batch)

Scenario: 100 two-hour services ready within an hour, 10 L4 workers.
`workers/sermon-media/bench/simulate_queue.py` with **assumed** timings (Parakeet RTF 0.010,
50 s cold start, 60 s download, 30 s decode, 45 s audio events) projects a drain of about
61 minutes, p95 queue age about 1 minute, and about $0.09 per recording. These are not
measurements. Run `bench/benchmark.py` on one L4 with real services, then re-run the
simulation with `--stage-file measured.json`.

## Still to verify before a church sees it

- GPU image build and real Parakeet / faster-whisper / YAMNet runs; engine choice from
  measured Scripture/name accuracy, word timing and throughput.
- The deployed Modal endpoint, proxy auth and spawn.
- Meta: a staging Page publish end to end (permalink lookup is undocumented for Reels),
  App Review for `pages_manage_posts` if not already approved.
- The dashboard UI in Safari/WebKit at narrow widths and short heights.
