#!/usr/bin/env bash
# Uploads a recording that is still sitting on this box into FaithForm.
#
# `on-stream-stop.sh` does this automatically at the end of a service. Run this
# by hand for anything recorded before that existed, or when an upload failed
# and the file was kept.
#
# Usage:
#   STREAM_RELAY_WEBHOOK_SECRET=… ./upload-recording.sh \
#     live/<churchId>/<publishKey> /home/mostafa/mediamtx/recordings/<file>.mp4
#
# With no arguments it walks every recording it can match to a stream path from
# the file name, which is how the ones already on disk get backfilled.

set -euo pipefail

PATH="/home/mostafa/bin:/usr/local/bin:/usr/bin:/bin"
APP_URL="${FAITHFORM_APP_URL:-https://faithform.io}"
SECRET="${STREAM_RELAY_WEBHOOK_SECRET:-}"
RECORD_DIR="${RECORD_DIR:-/home/mostafa/mediamtx/recordings}"

if [[ -z "$SECRET" ]]; then
  echo "STREAM_RELAY_WEBHOOK_SECRET is not set" >&2
  exit 1
fi

upload_one() {
  local mtx_path="$1" record_file="$2"
  local filename response upload_url storage_path duration

  if [[ ! -f "$record_file" ]]; then
    echo "no such file: $record_file" >&2
    return 1
  fi

  filename="$(basename "$record_file")"
  echo "→ ${filename} (${mtx_path})"

  response="$(curl -fsS --max-time 30 -X POST \
    "${APP_URL%/}/api/stream/recording-upload-url" \
    -H "x-stream-relay-secret: ${SECRET}" \
    -H "content-type: application/json" \
    -d "{\"path\":\"${mtx_path}\",\"filename\":\"${filename}\"}")"

  upload_url="$(printf '%s' "$response" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("uploadUrl",""))')"
  storage_path="$(printf '%s' "$response" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("storagePath",""))')"

  if [[ -z "$upload_url" || -z "$storage_path" ]]; then
    echo "  unusable response: $response" >&2
    return 1
  fi

  curl -fsS --max-time 3600 -T "$record_file" "$upload_url" \
    -H "content-type: video/mp4" \
    -H "x-upsert: true" \
    -o /dev/null

  duration="$(ffprobe -v error -show_entries format=duration \
    -of default=noprint_wrappers=1:nokey=1 "$record_file" 2>/dev/null || echo 0)"
  duration="${duration:-0}"

  curl -fsS --max-time 30 -X POST "${APP_URL%/}/api/stream/recording-complete" \
    -H "x-stream-relay-secret: ${SECRET}" \
    -H "content-type: application/json" \
    -d "{\"path\":\"${mtx_path}\",\"storagePath\":\"${storage_path}\",\"durationSec\":${duration}}"
  echo
  echo "  uploaded to ${storage_path}"
}

if [[ $# -eq 2 ]]; then
  upload_one "$1" "$2"
  exit 0
fi

if [[ $# -ne 0 ]]; then
  echo "Usage: $0 [<mtxPath> <recordingFile>]" >&2
  exit 1
fi

# `on-stream-ready.sh` names files `live_{churchId}_{publishKey}-{epoch}.mp4`.
# Only those two structural underscores become slashes — a publish key is
# base64url and may contain underscores of its own, so a blanket substitution
# would mangle it.
shopt -s nullglob
for file in "$RECORD_DIR"/live_*.mp4; do
  base="$(basename "$file")"
  stem="$(printf '%s' "$base" | sed -E 's/-[0-9]+\.mp4$//')"
  mtx_path="$(printf '%s' "$stem" | sed -E 's#^live_([0-9a-fA-F-]{36})_#live/\1/#')"
  if [[ ! "$mtx_path" =~ ^live/[0-9a-fA-F-]{36}/[A-Za-z0-9_-]{16,}$ ]]; then
    echo "skipping ${base} — cannot read a stream path from the name" >&2
    continue
  fi
  upload_one "$mtx_path" "$file" || echo "  failed: ${base}" >&2
done
