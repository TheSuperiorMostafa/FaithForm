#!/usr/bin/env bash
# Copies the relay scripts from this repo onto the relay box.
#
# The hooks in this directory only run from ~/scripts on the relay host, so any
# change here is inert until this has been run. MediaMTX invokes them afresh for
# each stream, so a plain sync needs no restart and cannot interrupt a service
# that is on air.
#
# Usage (from the repo root):
#   ./infra/stream-relay/deploy.sh
#   ./infra/stream-relay/deploy.sh --with-config   # also mediamtx.yml + restart
#   ./infra/stream-relay/deploy.sh --bootstrap     # also re-run bootstrap.sh
#   RELAY_HOST=mostafa@stream.faithform.io ./infra/stream-relay/deploy.sh
#
# --with-config and --bootstrap both need sudo on the box and both restart
# MediaMTX, which drops anything currently publishing. Plain sync does not.

set -euo pipefail

RELAY_HOST="${RELAY_HOST:-faithform-relay}"
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WITH_CONFIG=0
BOOTSTRAP=0

for arg in "$@"; do
  case "$arg" in
    --with-config) WITH_CONFIG=1 ;;
    --bootstrap) BOOTSTRAP=1 ;;
    *) echo "Unknown option: $arg" >&2; exit 1 ;;
  esac
done

echo "→ syncing scripts to ${RELAY_HOST}:~/scripts"
rsync -av "$SRC"/*.sh "$SRC"/*.py "${RELAY_HOST}:scripts/"
ssh "$RELAY_HOST" 'chmod +x ~/scripts/*.sh ~/scripts/*.py'

if [[ $WITH_CONFIG -eq 1 ]]; then
  echo "→ syncing mediamtx.yml"
  rsync -av "$SRC/mediamtx.yml" "${RELAY_HOST}:mediamtx/"
fi

if [[ $BOOTSTRAP -eq 1 ]]; then
  # Idempotent; also installs the /etc/gai.conf IPv4 precedence line that
  # rtmps destinations need on a host with IPv6.
  echo "→ re-running bootstrap.sh (needs your sudo password)"
  ssh -t "$RELAY_HOST" 'sudo bash ~/scripts/bootstrap.sh'
fi

if [[ $WITH_CONFIG -eq 1 || $BOOTSTRAP -eq 1 ]]; then
  echo "→ restarting MediaMTX"
  ssh -t "$RELAY_HOST" '
    sudo systemctl restart faithform-mediamtx
    systemctl --no-pager --lines=5 status faithform-mediamtx
  '
fi

echo
echo "Deployed. Watch the next broadcast with:"
echo "  ssh ${RELAY_HOST} 'tail -f ~/mediamtx/logs/stream_*.log'"
