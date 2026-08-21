#!/usr/bin/env bash
# Start MediaMTX with FaithForm publish auth (run as mostafa).
# Used by @reboot cron when systemd restart is unavailable.

set -euo pipefail

BIN_DIR="${HOME}/bin"
MEDIAMTX_DIR="${HOME}/mediamtx"
ENV_FILE="${HOME}/faithform-stream-relay.env"
if [[ ! -f "${ENV_FILE}" && -r /etc/faithform-stream-relay.env ]]; then
  ENV_FILE="/etc/faithform-stream-relay.env"
fi
LOG_FILE="${MEDIAMTX_DIR}/logs/mediamtx.log"

mkdir -p "${MEDIAMTX_DIR}/logs" "${MEDIAMTX_DIR}/pids" "${MEDIAMTX_DIR}/recordings"

if [[ -f "${ENV_FILE}" && -r "${ENV_FILE}" ]]; then
  # shellcheck disable=SC1090
  set -a
  source "${ENV_FILE}"
  set +a
fi

: "${FAITHFORM_APP_URL:=https://faithform.io}"
: "${STREAM_RELAY_WEBHOOK_SECRET:?STREAM_RELAY_WEBHOOK_SECRET is required}"

export MTX_AUTHMETHOD=http
export MTX_AUTHHTTPADDRESS="http://127.0.0.1:8091/auth"

pkill -f "auth-proxy.py" 2>/dev/null || true
nohup python3 "${HOME}/scripts/auth-proxy.py" >>"${LOG_FILE}" 2>&1 &

pkill -x mediamtx 2>/dev/null || true
sleep 1

nohup "${BIN_DIR}/mediamtx" "${MEDIAMTX_DIR}/mediamtx.yml" >>"${LOG_FILE}" 2>&1 &
echo "mediamtx started pid $!"
