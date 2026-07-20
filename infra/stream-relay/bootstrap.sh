#!/usr/bin/env bash
# One-time server bootstrap for stream.faithform.io
# Run on the server as: sudo bash bootstrap.sh

set -euo pipefail

USER_NAME="${SUDO_USER:-mostafa}"
HOME_DIR="/home/${USER_NAME}"
BIN_DIR="${HOME_DIR}/bin"
MEDIAMTX_DIR="${HOME_DIR}/mediamtx"
ENV_FILE="/etc/faithform-stream-relay.env"

if [[ $EUID -ne 0 ]]; then
  echo "Run with sudo: sudo bash bootstrap.sh"
  exit 1
fi

apt-get update -qq
apt-get install -y -qq python3 curl ufw libcap2-bin

# Allow RTMP ingest + SSH
ufw --force reset
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 1935/tcp comment 'RTMP ingest'
ufw allow 8888/tcp comment 'HLS playback'
ufw allow 8890/udp comment 'SRT ingest'
ufw --force enable

# Let mediamtx bind to port 1935 without running as root
setcap 'cap_net_bind_service=+ep' "${BIN_DIR}/mediamtx"

chown -R "${USER_NAME}:${USER_NAME}" "${MEDIAMTX_DIR}" "${HOME_DIR}/scripts"
chmod +x "${HOME_DIR}/scripts/"*.sh

if [[ ! -f "${ENV_FILE}" ]]; then
cat > "${ENV_FILE}" <<EOF
FAITHFORM_APP_URL=https://faithform.io
STREAM_RELAY_WEBHOOK_SECRET=replace-me
EOF
chmod 600 "${ENV_FILE}"
fi

cat > /etc/systemd/system/faithform-mediamtx.service <<EOF
[Unit]
Description=FaithForm MediaMTX stream relay
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${USER_NAME}
Group=${USER_NAME}
WorkingDirectory=${MEDIAMTX_DIR}
EnvironmentFile=-${ENV_FILE}
Environment=PATH=${BIN_DIR}:/usr/local/bin:/usr/bin:/bin
ExecStart=/bin/bash -lc 'export MTX_AUTHMETHOD=http; export MTX_AUTHHTTPADDRESS="\${FAITHFORM_APP_URL}/api/stream/publish-auth?secret=\${STREAM_RELAY_WEBHOOK_SECRET}"; exec ${BIN_DIR}/mediamtx ${MEDIAMTX_DIR}/mediamtx.yml'
Restart=on-failure
RestartSec=5
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable faithform-mediamtx
systemctl restart faithform-mediamtx

echo ""
echo "Done. MediaMTX status:"
systemctl --no-pager status faithform-mediamtx
echo ""
echo "Edit ${ENV_FILE} and set STREAM_RELAY_WEBHOOK_SECRET to match Vercel."
echo "RTMP server URL: rtmp://stream.faithform.io/live"
echo "Stream key format: {churchId}/{publishKey}"
