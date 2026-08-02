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
# How often to tell FaithForm this path is still publishing. The app treats a
# heartbeat older than 90s as "not publishing", so this must stay well under it.
HEARTBEAT_SEC=30
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
LIFECYCLE_URL="${APP_URL%/}/api/stream/lifecycle"

DEST_PARSER='
import json, sys
try:
    data = json.loads(sys.stdin.read())
except Exception:
    sys.exit(1)
for item in data.get("destinations", []):
    url = str(item.get("url", "")).strip()
    if url:
        print(url)
'

DESTINATIONS=()

# Prints one URL per line. Returns non-zero when FaithForm could not be reached
# or answered with something unparseable — which is not the same as "this church
# has no destinations", and must not be treated as such.
read_destinations() {
  local payload
  payload="$(curl -fsSL --max-time 10 -H "x-stream-relay-secret: ${SECRET}" "$CONFIG_URL")" || return 1
  printf '%s' "$payload" | python3 -c "$DEST_PARSER"
}

load_destinations() {
  local raw line
  raw="$(read_destinations)" || return 1

  DESTINATIONS=()
  while IFS= read -r line; do
    [[ -n "$line" ]] && DESTINATIONS+=("$line")
  done <<<"$raw"
  return 0
}

destinations_key() {
  if [[ ${#DESTINATIONS[@]} -eq 0 ]]; then
    printf ''
    return 0
  fi
  printf '%s\n' "${DESTINATIONS[@]}"
}

# Lets FaithForm distinguish "an encoder is publishing right now" from a stale
# flag left behind by a relay that died. Best effort: the broadcast must not
# depend on the app being reachable.
notify_lifecycle() {
  curl -fsS --max-time 10 -X POST "$LIFECYCLE_URL" \
    -H "x-stream-relay-secret: ${SECRET}" \
    -H "content-type: application/json" \
    -d "{\"event\":\"$1\",\"path\":\"${MTX_PATH}\"}" \
    -o /dev/null 2>>"$LOG_FILE" || true
}

# ffmpeg 7.0.2 crashes connecting native RTMP over IPv6 — it dies before writing
# a single line, which is why a failing fan-out left an empty log and looked like
# a clean 5-second exit. YouTube and Facebook both publish AAAA records and glibc
# prefers them, so every push crashed on connect. Pinning plain RTMP to the
# host's A record avoids the broken path entirely; the platform is happy to be
# addressed by IP.
#
# rtmps is deliberately left alone: its TLS handshake must validate against the
# hostname, and an IP literal would fail that. Those destinations need the
# resolver fixed system-wide instead — `precedence ::ffff:0:0/96  100` in
# /etc/gai.conf — which is also the proper fix for all of this.
pin_ipv4() {
  python3 - "$1" <<'PY'
import socket, sys
from urllib.parse import urlsplit, urlunsplit

url = sys.argv[1]
parts = urlsplit(url)
if parts.scheme != "rtmp" or not parts.hostname:
    print(url)
    raise SystemExit

try:
    infos = socket.getaddrinfo(
        parts.hostname, parts.port or 1935, socket.AF_INET, socket.SOCK_STREAM
    )
except OSError:
    infos = []

if not infos:
    print(url)
    raise SystemExit

ip = infos[0][4][0]
netloc = f"{ip}:{parts.port}" if parts.port else ip
print(urlunsplit((parts.scheme, netloc, parts.path, parts.query, parts.fragment)))
PY
}

# Resolved fresh on every fan-out start, and never fed back into the
# change-detection key — these hosts are load balanced, so a rotating address
# would otherwise read as "destinations changed" and restart the push endlessly.
resolve_targets() {
  TARGETS=()
  local url pinned
  for url in "${DESTINATIONS[@]}"; do
    pinned="$(pin_ipv4 "$url" 2>/dev/null || printf '%s' "$url")"
    TARGETS+=("${pinned:-$url}")
  done
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

TARGETS=()
FANOUT_STARTED_AT=0
FANOUT_BACKOFF=0

start_fanout() {
  stop_fanout
  if [[ ${#DESTINATIONS[@]} -eq 0 ]]; then
    return 0
  fi

  resolve_targets

  echo "[relay] forwarding ${MTX_PATH} to ${#TARGETS[@]} destinations" >>"$LOG_FILE"

  if [[ ${#TARGETS[@]} -eq 1 ]]; then
    "$FFMPEG" -nostdin -loglevel warning \
      -rtsp_transport tcp -timeout 5000000 \
      -analyzeduration 10000000 -probesize 10000000 \
      -i "$RTSP_URL" \
      -map 0:v:0 -map 0:a:0\? \
      -c copy -f flv "${TARGETS[0]}" >>"$LOG_FILE" 2>&1 &
    echo $! >"$FANOUT_PID_FILE"
    FANOUT_STARTED_AT=$(date +%s)
    return 0
  fi

  local tee_spec=""
  for url in "${TARGETS[@]}"; do
    if [[ -n "$tee_spec" ]]; then
      tee_spec+="|"
    fi
    tee_spec+="[f=flv:onfail=ignore]${url}"
  done

  # Unlike every other muxer, tee refuses to infer its streams: without explicit
  # -map it reports "Output file does not contain any stream" and exits before
  # opening a single destination. That is why syndicating to one platform worked
  # and syndicating to two silently pushed nothing to either.
  "$FFMPEG" -nostdin -loglevel warning \
    -rtsp_transport tcp -timeout 5000000 \
    -analyzeduration 10000000 -probesize 10000000 \
    -i "$RTSP_URL" \
    -map 0:v:0 -map 0:a:0\? \
    -c copy -f tee "$tee_spec" >>"$LOG_FILE" 2>&1 &
  echo $! >"$FANOUT_PID_FILE"
  FANOUT_STARTED_AT=$(date +%s)
}

RECORD_FILE="${RECORD_DIR}/${SAFE_PATH}-$(date +%s).mp4"
echo "[relay] recording to ${RECORD_FILE}" >>"$LOG_FILE"
"$FFMPEG" -nostdin -loglevel warning \
  -rtsp_transport tcp -timeout 5000000 \
  -analyzeduration 10000000 -probesize 10000000 \
  -i "$RTSP_URL" \
  -map 0:v:0 -map 0:a:0\? \
  -c copy -f mp4 -movflags +faststart "$RECORD_FILE" >>"$LOG_FILE" 2>&1 &
echo $! >"$RECORD_PID_FILE"
echo "$RECORD_FILE" >"${RECORD_DIR}/${SAFE_PATH}.latest"

notify_lifecycle publish

CURRENT_KEY=""
if load_destinations; then
  CURRENT_KEY="$(destinations_key)"
  destinations_key >"$DEST_CACHE"
  start_fanout
else
  echo "[relay] could not read destinations at startup; will retry" >>"$LOG_FILE"
fi

LAST_HEARTBEAT=$(date +%s)

while true; do
  sleep "$POLL_SEC"
  NOW=$(date +%s)

  if (( NOW - LAST_HEARTBEAT >= HEARTBEAT_SEC )); then
    notify_lifecycle publish
    LAST_HEARTBEAT=$NOW
  fi

  # A failed fetch leaves the current fan-out exactly as it is. Tearing it down
  # on a transient 500 would drop the congregation's feed mid-service.
  if load_destinations; then
    NEW_KEY="$(destinations_key)"
    if [[ "$NEW_KEY" != "$CURRENT_KEY" ]]; then
      echo "[relay] destinations changed for ${MTX_PATH}" >>"$LOG_FILE"
      CURRENT_KEY="$NEW_KEY"
      destinations_key >"$DEST_CACHE"
      FANOUT_BACKOFF=0
      start_fanout
    fi
  fi

  if [[ -f "$FANOUT_PID_FILE" ]]; then
    pid=$(cat "$FANOUT_PID_FILE")
    if ! kill -0 "$pid" 2>/dev/null; then
      wait "$pid" 2>/dev/null || true
      rm -f "$FANOUT_PID_FILE"

      # A destination that rejects the stream outright makes ffmpeg exit within
      # a second or two. Restarting immediately spins a hot loop that floods the
      # log and hammers the platform; back off instead, up to half a minute.
      if (( NOW - FANOUT_STARTED_AT < 10 )); then
        FANOUT_BACKOFF=$(( FANOUT_BACKOFF == 0 ? 5 : FANOUT_BACKOFF * 2 ))
        (( FANOUT_BACKOFF > 30 )) && FANOUT_BACKOFF=30
        echo "[relay] fan-out exited after $(( NOW - FANOUT_STARTED_AT ))s; retrying in ${FANOUT_BACKOFF}s" >>"$LOG_FILE"
        sleep "$FANOUT_BACKOFF"
      else
        FANOUT_BACKOFF=0
      fi

      start_fanout
    fi
  fi
done
