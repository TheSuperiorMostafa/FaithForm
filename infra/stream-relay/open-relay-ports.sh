#!/usr/bin/env bash
# Open HLS (8888) and SRT (8890) on the relay host firewall.
# Run on the server: sudo bash ~/scripts/open-relay-ports.sh

set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "Run with sudo: sudo bash open-relay-ports.sh"
  exit 1
fi

ufw allow 8888/tcp comment 'HLS playback'
ufw allow 8890/udp comment 'SRT ingest'
ufw status | grep -E '8888|8890|1935'

echo ""
echo "If port 8888 is still unreachable externally, also open TCP 8888"
echo "in your cloud provider firewall / security group for this VPS."
