#!/usr/bin/env bash
# Notify FaithForm when ingest stops and clean up fan-out/recording.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
"${SCRIPT_DIR}/on-stream-stop.sh" || true

APP_URL="${FAITHFORM_APP_URL:-https://faithform.io}"
SECRET="${STREAM_RELAY_WEBHOOK_SECRET:-}"
PATH_VALUE="${MTX_PATH:-}"

if [[ -z "$SECRET" || -z "$PATH_VALUE" ]]; then
  exit 0
fi

curl -fsS -X POST \
  -H "Content-Type: application/json" \
  -H "x-stream-relay-secret: ${SECRET}" \
  "${APP_URL%/}/api/stream/lifecycle" \
  -d "{\"event\":\"unpublish\",\"path\":\"${PATH_VALUE}\"}" \
  >/dev/null || true
