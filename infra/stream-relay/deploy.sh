#!/usr/bin/env bash
# Copies the relay scripts and MediaMTX config from this repo onto the relay box
# and restarts the service.
#
# The hooks in this directory only run from ~/scripts on the relay host, so any
# change here is inert until this has been run.
#
# Usage (from the repo root):
#   ./infra/stream-relay/deploy.sh
#   RELAY_HOST=mostafa@stream.faithform.io ./infra/stream-relay/deploy.sh

set -euo pipefail

RELAY_HOST="${RELAY_HOST:-mostafa@stream.faithform.io}"
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REMOTE_SCRIPTS="~/scripts"
REMOTE_MEDIAMTX="~/mediamtx"

echo "→ syncing scripts to ${RELAY_HOST}:${REMOTE_SCRIPTS}"
rsync -av \
  "$SRC"/*.sh \
  "$SRC"/ws-ingest.py \
  "${RELAY_HOST}:${REMOTE_SCRIPTS}/"

echo "→ syncing mediamtx.yml to ${RELAY_HOST}:${REMOTE_MEDIAMTX}"
rsync -av "$SRC/mediamtx.yml" "${RELAY_HOST}:${REMOTE_MEDIAMTX}/"

echo "→ making scripts executable and restarting MediaMTX"
# bootstrap.sh is re-run because it owns the /etc/gai.conf IPv4 precedence line
# that rtmps destinations (Facebook) depend on. It is idempotent.
ssh -t "$RELAY_HOST" '
  chmod +x ~/scripts/*.sh
  sudo bash ~/scripts/bootstrap.sh
  sudo systemctl restart faithform-mediamtx
  systemctl --no-pager --lines=5 status faithform-mediamtx
'

echo
echo "Deployed. Watch a broadcast with:"
echo "  ssh ${RELAY_HOST} 'tail -f ~/mediamtx/logs/*.log'"
