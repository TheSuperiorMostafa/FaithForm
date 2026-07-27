#!/usr/bin/env bash
# Open every port the relay needs on the host firewall, and report what is
# actually reachable afterwards.
#
# Run on the server: sudo bash ~/scripts/open-relay-ports.sh
#
# Ports, and what breaks when each is closed (ports match mediamtx.yml):
#   1935/tcp  RTMP ingest        OBS / hardware encoders cannot publish
#   8888/tcp  HLS playback       viewers get "Connecting…" and a black screen
#                                (the app proxies playback through this port,
#                                 so it must be reachable from the app host)
#   8889/tcp  WebRTC/WHIP        browser "Go live" fails at SDP exchange
#   8189/udp  WebRTC media       WHIP negotiates, then ICE never connects
#   8890/udp  SRT ingest         SRT encoders cannot publish
#
# 8554 (RTSP) is deliberately NOT opened — nothing in the product consumes it
# from outside the host.

set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "Run with sudo: sudo bash open-relay-ports.sh"
  exit 1
fi

ufw allow 1935/tcp comment 'RTMP ingest'
ufw allow 8888/tcp comment 'HLS playback'
ufw allow 8889/tcp comment 'WebRTC/WHIP signaling'
ufw allow 8189/udp comment 'WebRTC media'
ufw allow 8890/udp comment 'SRT ingest'

echo ""
echo "== ufw rules =="
ufw status | grep -E '1935|8888|8889|8189|8890' || echo "(no matching rules — is ufw enabled?)"

echo ""
echo "== local listeners =="
ss -lnt 2>/dev/null | grep -E ':1935|:8888|:8889' || echo "(mediamtx not listening — check: systemctl status faithform-mediamtx)"

echo ""
echo "ufw is only the host firewall. If ports are still unreachable from"
echo "outside, the block is at the cloud provider: open TCP 1935/8888/8889"
echo "and UDP 8189/8890 in the Hetzner Cloud Firewall for this server."
echo ""
echo "Verify from a machine outside the host:"
echo "  curl -s -o /dev/null -w '%{http_code}\\n' --max-time 8 http://stream.faithform.io:8888/"
echo "  # 404 = reachable (MediaMTX has no root page). 000 = still blocked."
