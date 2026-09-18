#!/usr/bin/env bash
# Restarts only the MediaMTX auth bridge (auth-proxy.py), leaving MediaMTX — and
# anything publishing to it — running. For picking up a new auth-proxy.py.
#
# The bridge answers every MediaMTX auth question, so for the moment between
# stopping and starting it, new reads and publishes are refused. Run it when no
# service is on air.

set -euo pipefail

ENV_FILE="${HOME}/faithform-stream-relay.env"
if [[ ! -f "${ENV_FILE}" && -r /etc/faithform-stream-relay.env ]]; then
  ENV_FILE="/etc/faithform-stream-relay.env"
fi
LOG_FILE="${HOME}/mediamtx/logs/mediamtx.log"

if [[ -f "${ENV_FILE}" && -r "${ENV_FILE}" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "${ENV_FILE}"
  set +a
fi

: "${FAITHFORM_APP_URL:=https://faithform.io}"
: "${STREAM_RELAY_WEBHOOK_SECRET:?STREAM_RELAY_WEBHOOK_SECRET is required}"
export FAITHFORM_APP_URL STREAM_RELAY_WEBHOOK_SECRET

pkill -f "auth-proxy.py" 2>/dev/null || true
sleep 0.5
nohup python3 "${HOME}/scripts/auth-proxy.py" >>"${LOG_FILE}" 2>&1 &

# Up and answering before this returns, or the restart failed.
for _ in $(seq 1 20); do
  if curl -s -o /dev/null -m 1 -X POST http://127.0.0.1:8091/ 2>/dev/null; then
    echo "auth proxy restarted pid $(pgrep -f auth-proxy.py | head -1)"
    exit 0
  fi
  sleep 0.25
done
echo "auth proxy did not come back up" >&2
exit 1
