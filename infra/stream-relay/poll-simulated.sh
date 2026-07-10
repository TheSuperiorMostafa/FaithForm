#!/usr/bin/env bash
# Poll FaithForm for simulated-live playout jobs and publish to MediaMTX.

set -euo pipefail

PATH="/home/mostafa/bin:/usr/local/bin:/usr/bin:/bin"
FFMPEG="/home/mostafa/bin/ffmpeg"
APP_URL="${FAITHFORM_APP_URL:-https://faithform.io}"
SECRET="${STREAM_RELAY_WEBHOOK_SECRET:-}"
PID_DIR="/home/mostafa/mediamtx/pids"

if [[ -z "$SECRET" ]]; then
  echo "[simulated] STREAM_RELAY_WEBHOOK_SECRET is not set"
  exit 1
fi

mkdir -p "$PID_DIR"

JOBS_JSON="$(curl -fsSL -H "x-stream-relay-secret: ${SECRET}" \
  "${APP_URL%/}/api/stream/simulated-playout")"

python3 -c '
import json, os, subprocess, sys

jobs = json.loads(sys.stdin.read()).get("jobs", [])
ffmpeg = os.environ.get("FFMPEG", "/home/mostafa/bin/ffmpeg")
pid_dir = os.environ.get("PID_DIR", "/home/mostafa/mediamtx/pids")

for job in jobs:
    event_id = job.get("eventId", "")
    source = job.get("sourceUrl", "")
    ingest = job.get("ingestUrl", "").rstrip("/")
    stream_name = job.get("streamName", "")
    if not event_id or not source or not ingest or not stream_name:
        continue
    pid_file = f"{pid_dir}/simulated-{event_id}.pid"
    if os.path.isfile(pid_file):
        try:
            with open(pid_file) as f:
                pid = int(f.read().strip())
            os.kill(pid, 0)
            continue
        except (OSError, ValueError):
            pass
    rtmp_url = f"{ingest}/{stream_name}"
    proc = subprocess.Popen([
        ffmpeg, "-re", "-stream_loop", "-1", "-i", source,
        "-c", "copy", "-f", "flv", rtmp_url,
    ])
    with open(pid_file, "w") as f:
        f.write(str(proc.pid))
' <<<"$JOBS_JSON"
