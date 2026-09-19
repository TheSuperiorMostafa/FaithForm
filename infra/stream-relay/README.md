# FaithForm stream relay

RTMP ingest on `stream.faithform.io`, copy-mode fan-out to YouTube/Facebook via ffmpeg.

## Architecture

```text
ATEM/OBS → rtmp://stream.faithform.io/live
             stream key: {churchId}?token={short-lived capability}
                ↓ MediaMTX
                ↓ publish auth → FaithForm
                ↓ relay-config → FaithForm
                ↓ on-stream-ready.sh
                ↓ ffmpeg -c copy
           YouTube + Facebook RTMP
```

## Deploying changes to this directory

The hooks run from `~/scripts` on the relay box, so editing them here changes
nothing until they are copied over:

```bash
./infra/stream-relay/deploy.sh
```

That syncs the scripts and `mediamtx.yml`. MediaMTX watches its configuration
and reloads the path rules in place, so an ordinary deploy does not interrupt a
service already on air. To restart only the browser-ingest bridge after syncing,
run `./infra/stream-relay/deploy.sh --restart-ws-ingest`. Use `--bootstrap` only
for host setup changes that require sudo and a full MediaMTX restart.

## Server setup

1. SSH key installed for `mostafa@stream.faithform.io`
2. Binaries in `~/bin` (mediamtx, ffmpeg)
3. Run once with sudo:

```bash
sudo bash ~/scripts/bootstrap.sh
```

4. Edit `/etc/faithform-stream-relay.env`:

```bash
FAITHFORM_APP_URL=https://faithform.io
STREAM_RELAY_WEBHOOK_SECRET=replace-me
```

5. Restart the service:

```bash
sudo systemctl restart faithform-mediamtx
```

Per-church destinations now live in FaithForm Settings, not on the relay box.

## Server-side HLS upstream

MediaMTX serves HLS on port `8888`, but its read auth denies direct browsers.
Only the FaithForm HLS proxy supplies the separate playback credential. Set in
Vercel:

```bash
STREAM_HLS_UPSTREAM_URL=https://hls.faithform.io   # or direct :8888 if firewall open
STREAM_RELAY_PLAYBACK_SECRET=replace-with-a-distinct-secret
```

Expose port `8888` only as required for the application server or a named
Cloudflare Tunnel. A direct request without proxy credentials must receive an
authorization failure; viewers use `/api/stream/hls/...` only.

## Browser studio WebSocket ingest

`ws-ingest.py` listens on `8090`. Set in Vercel:

```bash
STREAM_WS_INGEST_UPSTREAM_URL=wss://ingest.faithform.io
```

Use a **named Cloudflare Tunnel** for `ingest.faithform.io` → `http://127.0.0.1:8090` so browser studio survives relay restarts (avoid ephemeral `trycloudflare.com` URLs).

Keep the hostname one level deep. Cloudflare's Universal SSL covers `*.faithform.io`
but not `*.stream.faithform.io`, so `ingest.stream.faithform.io` fails the TLS
handshake and the browser studio cannot connect.

## SRT ingest

SRT listener is enabled on port `8890`. Use the same stream path as RTMP with your SRT-capable encoder.

## Simulated live

Cron on the relay (every minute):

```bash
* * * * * /home/mostafa/scripts/poll-simulated.sh >> /home/mostafa/mediamtx/logs/simulated.log 2>&1
```

FaithForm schedules simulated events; the relay publishes the uploaded file to the church ingest path.

## Recording

Every authorized ingest is recorded by `faithform-recorder.py` (see
`docs/faithform/P15_LIVESTREAM_RECORDING_LIFECYCLE.md`):

1. `on-stream-ready.sh` starts `faithform-recorder.py take <path>` detached, so
   MediaMTX restarting the hook can never cut a recording short.
2. ffmpeg writes 6-second fMP4 HLS segments (video copied, audio normalized to
   AAC) under `~/mediamtx/recordings/takes/<take>/`.
3. Every few seconds the recorder asks FaithForm what to do with each closed
   segment (`/api/stream/relay/recording/prepare`), uploads it straight to
   private storage with a one-off URL, and confirms (`.../commit`). Segments
   outside any broadcast (preview before Go Live, after End) are skipped.
4. `on-stream-stop.sh` runs `faithform-recorder.py stop <path>`; ffmpeg closes
   its last segment and the recorder finishes uploading on its own.

Every call is signed (HMAC over timestamp, nonce and body); the shared secret
never crosses the wire. Local files stay until FaithForm acknowledges them.

Install the sweeper once, which resumes any take whose recorder died:

```bash
./infra/stream-relay/deploy.sh --install-recorder-cron
```

Deploy the app (and migration 0095) **before** the relay. Deploy outside
service hours.

## Fan-out to YouTube and Facebook

One `ffmpeg` per destination, supervised independently.

A single `tee` process used to carry all of them, and that was the bug: the
relay logs show single-destination pushes running for a whole service and every
two-destination push dying silently after exactly five seconds — the RTSP
input's `-timeout` — then again on each retry. Neither platform got video.

Why tee tripped that timeout is inference rather than proof: replaying the old
tee against two local sinks does not reproduce it, because local sinks accept
instantly. It needs a real destination across the internet, which cannot be
tested without going live on a real channel. So both candidate causes are
removed — separate processes (a slow or refusing platform can no longer delay or
kill the other) and a much larger input timeout.

Verified end to end on the relay with two local RTMP sinks: both received the
full 1280x720 stream simultaneously, and the pending → success reports reached
the app.

Each push reports itself to `/api/stream/syndication/report` — pending when it
starts, success once it has held for 20s, failed when it drops — which is what
the Live Stream dashboard shows. Provisioning a destination no longer counts as
a successful push.

**ffmpeg must never be given a hostname.** The static ffmpeg on this box
segfaults inside DNS resolution — measured against the real endpoints:

| destination | result |
| --- | --- |
| `rtmp://a.rtmp.youtube.com/live2/…` | exit 139 (SIGSEGV) |
| `rtmp://142.251.179.134/live2/…` | clean rejection of a bad key |
| `rtmps://live-api-s.facebook.com:443/…` | exit 139 (SIGSEGV) |
| `rtmps://57.144.70.149:443/…` | clean rejection of a bad key |

This is why nothing reached a platform. Plain `rtmp://` was already pinned to an
A record, so YouTube survived; `rtmps://` was left alone because TLS validates
against a hostname, so Facebook crashed every time — and under the old single
`tee` it took YouTube down with it.

The relay resolves in python (which uses NSS correctly) and passes ffmpeg an
address, keeping the certificate check with `-verifyhost`. That is stricter than
before: `tls_verify` defaults to `0` in this build, so Facebook's certificate was
not being verified at all.

Replacing ffmpeg with the distro build (`sudo apt install ffmpeg`, 8.0.1 on
Ubuntu 26.04) would remove the underlying crash. The relay does not depend on
that — it never hands over a hostname — but it is worth doing.

## Encoder settings

- Server: `rtmp://stream.faithform.io/live`
- Stream key: supplied just-in-time by the paired FaithForm encoder agent as
  `{churchId}?token={short-lived capability}`

Do not store or manually distribute the historical persistent publish key. A
direct hardware encoder must use an approved capability broker/agent rather
than a static key.

## Logs

- Service: `journalctl -u faithform-mediamtx -f`
- MediaMTX hooks and ffmpeg output both flow into the systemd journal
