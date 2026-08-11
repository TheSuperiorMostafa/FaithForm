# FaithForm stream relay

RTMP ingest on `stream.faithform.io`, copy-mode fan-out to YouTube/Facebook via ffmpeg.

## Architecture

```text
ATEM/OBS → rtmp://stream.faithform.io/live
             stream key: {churchId}/{publishKey}
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

That syncs the scripts and `mediamtx.yml`, re-runs `bootstrap.sh` (idempotent —
it also installs the IPv4 precedence line the Facebook push needs), and restarts
MediaMTX.

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

## HLS preview and public watch

MediaMTX serves HLS on port `8888`. Set in Vercel:

```bash
NEXT_PUBLIC_STREAM_HLS_BASE_URL=https://stream.faithform.io:8888
STREAM_HLS_UPSTREAM_URL=https://hls.faithform.io   # or direct :8888 if firewall open
```

Open firewall/tcp for `8888` on the relay host if browsers cannot load `.m3u8` playlists, **or** proxy HLS through a named Cloudflare Tunnel (see `DEPLOY.md`).

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

`on-stream-ready.sh` records a local MP4. When the service ends, `on-stream-stop.sh`:

1. asks FaithForm for a signed upload URL (`/api/stream/recording-upload-url`),
2. `PUT`s the file straight to Supabase Storage — the app never sees the bytes,
3. tells FaithForm where it landed (`/api/stream/recording-complete`).

The local copy is kept. To upload something recorded before step 1 existed, or
after a failed upload:

```bash
STREAM_RELAY_WEBHOOK_SECRET=… ~/scripts/upload-recording.sh
```

With no arguments it walks `~/mediamtx/recordings` and uploads everything whose
stream path it can read from the file name. Pass `<mtxPath> <file>` to do one.

The app side needs the `stream-recordings` bucket to exist. From the repo:

```bash
pnpm storage:buckets
```

## Fan-out to YouTube and Facebook

One `ffmpeg` per destination, supervised independently. A single `tee` process
used to carry both, so a destination that failed to connect killed the whole
process and took the working platform down with it.

Each push reports itself to `/api/stream/syndication/report` — pending when it
starts, success once it has held for 20s, failed when it drops — which is what
the Live Stream dashboard shows. Provisioning a destination no longer counts as
a successful push.

**IPv4 precedence is required.** ffmpeg 7.0.2 crashes connecting to RTMP over
IPv6, and both platforms publish AAAA records. Plain `rtmp://` is pinned to an A
record by the script, but Facebook is `rtmps://` and TLS must validate against
the hostname — so the resolver has to prefer IPv4 system-wide:

```bash
sudo bash ~/scripts/bootstrap.sh   # adds `precedence ::ffff:0:0/96  100` to /etc/gai.conf
```

`on-stream-ready.sh` writes a warning into the path log if that line is missing.

## ATEM settings

- Server: `rtmp://stream.faithform.io/live`
- Stream key: `{churchId}/{publishKey}`

## Logs

- Service: `journalctl -u faithform-mediamtx -f`
- MediaMTX hooks and ffmpeg output both flow into the systemd journal
