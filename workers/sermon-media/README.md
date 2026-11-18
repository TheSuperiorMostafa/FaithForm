# Sermon media worker (Modal)

Python compute for sermon transcription and Reels clip rendering. Implements
[`docs/sermon-media/WORKER_CONTRACT.md`](../../docs/sermon-media/WORKER_CONTRACT.md). The worker
holds no database key or long-lived storage credential. It receives a per-job
`job_token` and reads signed URLs from the `sources` callback. Logs contain the job id
and stage only.

```
modal_app.py            Modal app "faithform-sermon-media": submit endpoint, Transcriber (L4), render_job (CPU)
sermon_media/
  callbacks.py          callback client (retries, 409 stale/cancelled, redaction) + heartbeat thread
  timeline.py           segment/file download, per-run decode to a 16 kHz timeline WAV, missing_audio gaps
  windows.py            20 min / 20 s windows, midpoint stitching, segments, gap classification
  engines.py            Parakeet TDT 0.6B v3 and faster-whisper large-v3-turbo adapters, engine selection
  audio_events.py       YAMNet applause/laughter/crowd/music events (optional, never fatal)
  render.py             clip assembly, framing (manual / wide_fit / speaker), ASS captions, encode, probe, upload
  jobs.py               run_transcribe / run_render orchestration, submit validation
bench/benchmark.py      engine comparison on real recordings (RTF, cost, Scripture/name recall, WER)
bench/simulate_queue.py Sunday-rush queue simulation (drain time, queue age, cost)
tests/                  local pytest suite (ffmpeg fixtures, stub dashboard)
```

## Deploy

1. Install and authenticate the Modal CLI (`pip install "modal>=1.6,<2"`, then `modal setup`).
2. Create the runtime secret. Every key is optional; defaults are listed below:
   ```sh
   modal secret create faithform-sermon-media \
     ASR_ENGINE=parakeet ASR_FALLBACK_ENGINE=faster_whisper AUDIO_EVENTS=true
   ```
3. Deploy. Deploy-time limits are read from your shell:
   ```sh
   MAX_GPU_CONTAINERS=10 modal deploy workers/sermon-media/modal_app.py
   ```
   Note the URL Modal prints for `submit` (for example `https://<workspace>--faithform-sermon-media-submit.modal.run`).
4. Create a proxy auth token: Modal dashboard → Settings → Proxy Auth Tokens → New token.
   Callers send it as the `Modal-Key` / `Modal-Secret` headers.
5. Set these in Vercel (Production, and Preview if wanted):
   - `SERMON_MEDIA_WORKER_URL`: the `submit` URL
   - `MODAL_PROXY_TOKEN_ID` / `MODAL_PROXY_TOKEN_SECRET`: the proxy token (use whatever names the dashboard code reads)
   - `SERMON_MEDIA_GLOBAL_CAP`: keep equal to `MAX_GPU_CONTAINERS`
6. Model weights download to the `faithform-sermon-media-models` Volume on the first cold
   start (Parakeet about 2.4 GB, Whisper turbo about 1.6 GB, YAMNet). That first job is
   slow. After it, models load from the Volume.

`submit` returns `{"call_id": "fc-..."}`. It responds 422 with `{error, detail}` when the
body shape is invalid and 400 for malformed JSON. It never echoes the body.

## Configuration

| Name | Where | Default | Meaning |
| --- | --- | --- | --- |
| `MAX_GPU_CONTAINERS` | deploy env | 10 | Modal `max_containers` for the L4 transcriber |
| `MAX_RENDER_CONTAINERS` | deploy env | 10 | `max_containers` for CPU renders |
| `SCALEDOWN_WINDOW_SEC` | deploy env | 120 | idle time before a container stops (`min_containers=0`) |
| `TRANSCRIBE_TIMEOUT_SEC` | deploy env | 3600 | per-call timeout (a 2 h service is expected to take ~4–10 min) |
| `RENDER_TIMEOUT_SEC` | deploy env | 1800 | per-render timeout |
| `GPU_TYPE` | deploy env | L4 | GPU for transcription and benchmark |
| `ASR_ENGINE` | secret | parakeet | `parakeet` or `faster_whisper` |
| `ASR_FALLBACK_ENGINE` | secret | faster_whisper | used when the language is outside Parakeet's 25, or Parakeet fails to load |
| `LANGID_MODEL` | secret | small | faster-whisper model used only for `language: auto` |
| `AUDIO_EVENTS` | secret | true | YAMNet events on/off. A job can also send `params.audio_events=false` |
| `ASR_WINDOW_SEC` / `ASR_OVERLAP_SEC` | secret | 1200 / 20 | ASR windows. Keep windows under 24 min for Parakeet full attention |
| `UNCERTAIN_BELOW` | secret | 0.6 | mean word confidence below this flags a segment `uncertain` |
| `CAPTION_FONT` | render image | DejaVu Sans | ASS caption font |
| `X264_PRESET` | secret | medium | x264 speed/quality trade-off |

## Tests (local, no GPU)

```sh
uv run --python 3.11 --with pytest --with numpy --with opencv-python-headless \
  pytest workers/sermon-media/tests
```
The tests need `ffmpeg`/`ffprobe` with libx264 and libass on `PATH`. They build fMP4 HLS
fixtures with ffmpeg and serve them from a local HTTP server, and they use a stub
dashboard for callbacks and uploads. If OpenCV is not installed, the speaker-fallback
test is skipped.

## Benchmark on one L4

```sh
modal volume put faithform-sermon-media-bench service1.mp4 /service1.mp4
modal volume put faithform-sermon-media-bench terms.txt /terms.txt         # optional: "John 6:35", names...
modal volume put faithform-sermon-media-bench service1.txt /service1.txt   # optional reference transcript
modal run workers/sermon-media/modal_app.py::benchmark \
  --paths /data/service1.mp4 --terms /data/terms.txt --references /data/service1.txt
```
The benchmark prints JSON with per-stage durations, RTF, GPU name, and estimated warm
and cold L4 cost ($0.000222/s). It also reports term recall (Scripture references are
normalised, so "John chapter six verse thirty-five" matches "John 6:35") and WER through
jiwer. Transcripts and `report.json` are written to `/data/bench-out/` in the Volume.

You can also run it locally on any CUDA machine:
`python workers/sermon-media/bench/benchmark.py file.mp4 --terms terms.txt --out out/report.json`.

Then re-run the queue simulation with the measured numbers:
```sh
echo '{"download_s": 48, "decode_s": 22, "rtf_parakeet": 0.006, "cold_start_s": 41}' > measured.json
python workers/sermon-media/bench/simulate_queue.py --stage-file measured.json --sweep
```

## What is and isn't verified

Verified locally with ffmpeg 7.1 on macOS:
- segment and file assembly
- missing, unsigned, or corrupt segments, and a missing init
- run offsets and discontinuities
- window stitching
- segment and gap rules
- callback retry, 409, 401, and redaction behaviour
- heartbeat cancellation
- the full transcribe job with a fake engine
- the full render job: valid 1080x1920 H.264/AAC output with faststart, a 2 s GOP, and
  burned-in captions; upload headers; sha256

`modal_app.py` imports cleanly with modal 1.6.4.

Not verified (no Modal account or GPU here):
- **GPU image build.** NeMo + torch 2.5 + faster-whisper/CTranslate2 (cuDNN 9) +
  tensorflow-cpu in one image may have dependency conflicts. If they do, move YAMNet to
  its own CPU function or drop `tensorflow-cpu`.
- **Real Parakeet and faster-whisper calls.** `engines.py` follows the documented APIs,
  but the hypothesis/timestamp shapes and Parakeet word confidence (the
  `confidence_cfg` keys) are untested. Without confidence, Parakeet words carry no `p`
  and segments get no `uncertain` flag.
- **YAMNet loading and inference**, and real RTF and cold-start numbers. The queue
  simulation uses assumed timings.
- **The deployed `submit` endpoint and proxy auth**, and `spawn` from it.
- **Speaker framing on real church footage.** The Haar cascade is weak for small or
  profile faces, so wide or slide shots fall back to `wide_fit` by design.
- **The Ubuntu 22.04 GPU image ships ffmpeg 4.4.** Only audio decoding runs there.
  Rendering runs on the Debian bookworm image with ffmpeg 5.1, which supports `-fps_mode`.
