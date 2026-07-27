#!/usr/bin/env bash
# Set up a named Cloudflare tunnel for FaithForm stream relay (HLS + browser ingest).
# Requires: cloudflared logged in on this host for the Cloudflare account that owns faithform.io
#   Run once: cloudflared tunnel login
# Then: sudo bash ~/scripts/setup-named-tunnel.sh

set -euo pipefail

# This script must run under sudo to install the systemd unit, but everything it
# needs — the cloudflared binary, cert.pem, tunnel credentials — belongs to the
# invoking user. Under sudo $HOME is /root, so resolve the real home from
# SUDO_USER; otherwise it looks for /root/bin/cloudflared and aborts immediately.
RELAY_HOME=""
if [[ -n "${SUDO_USER:-}" ]]; then
  RELAY_HOME="$(getent passwd "${SUDO_USER}" | cut -d: -f6 || true)"
fi
RELAY_HOME="${RELAY_HOME:-${HOME:-/home/mostafa}}"

BIN_DIR="${RELAY_HOME}/bin"
CLOUDFLARED="${BIN_DIR}/cloudflared"
CF_DIR="${RELAY_HOME}/.cloudflared"
TUNNEL_NAME="faithform-stream"
LOG_DIR="${RELAY_HOME}/mediamtx/logs"

# Fixing the shell variables above is not enough: cloudflared expands ~ from its
# own environment, so under sudo it still searches /root for cert.pem. Point it
# at the real paths explicitly.
export HOME="${RELAY_HOME}"
export TUNNEL_ORIGIN_CERT="${CF_DIR}/cert.pem"

if [[ ! -x "${CLOUDFLARED}" ]]; then
  echo "Install cloudflared at ${CLOUDFLARED} first."
  exit 1
fi

if [[ ! -f "${CF_DIR}/cert.pem" ]]; then
  echo "Missing ${CF_DIR}/cert.pem"
  echo "Run: ${CLOUDFLARED} tunnel login"
  echo "Log into the Cloudflare account that owns faithform.io, then re-run this script."
  exit 1
fi

mkdir -p "${CF_DIR}" "${LOG_DIR}"

if ! "${CLOUDFLARED}" tunnel list 2>/dev/null | grep -q "${TUNNEL_NAME}"; then
  echo "[tunnel] creating ${TUNNEL_NAME}..."
  "${CLOUDFLARED}" tunnel create "${TUNNEL_NAME}"
fi

TUNNEL_ID="$("${CLOUDFLARED}" tunnel list 2>/dev/null | awk -v n="${TUNNEL_NAME}" '$0 ~ n {print $1; exit}')"
if [[ -z "${TUNNEL_ID}" ]]; then
  echo "Could not resolve tunnel ID for ${TUNNEL_NAME}"
  exit 1
fi

CREDS="${CF_DIR}/${TUNNEL_ID}.json"
if [[ ! -f "${CREDS}" ]]; then
  echo "Missing tunnel credentials at ${CREDS}"
  exit 1
fi

cat > "${CF_DIR}/config.yml" <<EOF
tunnel: ${TUNNEL_ID}
credentials-file: ${CREDS}

ingress:
  - hostname: hls.faithform.io
    service: http://127.0.0.1:8888
  - hostname: ingest.faithform.io
    service: http://127.0.0.1:8090
  - service: http_status:404
EOF

# Anything created above was created by root, but the systemd unit below runs
# the tunnel as the invoking user. Without this the service starts and then dies
# unable to read its own credentials file.
if [[ -n "${SUDO_USER:-}" ]]; then
  chown -R "${SUDO_USER}:$(id -gn "${SUDO_USER}")" "${CF_DIR}"
fi

echo "[tunnel] routing DNS..."
"${CLOUDFLARED}" tunnel route dns "${TUNNEL_NAME}" hls.faithform.io 2>/dev/null || \
  "${CLOUDFLARED}" tunnel route dns "${TUNNEL_ID}" hls.faithform.io
"${CLOUDFLARED}" tunnel route dns "${TUNNEL_NAME}" ingest.faithform.io 2>/dev/null || \
  "${CLOUDFLARED}" tunnel route dns "${TUNNEL_ID}" ingest.faithform.io

# Stop ephemeral quick tunnels
pkill -f "cloudflared tunnel --url http://127.0.0.1:8888" 2>/dev/null || true
pkill -f "cloudflared tunnel --url http://127.0.0.1:8090" 2>/dev/null || true
pkill -f "cloudflared tunnel --url http://127.0.0.1:8889" 2>/dev/null || true

if [[ $EUID -eq 0 ]]; then
  cat > /etc/systemd/system/cloudflared-faithform.service <<EOF
[Unit]
Description=Cloudflare named tunnel for FaithForm stream relay
After=network-online.target faithform-mediamtx.service
Wants=network-online.target

[Service]
Type=simple
User=${SUDO_USER:-mostafa}
Group=${SUDO_USER:-mostafa}
ExecStart=${CLOUDFLARED} tunnel --config ${CF_DIR}/config.yml run ${TUNNEL_NAME}
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload
  systemctl enable cloudflared-faithform
  systemctl restart cloudflared-faithform
  sleep 3
  systemctl --no-pager status cloudflared-faithform || true
else
  pkill -f "cloudflared tunnel --config ${CF_DIR}/config.yml run" 2>/dev/null || true
  nohup "${CLOUDFLARED}" tunnel --config "${CF_DIR}/config.yml" run "${TUNNEL_NAME}" \
    >>"${LOG_DIR}/cloudflared-named.log" 2>&1 &
  echo "[tunnel] started in background (run with sudo for systemd persistence)"
fi

cat > "${LOG_DIR}/tunnel-urls.env" <<EOF
# Named Cloudflare tunnel — stable URLs
STREAM_HLS_UPSTREAM_URL=https://hls.faithform.io
STREAM_WS_INGEST_UPSTREAM_URL=wss://ingest.faithform.io
STREAM_HTTP_INGEST_UPSTREAM_URL=https://ingest.faithform.io
STREAM_WHIP_UPSTREAM_URL=https://hls.faithform.io
NEXT_PUBLIC_STREAM_HLS_BASE_URL=https://hls.faithform.io
EOF

echo ""
echo "[tunnel] Done. Stable URLs:"
cat "${LOG_DIR}/tunnel-urls.env"
echo ""
echo "Update Vercel production env with the values above."
