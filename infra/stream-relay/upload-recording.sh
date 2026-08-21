#!/usr/bin/env bash
# Uploads a recording that is still sitting on this box into FaithForm.
#
# `on-stream-stop.sh` does this automatically at the end of a service. Run this
# by hand for anything recorded before that existed, or when an upload failed
# and the file was kept.
#
# Usage:
#   STREAM_RELAY_WEBHOOK_SECRET=… ./upload-recording.sh \
#     live/<churchId> /home/mostafa/mediamtx/recordings/<file>.mp4
#
# With no arguments it walks every recording it can match to a stream path from
# the file name, which is how the ones already on disk get backfilled.

set -euo pipefail

PATH="/home/mostafa/bin:/usr/local/bin:/usr/bin:/bin"
RECORD_DIR="${RECORD_DIR:-/home/mostafa/mediamtx/recordings}"

# Run by hand, so there is no systemd EnvironmentFile in scope the way there is
# for the MediaMTX hooks. Same lookup the cron scripts use.
ENV_FILE="${HOME}/faithform-stream-relay.env"
if [[ ! -r "$ENV_FILE" && -r /etc/faithform-stream-relay.env ]]; then
  ENV_FILE=/etc/faithform-stream-relay.env
fi
if [[ -r "$ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  set -a && source "$ENV_FILE" && set +a
fi

APP_URL="${FAITHFORM_APP_URL:-https://faithform.io}"
SECRET="${STREAM_RELAY_WEBHOOK_SECRET:-}"

if [[ -z "$SECRET" ]]; then
  echo "STREAM_RELAY_WEBHOOK_SECRET is not set (looked in $ENV_FILE)" >&2
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
  echo "→ uploading selected recording"

  response="$(curl -fsS --max-time 30 -X POST \
    "${APP_URL%/}/api/stream/recording-upload-url" \
    -H "x-stream-relay-secret: ${SECRET}" \
    -H "content-type: application/json" \
    -d "{\"path\":\"${mtx_path}\",\"filename\":\"${filename}\"}")"

  upload_url="$(printf '%s' "$response" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("uploadUrl",""))')"
  storage_path="$(printf '%s' "$response" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("storagePath",""))')"

  if [[ -z "$upload_url" || -z "$storage_path" ]]; then
    echo "  upload URL response was unusable" >&2
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
  echo "  upload complete"
}

if [[ $# -eq 2 ]]; then
  upload_one "$1" "$2"
  exit 0
fi

if [[ $# -ne 0 ]]; then
  echo "Usage: $0 [<mtxPath> <recordingFile>]" >&2
  exit 1
fi

# Automatic discovery is retained only for historical `live_...` files. Current
# capability-mode files use a one-way path digest and should normally upload in
# `on-stream-stop.sh`; pass the path and filename explicitly when retrying one.
shopt -s nullglob
for file in "$RECORD_DIR"/live_*.mp4; do
  base="$(basename "$file")"
  stem="$(printf '%s' "$base" | sed -E 's/-[0-9]+\.mp4$//')"
  if [[ "$stem" =~ ^live_([0-9a-fA-F-]{36})$ ]]; then
    mtx_path="live/${BASH_REMATCH[1]}"
  elif [[ "$stem" =~ ^live_([0-9a-fA-F-]{36})_([A-Za-z0-9_-]{16,})$ ]]; then
    mtx_path="live/${BASH_REMATCH[1]}/${BASH_REMATCH[2]}"
  else
    echo "skipping ${base} — cannot read a stream path from the name" >&2
    continue
  fi
  upload_one "$mtx_path" "$file" || echo "  failed: ${base}" >&2
done
