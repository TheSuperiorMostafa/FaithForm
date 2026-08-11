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
SYNDICATION_URL="${APP_URL%/}/api/stream/syndication/report"

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

# ffmpeg 7.0.2 crashes connecting to RTMP over IPv6, dying before it writes a
# single log line. This relay has no IPv6 connectivity, so glibc already returns
# IPv4 first and the bug cannot bite here — but pinning plain rtmp:// to an A
# record costs nothing and keeps that true if the host ever gains an IPv6 route.
#
# rtmps is left alone: its TLS handshake must validate against the hostname, and
# an IP literal fails that. On a host that does have IPv6, the fix for those is
# `precedence ::ffff:0:0/96  100` in /etc/gai.conf, which bootstrap.sh installs;
# `warn_ipv6_precedence` only complains on such a host.
pin_ipv4() {
  python3 - "$1" <<'PYPIN'
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
PYPIN
}

warn_ipv6_precedence() {
  # Only meaningful where IPv6 is actually routable. Warning on a v4-only host
  # would be noise pointing at the wrong thing.
  ip -6 route show default 2>/dev/null | grep -q . || return 0
  if ! grep -qE '^[[:space:]]*precedence[[:space:]]+::ffff:0:0/96[[:space:]]+100' /etc/gai.conf 2>/dev/null; then
    echo "[relay] WARNING: this host has IPv6 but /etc/gai.conf has no IPv4 precedence line, so rtmps destinations (Facebook) may fail to connect. Run: sudo bash ~/scripts/bootstrap.sh" >>"$LOG_FILE"
  fi
}

# Name a destination from its URL, so the log and the dashboard can say which
# platform is in trouble instead of quoting an RTMP address at the operator.
platform_for_url() {
  case "$1" in
    *youtube*) printf 'youtube' ;;
    *facebook*|*fbcdn*) printf 'facebook' ;;
    *) printf 'other' ;;
  esac
}

# Best effort: the broadcast must never depend on the app being reachable.
report_syndication() {
  local platform="$1" status="$2" message="$3"
  [[ "$platform" == "other" ]] && return 0
  python3 - "$SYNDICATION_URL" "$SECRET" "$MTX_PATH" "$platform" "$status" "$message" <<'PYREPORT' >>"$LOG_FILE" 2>&1 || true
import json, sys, urllib.request

url, secret, path, platform, status, message = sys.argv[1:7]
body = json.dumps({
    "path": path,
    "platform": platform,
    "status": status,
    "error": message or None,
}).encode()
req = urllib.request.Request(url, data=body, method="POST")
req.add_header("content-type", "application/json")
req.add_header("x-stream-relay-secret", secret)
try:
    urllib.request.urlopen(req, timeout=10).read()
except Exception as err:
    print(f"[relay] syndication report failed: {err}")
PYREPORT
}

# One ffmpeg per destination.
#
# `tee` was the whole problem. The relay logs show single-destination pushes
# running for the length of a service, and every two-destination push dying
# silently after exactly five seconds — no ffmpeg diagnostic at all, just the
# supervisor noticing it was gone, then the same again on every retry. Five
# seconds is `-timeout 5000000` on the RTSP input: while tee is still opening
# its second slave nothing drains the input, so the demuxer times out and takes
# the process with it. Neither platform ever received video.
#
# Separate single-destination processes are the configuration already proven to
# work here, and they fail independently — one platform refusing the stream can
# no longer end the other. The input timeout is also raised well clear of a slow
# TLS handshake.
declare -A PUSH_PID=()
declare -A PUSH_STARTED_AT=()
declare -A PUSH_BACKOFF=()
declare -A PUSH_RETRY_AT=()
# Reported "actually pushing" once, after the connection has held long enough
# to mean something. Reset on every restart so a flapping push says so.
declare -A PUSH_CONFIRMED=()
CONFIRM_AFTER_SEC=20
# Generous enough that a slow RTMPS handshake cannot look like a dead input.
PUSH_INPUT_TIMEOUT_US=20000000

stop_fanout() {
  local url pid
  for url in "${!PUSH_PID[@]}"; do
    pid="${PUSH_PID[$url]}"
    if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
    fi
  done
  PUSH_PID=()
  PUSH_STARTED_AT=()
  PUSH_BACKOFF=()
  PUSH_RETRY_AT=()
  PUSH_CONFIRMED=()
  rm -f "$FANOUT_PID_FILE"
}

# The address is resolved fresh on every (re)start and never fed into the
# change-detection key — these hosts are load balanced, so a rotating address
# would otherwise read as "destinations changed" and restart the push forever.
start_push() {
  local url="$1" target platform
  target="$(pin_ipv4 "$url" 2>/dev/null || printf '%s' "$url")"
  target="${target:-$url}"
  platform="$(platform_for_url "$url")"

  "$FFMPEG" -nostdin -loglevel warning \
    -rtsp_transport tcp -timeout "$PUSH_INPUT_TIMEOUT_US" \
    -analyzeduration 10000000 -probesize 10000000 \
    -i "$RTSP_URL" \
    -map 0:v:0 -map 0:a:0\? \
    -c copy -f flv "$target" >>"$LOG_FILE" 2>&1 &

  PUSH_PID["$url"]=$!
  PUSH_STARTED_AT["$url"]=$(date +%s)
  PUSH_RETRY_AT["$url"]=0
  PUSH_CONFIRMED["$url"]=0
  echo "[relay] pushing ${MTX_PATH} to ${platform}" >>"$LOG_FILE"
}

start_fanout() {
  stop_fanout
  [[ ${#DESTINATIONS[@]} -eq 0 ]] && return 0

  warn_ipv6_precedence
  echo "[relay] forwarding ${MTX_PATH} to ${#DESTINATIONS[@]} destinations" >>"$LOG_FILE"

  local url
  for url in "${DESTINATIONS[@]}"; do
    PUSH_BACKOFF["$url"]=0
    start_push "$url"
    report_syndication "$(platform_for_url "$url")" pending ""
  done

  printf '%s\n' "${PUSH_PID[@]}" >"$FANOUT_PID_FILE"
}

# Restarts any push whose ffmpeg has exited, one destination at a time.
supervise_pushes() {
  local now url pid platform ran backoff
  now=$(date +%s)

  for url in "${!PUSH_PID[@]}"; do
    pid="${PUSH_PID[$url]}"
    platform="$(platform_for_url "$url")"

    if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
      # Still running. Once it has held the connection past the point where a
      # rejection would have shown up, say so — that is the only signal the
      # dashboard has that video is genuinely reaching the platform.
      if (( ${PUSH_CONFIRMED[$url]:-0} == 0 )) \
        && (( now - ${PUSH_STARTED_AT[$url]:-$now} >= CONFIRM_AFTER_SEC )); then
        PUSH_CONFIRMED["$url"]=1
        report_syndication "$platform" success ""
      fi
      continue
    fi

    if [[ -n "$pid" ]]; then
      wait "$pid" 2>/dev/null || true
      ran=$(( now - ${PUSH_STARTED_AT[$url]:-$now} ))
      PUSH_PID["$url"]=""

      # A destination that rejects the stream outright makes ffmpeg exit within
      # a second or two. Restarting immediately spins a hot loop that floods the
      # log and hammers the platform; back off instead, up to half a minute.
      if (( ran < 10 )); then
        backoff="${PUSH_BACKOFF[$url]:-0}"
        backoff=$(( backoff == 0 ? 5 : backoff * 2 ))
        (( backoff > 30 )) && backoff=30
        PUSH_BACKOFF["$url"]=$backoff
        PUSH_RETRY_AT["$url"]=$(( now + backoff ))
        echo "[relay] ${platform} push exited after ${ran}s; retrying in ${backoff}s" >>"$LOG_FILE"
        report_syndication "$platform" failed \
          "The relay could not hold a connection to ${platform} open — it dropped after ${ran}s. Retrying."
        continue
      fi

      PUSH_BACKOFF["$url"]=0
      PUSH_RETRY_AT["$url"]=0
      echo "[relay] ${platform} push ended after ${ran}s; reconnecting" >>"$LOG_FILE"
    fi

    if (( now >= ${PUSH_RETRY_AT[$url]:-0} )); then
      start_push "$url"
      report_syndication "$platform" pending ""
    fi
  done
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
      start_fanout
    fi
  fi

  supervise_pushes
done
