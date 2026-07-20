#!/usr/bin/env bash
# Fetches destination RTMP URLs from FaithForm, forwards the live feed, and records locally.
# Polls for new destinations so Go Live works after the encoder preview has started.

set -euo pipefail

RELAY_HOME="${HOME:-/home/mostafa}"
PATH="${RELAY_HOME}/bin:/usr/local/bin:/usr/bin:/bin"
ENV_FILE="${RELAY_HOME}/faithform-stream-relay.env"
if [[ ! -f "${ENV_FILE}" && -r /etc/faithform-stream-relay.env ]]; then
  ENV_FILE="/etc/faithform-stream-relay.env"
fi
if [[ -f "${ENV_FILE}" && -r "${ENV_FILE}" ]]; then
  # shellcheck disable=SC1090
  set -a
  source "${ENV_FILE}"
  set +a
fi

FFMPEG="${RELAY_HOME}/bin/ffmpeg"
APP_URL="${FAITHFORM_APP_URL:-https://faithform.io}"
SECRET="${STREAM_RELAY_WEBHOOK_SECRET:-}"
RECORD_DIR="/home/mostafa/mediamtx/recordings"
POLL_SEC=5
RTMP_PORT="${RTMP_PORT:-1935}"
# Keep gaps short so a dead fanout recovers before viewers notice.
FANOUT_RESTART_SEC=3

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
SOURCE_URL="rtmp://127.0.0.1:${RTMP_PORT}/${MTX_PATH}"

# MediaMTX's HLS muxer rejects some otherwise-valid H.264 feeds that contain
# B-frame timestamp reordering. Re-encode the local RTSP feed into the public
# HLS origin so viewers always receive monotonic timestamps.
MTX_PATH="$MTX_PATH" "${RELAY_HOME}/scripts/start-hls-normalizer.sh" >>"$LOG_FILE" 2>&1 || true

CONFIG_URL="${APP_URL%/}/api/stream/relay-config?path=$(python3 -c 'import sys, urllib.parse; print(urllib.parse.quote(sys.argv[1], safe=""))' "$MTX_PATH")"

# Returns 0 and prints one URL per line on success. Returns 1 on HTTP/JSON
# failure so callers keep the last-known destinations instead of clearing
# fanout (which drops YouTube + forces HLS restart via runOnReadyRestart).
read_destination_urls() {
  local json
  if ! json=$(curl -fsSL --max-time 8 -H "x-stream-relay-secret: ${SECRET}" "$CONFIG_URL"); then
    return 1
  fi
  printf '%s' "$json" | python3 -c '
import json, sys
raw = sys.stdin.read().strip()
if not raw:
    sys.exit(1)
data = json.loads(raw)
for item in data.get("destinations", []):
    url = str(item.get("url", "")).strip()
    if url:
        print(url)
'
}

# Loads destination URLs into the nameref array. Propagates fetch failures
# (mapfile alone cannot see process-substitution exit codes).
load_destination_urls() {
  local -n _out=$1
  local raw status
  set +e
  raw=$(read_destination_urls)
  status=$?
  set -e
  _out=()
  if [[ $status -ne 0 ]]; then
    return 1
  fi
  if [[ -n "$raw" ]]; then
    while IFS= read -r line; do
      [[ -n "$line" ]] && _out+=("$line")
    done <<< "$raw"
  fi
  return 0
}

write_dest_cache() {
  local -n urls_ref=$1
  : >"$DEST_CACHE"
  if [[ ${#urls_ref[@]} -gt 0 ]]; then
    printf '%s\n' "${urls_ref[@]}" >"$DEST_CACHE"
  fi
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
      -fflags +genpts \
      -rw_timeout 15000000 \
      -i "$SOURCE_URL" \
      -c copy -f flv -flvflags no_duration_filesize \
      "${urls_ref[0]}" >>"$LOG_FILE" 2>&1 &
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
    -fflags +genpts \
    -rw_timeout 15000000 \
    -i "$SOURCE_URL" \
    -c copy -f tee "$tee_spec" >>"$LOG_FILE" 2>&1 &
  echo $! >"$FANOUT_PID_FILE"
}

RECORD_FILE="${RECORD_DIR}/${SAFE_PATH}-$(date +%s).mp4"
echo "[relay] recording to ${RECORD_FILE}" >>"$LOG_FILE"
"$FFMPEG" -nostdin -loglevel warning \
  -fflags +genpts \
  -rw_timeout 15000000 \
  -i "$SOURCE_URL" \
  -c copy -f mp4 -movflags +faststart "$RECORD_FILE" >>"$LOG_FILE" 2>&1 &
echo $! >"$RECORD_PID_FILE"
echo "$RECORD_FILE" >"${RECORD_DIR}/${SAFE_PATH}.latest"

URLS=()
if ! load_destination_urls URLS; then
  echo "[relay] initial destination fetch failed for ${MTX_PATH}; will retry" >>"$LOG_FILE"
  URLS=()
fi

write_dest_cache URLS
start_fanout URLS

while true; do
  sleep "$POLL_SEC"

  NEW_URLS=()
  if ! load_destination_urls NEW_URLS; then
    # Never treat a transport/API failure as "destinations cleared" — that
    # kills YouTube fanout and, if this script exits, MediaMTX restarts HLS too.
    echo "[relay] destination poll failed for ${MTX_PATH}; keeping current fanout" >>"$LOG_FILE"
    NEW_URLS=()
    if [[ -f "$DEST_CACHE" ]]; then
      mapfile -t NEW_URLS < "$DEST_CACHE" || true
    fi
  else
    OLD_URLS=()
    if [[ -f "$DEST_CACHE" ]]; then
      mapfile -t OLD_URLS < "$DEST_CACHE" || true
    fi
    if [[ "$(printf '%s\n' "${NEW_URLS[@]}")" != "$(printf '%s\n' "${OLD_URLS[@]}")" ]]; then
      echo "[relay] destinations changed for ${MTX_PATH}" >>"$LOG_FILE"
      write_dest_cache NEW_URLS
      start_fanout NEW_URLS
    fi
  fi

  if [[ -f "$FANOUT_PID_FILE" ]]; then
    pid=$(cat "$FANOUT_PID_FILE")
    if ! kill -0 "$pid" 2>/dev/null; then
      wait "$pid" 2>/dev/null || true
      rm -f "$FANOUT_PID_FILE"
      if [[ ${#NEW_URLS[@]} -gt 0 ]]; then
        echo "[relay] fanout exited; restarting in ${FANOUT_RESTART_SEC}s" >>"$LOG_FILE"
        sleep "$FANOUT_RESTART_SEC"
        start_fanout NEW_URLS
      fi
    fi
  elif [[ ${#NEW_URLS[@]} -gt 0 ]]; then
    # Destinations exist but fanout never started / was cleared — start it.
    start_fanout NEW_URLS
  fi
done
