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

PATH_DIGEST="$(printf '%s' "$MTX_PATH" | sha256sum | cut -c1-16)"
SAFE_PATH="stream_${PATH_DIGEST}"
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

# Uploads the finished recording, then tells FaithForm where it landed.
#
# The upload is the part that used to be missing entirely: the old version
# announced a storage path and stopped, so the Media page held a row with no
# file behind it and said "processing" for the rest of time. FaithForm hands
# back a short-lived signed URL and the bytes go straight to storage — this box
# never holds a Supabase key, and a multi-gigabyte service never has to squeeze
# through the app.
#
# The local file is deliberately kept. Disk is cheap next to a service nobody
# can watch back, and `upload_recording.sh` can replay it if this fails.
upload_recording() {
  local record_file="$1"
  local filename response upload_url storage_path

  filename="$(basename "$record_file")"

  response="$(curl -fsS --max-time 30 -X POST \
    "${APP_URL%/}/api/stream/recording-upload-url" \
    -H "x-stream-relay-secret: ${SECRET}" \
    -H "content-type: application/json" \
    -d "{\"path\":\"${MTX_PATH}\",\"filename\":\"${filename}\"}" 2>>"$LOG_FILE")" || {
    echo "[relay] could not get an upload URL for ${filename}" >>"$LOG_FILE"
    return 1
  }

  upload_url="$(printf '%s' "$response" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("uploadUrl",""))' 2>/dev/null)"
  storage_path="$(printf '%s' "$response" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("storagePath",""))' 2>/dev/null)"

  if [[ -z "$upload_url" || -z "$storage_path" ]]; then
    echo "[relay] upload URL response was unusable" >>"$LOG_FILE"
    return 1
  fi

  # -T streams from disk rather than buffering the whole file in memory.
  if ! curl -fsS --max-time 3600 -T "$record_file" "$upload_url" \
    -H "content-type: video/mp4" \
    -H "x-upsert: true" \
    -o /dev/null 2>>"$LOG_FILE"; then
    echo "[relay] upload failed for ${filename}" >>"$LOG_FILE"
    return 1
  fi

  printf '%s' "$storage_path"
}

LATEST_FILE="${RECORD_DIR}/${SAFE_PATH}.latest"
if [[ -f "$LATEST_FILE" && -n "${SECRET}" ]]; then
  RECORD_FILE="$(cat "$LATEST_FILE")"
  rm -f "$LATEST_FILE"
  if [[ -f "$RECORD_FILE" ]]; then
    DURATION="$(ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "$RECORD_FILE" 2>/dev/null || echo 0)"
    DURATION="${DURATION:-0}"

    if STORAGE_PATH="$(upload_recording "$RECORD_FILE")" && [[ -n "$STORAGE_PATH" ]]; then
      echo "[relay] uploaded completed recording" >>"$LOG_FILE"
      curl -fsS --max-time 30 -X POST "${APP_URL%/}/api/stream/recording-complete" \
        -H "x-stream-relay-secret: ${SECRET}" \
        -H "content-type: application/json" \
        -d "{\"path\":\"${MTX_PATH}\",\"storagePath\":\"${STORAGE_PATH}\",\"durationSec\":${DURATION}}" \
        >>"$LOG_FILE" 2>&1 || true
    else
      echo "[relay] recording kept locally; retry with upload-recording.sh" >>"$LOG_FILE"
    fi
  fi
fi
