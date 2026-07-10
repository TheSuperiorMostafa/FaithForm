#!/usr/bin/env bash
# Fetches destination RTMP URLs from FaithForm, forwards the live feed, and records locally.
# Polls for new destinations so Go Live works after the encoder preview has started.

set -euo pipefail

PATH="/home/mostafa/bin:/usr/local/bin:/usr/bin:/bin"
FFMPEG="/home/mostafa/bin/ffmpeg"
APP_URL="${FAITHFORM_APP_URL:-https://faithform.io}"
SECRET="${STREAM_RELAY_WEBHOOK_SECRET:-}"
RECORD_DIR="/home/mostafa/mediamtx/recordings"
POLL_SEC=5
RTSP_PORT="${RTSP_PORT:-8554}"

if [[ -z "${MTX_PATH:-}" ]]; then
  echo "[relay] missing MTX_PATH"
  exit 1
fi

if [[ -z "$SECRET" ]]; then
  echo "[relay] STREAM_RELAY_WEBHOOK_SECRET is not set"
  exit 1
fi

mkdir -p "$RECORD_DIR" "/home/mostafa/mediamtx/pids" "/home/mostafa/mediamtx/logs"

SAFE_PATH="${MTX_PATH//\//_}"
RECORD_PID_FILE="/home/mostafa/mediamtx/pids/${SAFE_PATH}.record.pid"
FANOUT_PID_FILE="/home/mostafa/mediamtx/pids/${SAFE_PATH}.fanout.pid"
LOG_FILE="/home/mostafa/mediamtx/logs/${SAFE_PATH}.log"
DEST_CACHE="/home/mostafa/mediamtx/pids/${SAFE_PATH}.destinations"
RTSP_URL="rtsp://127.0.0.1:${RTSP_PORT}/${MTX_PATH}"

CONFIG_URL="${APP_URL%/}/api/stream/relay-config?path=$(python3 -c 'import sys, urllib.parse; print(urllib.parse.quote(sys.argv[1], safe=""))' "$MTX_PATH")"

fetch_destinations() {
  curl -fsSL -H "x-stream-relay-secret: ${SECRET}" "$CONFIG_URL"
}

stop_fanout() {
  if [[ -f "$FANOUT_PID_FILE" ]]; then
    pid=$(cat "$FANOUT_PID_FILE")
    if kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
    fi
    rm -f "$FANOUT_PID_FILE"
  fi
}

start_fanout() {
  local -n urls_ref=$1
  stop_fanout
  if [[ ${#urls_ref[@]} -eq 0 ]]; then
    return 0
  fi

  echo "[relay] forwarding ${MTX_PATH} to ${#urls_ref[@]} destinations" >>"$LOG_FILE"

  if [[ ${#urls_ref[@]} -eq 1 ]]; then
    "$FFMPEG" -nostdin -loglevel warning \
      -rtsp_transport tcp -rw_timeout 5000000 \
      -i "$RTSP_URL" \
      -c copy -f flv "${urls_ref[0]}" >>"$LOG_FILE" 2>&1 &
    echo $! >"$FANOUT_PID_FILE"
    return 0
  fi

  local tee_spec=""
  for url in "${urls_ref[@]}"; do
    if [[ -n "$tee_spec" ]]; then
      tee_spec+="|"
    fi
    tee_spec+="[f=flv:onfail=ignore]${url}"
  done

  "$FFMPEG" -nostdin -loglevel warning \
    -rtsp_transport tcp -rw_timeout 5000000 \
    -i "$RTSP_URL" \
    -c copy -f tee "$tee_spec" >>"$LOG_FILE" 2>&1 &
  echo $! >"$FANOUT_PID_FILE"
}

RECORD_FILE="${RECORD_DIR}/${SAFE_PATH}-$(date +%s).mp4"
echo "[relay] recording to ${RECORD_FILE}" >>"$LOG_FILE"
"$FFMPEG" -nostdin -loglevel warning \
  -rtsp_transport tcp -rw_timeout 5000000 \
  -i "$RTSP_URL" \
  -c copy -f mp4 -movflags +faststart "$RECORD_FILE" >>"$LOG_FILE" 2>&1 &
echo $! >"$RECORD_PID_FILE"
echo "$RECORD_FILE" >"${RECORD_DIR}/${SAFE_PATH}.latest"

mapfile -t URLS < <(fetch_destinations | python3 -c '
import json, sys
data = json.loads(sys.stdin.read())
for item in data.get("destinations", []):
    url = str(item.get("url", "")).strip()
    if url:
        print(url)
')

printf '%s\n' "${URLS[@]}" >"$DEST_CACHE"
start_fanout URLS

while true; do
  sleep "$POLL_SEC"
  mapfile -t NEW_URLS < <(fetch_destinations | python3 -c '
import json, sys
data = json.loads(sys.stdin.read())
for item in data.get("destinations", []):
    url = str(item.get("url", "")).strip()
    if url:
        print(url)
')
  mapfile -t OLD_URLS < "$DEST_CACHE"
  if [[ "$(printf '%s\n' "${NEW_URLS[@]}")" != "$(printf '%s\n' "${OLD_URLS[@]}")" ]]; then
    echo "[relay] destinations changed for ${MTX_PATH}" >>"$LOG_FILE"
    printf '%s\n' "${NEW_URLS[@]}" >"$DEST_CACHE"
    start_fanout NEW_URLS
  fi

  if [[ -f "$FANOUT_PID_FILE" ]]; then
    pid=$(cat "$FANOUT_PID_FILE")
    if ! kill -0 "$pid" 2>/dev/null; then
      wait "$pid" 2>/dev/null || true
      rm -f "$FANOUT_PID_FILE"
      if [[ ${#NEW_URLS[@]} -gt 0 ]]; then
        start_fanout NEW_URLS
      fi
    fi
  fi
done
