#!/usr/bin/env bash
# Drives FaithForm's scheduled stream starts and syndication retries.
#
# Vercel Hobby only permits daily crons, so this runs from the relay instead.
# /api/stream/scheduled-start does both jobs in one call — it starts any service
# whose scheduled time has arrived, and re-attempts syndication for services
# whose YouTube or Facebook provisioning failed and are still inside their retry
# window. Install with:
#
#   */2 * * * * /home/mostafa/scripts/poll-stream-cron.sh >> /home/mostafa/mediamtx/logs/stream-cron.log 2>&1

set -euo pipefail

ENV_FILE="${HOME}/faithform-stream-relay.env"
if [[ ! -r "${ENV_FILE}" && -r /etc/faithform-stream-relay.env ]]; then
  ENV_FILE=/etc/faithform-stream-relay.env
fi

if [[ -r "${ENV_FILE}" ]]; then
  # shellcheck disable=SC1090
  set -a
  source "${ENV_FILE}"
  set +a
fi

APP_URL="${FAITHFORM_APP_URL:-https://faithform.io}"
SECRET="${STREAM_CRON_SECRET:-${CRON_SECRET:-}}"

if [[ -z "${SECRET}" ]]; then
  echo "[$(date -u +%FT%TZ)] STREAM_CRON_SECRET is not set in ${ENV_FILE}"
  exit 1
fi

# Sent as a bearer token rather than a query parameter so the secret stays out
# of access logs and any redirect chain.
RESPONSE="$(curl -sS --max-time 25 -w '\n%{http_code}' \
  -H "authorization: Bearer ${SECRET}" \
  "${APP_URL%/}/api/stream/scheduled-start" 2>&1 || true)"

STATUS="$(printf '%s' "$RESPONSE" | tail -1)"
BODY="$(printf '%s' "$RESPONSE" | sed '$d')"

# Only worth a log line when something happened or something broke — this runs
# every two minutes and a quiet Tuesday would otherwise bury the entries that
# matter.
if [[ "$STATUS" != "200" ]]; then
  echo "[$(date -u +%FT%TZ)] HTTP ${STATUS}: ${BODY}"
  exit 1
fi

printf '%s' "$BODY" | python3 -c '
import json, sys, datetime
try:
    d = json.loads(sys.stdin.read())
except Exception:
    sys.exit(0)
s = d.get("scheduled") or {}
y = d.get("syndication") or {}
started = s.get("started", 0)
simulated = s.get("simulated", 0)
retried = y.get("retried", 0)
if started or simulated or retried:
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    print("[%s] started=%s simulated=%s retried=%s" % (stamp, started, simulated, retried))
'
