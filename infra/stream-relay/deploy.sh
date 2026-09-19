#!/usr/bin/env bash
# Copies the relay scripts from this repo onto the relay box.
#
# The hooks in this directory only run from ~/scripts on the relay host, so any
# change here is inert until this has been run. MediaMTX watches mediamtx.yml and
# reloads it in place, so the config is synced on every deploy without dropping
# a service that is already on air.
#
# Usage (from the repo root):
#   ./infra/stream-relay/deploy.sh
#   ./infra/stream-relay/deploy.sh --restart-ws-ingest
#   ./infra/stream-relay/deploy.sh --restart-auth-proxy   # pick up auth-proxy.py
#   ./infra/stream-relay/deploy.sh --install-recorder-cron  # once: the recording sweeper
#   ./infra/stream-relay/deploy.sh --bootstrap     # also re-run bootstrap.sh
#   RELAY_HOST=mostafa@stream.faithform.io ./infra/stream-relay/deploy.sh
#
# --with-config remains accepted as a backwards-compatible no-op. Bootstrap
# needs sudo and restarts MediaMTX, which drops anything currently publishing.

set -euo pipefail

RELAY_HOST="${RELAY_HOST:-faithform-relay}"
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BOOTSTRAP=0
RESTART_WS_INGEST=0
RESTART_AUTH_PROXY=0
INSTALL_RECORDER_CRON=0

for arg in "$@"; do
  case "$arg" in
    --with-config) ;;
    --bootstrap) BOOTSTRAP=1 ;;
    --restart-ws-ingest) RESTART_WS_INGEST=1 ;;
    --restart-auth-proxy) RESTART_AUTH_PROXY=1 ;;
    --install-recorder-cron) INSTALL_RECORDER_CRON=1 ;;
    *) echo "Unknown option: $arg" >&2; exit 1 ;;
  esac
done

echo "→ syncing scripts to ${RELAY_HOST}:~/scripts"
rsync -av "$SRC"/*.sh "$SRC"/*.py "${RELAY_HOST}:scripts/"
ssh "$RELAY_HOST" 'chmod +x ~/scripts/*.sh ~/scripts/*.py'

echo "→ syncing mediamtx.yml (MediaMTX reloads it in place)"
rsync -av "$SRC/mediamtx.yml" "${RELAY_HOST}:mediamtx/"
ssh "$RELAY_HOST" \
  'grep -Fq "~^live/([0-9a-fA-F-]{36})$:" ~/mediamtx/mediamtx.yml'

if [[ $RESTART_WS_INGEST -eq 1 ]]; then
  echo "→ restarting browser studio ingest"
  ssh "$RELAY_HOST" 'bash ~/scripts/start-ws-ingest.sh'
fi

if [[ $RESTART_AUTH_PROXY -eq 1 ]]; then
  echo "→ restarting the MediaMTX auth bridge (MediaMTX keeps running)"
  ssh "$RELAY_HOST" 'bash ~/scripts/restart-auth-proxy.sh'
fi

if [[ $INSTALL_RECORDER_CRON -eq 1 ]]; then
  # Resumes any recording whose uploader died (reboot, crash, app outage).
  echo "→ installing the recorder sweep (every minute)"
  ssh "$RELAY_HOST" '(crontab -l 2>/dev/null | grep -v faithform-recorder.py; echo "* * * * * set -a; . /etc/faithform-stream-relay.env; set +a; python3 \$HOME/scripts/faithform-recorder.py sweep >> \$HOME/mediamtx/logs/recorder.log 2>&1") | crontab -'
fi

if [[ $BOOTSTRAP -eq 1 ]]; then
  # Idempotent; also installs the /etc/gai.conf IPv4 precedence line that
  # rtmps destinations need on a host with IPv6.
  echo "→ re-running bootstrap.sh (needs your sudo password)"
  ssh -t "$RELAY_HOST" 'sudo bash ~/scripts/bootstrap.sh'
fi

if [[ $BOOTSTRAP -eq 1 ]]; then
  echo "→ restarting MediaMTX"
  ssh -t "$RELAY_HOST" '
    set -e
    sudo systemctl restart faithform-mediamtx
    systemctl --no-pager --lines=5 status faithform-mediamtx
  '
fi

echo
echo "Deployed. Watch the next broadcast with:"
echo "  ssh ${RELAY_HOST} 'tail -f ~/mediamtx/logs/stream_*.log'"
