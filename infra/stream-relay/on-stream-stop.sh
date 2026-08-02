#!/usr/bin/env bash
# Stops ffmpeg fan-out and recording; notifies FaithForm when a recording is ready.

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

SAFE_PATH="${MTX_PATH//\//_}"
FANOUT_PID_FILE="/home/mostafa/mediamtx/pids/${SAFE_PATH}.fanout.pid"
RECORD_PID_FILE="/home/mostafa/mediamtx/pids/${SAFE_PATH}.record.pid"
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
stop_pid "$RECORD_PID_FILE"

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

LATEST_FILE="${RECORD_DIR}/${SAFE_PATH}.latest"
if [[ -f "$LATEST_FILE" && -n "${SECRET}" ]]; then
  RECORD_FILE="$(cat "$LATEST_FILE")"
  rm -f "$LATEST_FILE"
  if [[ -f "$RECORD_FILE" ]]; then
  DURATION="$(ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "$RECORD_FILE" 2>/dev/null || echo 0)"
  DURATION="${DURATION:-0}"
  STORAGE_PATH="relay/${SAFE_PATH}/$(basename "$RECORD_FILE")"
  curl -fsS -X POST "${APP_URL%/}/api/stream/recording-complete" \
    -H "x-stream-relay-secret: ${SECRET}" \
    -H "content-type: application/json" \
    -d "{\"path\":\"${MTX_PATH}\",\"storagePath\":\"${STORAGE_PATH}\",\"durationSec\":${DURATION}}" \
    >>"$LOG_FILE" 2>&1 || true
  fi
fi
