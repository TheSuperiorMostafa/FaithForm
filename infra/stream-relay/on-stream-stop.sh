#!/usr/bin/env bash
# Stops ffmpeg fan-out, tells FaithForm the encoder stopped, and closes the recording.

set -euo pipefail

# ffprobe lives in ~/bin. Without this on PATH the duration probe below silently
# fell through to its `|| echo 0` fallback, so every recording was stored as 0s.
PATH="/home/mostafa/bin:/usr/local/bin:/usr/bin:/bin"
APP_URL="${FAITHFORM_APP_URL:-https://faithform.io}"
SECRET="${STREAM_RELAY_WEBHOOK_SECRET:-}"
RECORD_DIR="/home/mostafa/mediamtx/recordings"

if [[ -z "${MTX_PATH:-}" ]]; then
  echo "[relay] missing MTX_PATH"
  exit 1
fi

PATH_DIGEST="$(printf '%s' "$MTX_PATH" | sha256sum | cut -c1-16)"
SAFE_PATH="stream_${PATH_DIGEST}"
FANOUT_PID_FILE="/home/mostafa/mediamtx/pids/${SAFE_PATH}.fanout.pid"
LOG_FILE="/home/mostafa/mediamtx/logs/${SAFE_PATH}.log"

stop_pid() {
  local file="$1"
  if [[ -f "$file" ]]; then
    local pid
    pid=$(cat "$file")
    if kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
      echo "Stopped process ${pid}" >>"$LOG_FILE"
    fi
    rm -f "$file"
  fi
}

stop_pid "$FANOUT_PID_FILE"

# Clears the publishing flag the dashboard reads. Deliberately does not end the
# broadcast: YouTube's enableAutoStop is off precisely so a brief encoder gap
# cannot end a service, and this must behave the same way. Ending a service
# stays an operator action.
if [[ -n "${SECRET}" ]]; then
  curl -fsS --max-time 10 -X POST "${APP_URL%/}/api/stream/lifecycle" \
    -H "x-stream-relay-secret: ${SECRET}" \
    -H "content-type: application/json" \
    -d "{\"event\":\"unpublish\",\"path\":\"${MTX_PATH}\"}" \
    -o /dev/null 2>>"$LOG_FILE" || true
fi

# Recording (P15): ask the segmented recorder to close its last segment. It
# keeps running on its own until every segment is uploaded, and the relay's
# sweeper finishes the job if it cannot. Nothing is uploaded from here any more.
python3 /home/mostafa/scripts/faithform-recorder.py stop "$MTX_PATH" >>"$LOG_FILE" 2>&1 || true
