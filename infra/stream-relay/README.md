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
STREAM_HLS_UPSTREAM_URL=https://hls.stream.faithform.io   # or direct :8888 if firewall open
```

Open firewall/tcp for `8888` on the relay host if browsers cannot load `.m3u8` playlists, **or** proxy HLS through a named Cloudflare Tunnel (see `DEPLOY.md`).

## Browser studio WebSocket ingest

`ws-ingest.py` listens on `8090`. Set in Vercel:

```bash
STREAM_WS_INGEST_UPSTREAM_URL=wss://ingest.stream.faithform.io
```

Use a **named Cloudflare Tunnel** for `ingest.stream.faithform.io` → `http://127.0.0.1:8090` so browser studio survives relay restarts (avoid ephemeral `trycloudflare.com` URLs).

## SRT ingest

SRT listener is enabled on port `8890`. Use the same stream path as RTMP with your SRT-capable encoder.

## Simulated live

Cron on the relay (every minute):

```bash
* * * * * /home/mostafa/scripts/poll-simulated.sh >> /home/mostafa/mediamtx/logs/simulated.log 2>&1
```

FaithForm schedules simulated events; the relay publishes the uploaded file to the church ingest path.

## Recording

`on-stream-ready.sh` records a local MP4 and `on-stream-stop.sh` notifies FaithForm via
`/api/stream/recording-complete`.

## ATEM settings

- Server: `rtmp://stream.faithform.io/live`
- Stream key: `{churchId}/{publishKey}`

## Logs

- Service: `journalctl -u faithform-mediamtx -f`
- MediaMTX hooks and ffmpeg output both flow into the systemd journal

## Troubleshooting

### OBS shows green but nothing reaches YouTube or the dashboard

Usually one of two problems on the relay box:

1. **`faithform-mediamtx` is down** — check `systemctl status faithform-mediamtx`. A common cause is `hlsAllowOrigins` in `~/mediamtx/mediamtx.yml`; the installed binary only accepts the deprecated singular `hlsAllowOrigin: '*'`. MediaMTX exits immediately on unknown fields.
2. **A manual `mediamtx` process is running without auth** — check `pgrep -a mediamtx`. More than one process, or a bare binary started outside systemd, means RTMP ingest works but `MTX_AUTHMETHOD` / `MTX_AUTHHTTPADDRESS` were never set, so publish auth and `on-stream-ready.sh` never run.

**Fix:** upload and run the repair script:

```bash
# From your laptop
scp infra/stream-relay/repair-mediamtx.sh mostafa@stream.faithform.io:~/scripts/
scp infra/stream-relay/mediamtx.yml mostafa@stream.faithform.io:~/mediamtx/mediamtx.yml

# On the server
sudo bash ~/scripts/repair-mediamtx.sh
```

The script renames the incompatible HLS field, kills stray processes, starts systemd with auth wiring, and smoke-tests `/api/stream/publish-auth`.

**When fixed:** `systemctl is-active faithform-mediamtx` returns `active`, `pgrep -a mediamtx` shows exactly one process, and an OBS publish attempt appears in the journal with an HTTP auth callback.

**Note:** `hlsAllowOrigins` requires a newer MediaMTX binary. Until the relay binary is upgraded, keep `hlsAllowOrigin: '*'` in `mediamtx.yml`.
