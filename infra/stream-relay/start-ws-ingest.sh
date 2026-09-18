#!/usr/bin/env bash
set -euo pipefail

RELAY_HOME="${HOME:-/home/mostafa}"
ENV_FILE="${RELAY_HOME}/faithform-stream-relay.env"
if [[ ! -f "${ENV_FILE}" && -r /etc/faithform-stream-relay.env ]]; then
  ENV_FILE="/etc/faithform-stream-relay.env"
fi

if [[ ! -r "${ENV_FILE}" ]]; then
  echo "Relay environment file is not readable: ${ENV_FILE}" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "${ENV_FILE}"
set +a

export WS_INGEST_HOST=127.0.0.1
export WS_INGEST_PORT=8090
export FFMPEG_PATH="${RELAY_HOME}/bin/ffmpeg"

pkill -f "ws-ingest.py" 2>/dev/null || true
sleep 1

mkdir -p "${RELAY_HOME}/mediamtx/logs"
nohup python3 "${RELAY_HOME}/scripts/ws-ingest.py" \
  >> "${RELAY_HOME}/mediamtx/logs/ws-ingest.log" 2>&1 &
echo "ws-ingest started"
