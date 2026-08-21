#!/usr/bin/env bash
# Start ephemeral Cloudflare quick tunnels for HLS, browser WS ingest, and WHIP.
# Writes URLs to ~/mediamtx/logs/tunnel-urls.env for Vercel env configuration.
#
# Prefer named tunnels (ingest.stream.faithform.io) in production — see DEPLOY.md.
# Run on the relay: bash ~/scripts/start-cloudflared-tunnels.sh

set -euo pipefail

RELAY_HOME="${HOME:-/home/mostafa}"
BIN_DIR="${RELAY_HOME}/bin"
LOG_DIR="${RELAY_HOME}/mediamtx/logs"
URL_FILE="${LOG_DIR}/tunnel-urls.env"
CLOUDFLARED="${BIN_DIR}/cloudflared"

mkdir -p "${LOG_DIR}"

if [[ ! -x "${CLOUDFLARED}" ]]; then
  echo "cloudflared not found at ${CLOUDFLARED}"
  exit 1
fi

start_tunnel() {
  local name="$1"
  local port="$2"
  local log_file="${LOG_DIR}/cloudflared-${name}.log"
  local pid_file="${LOG_DIR}/cloudflared-${name}.pid"

  pkill -f "cloudflared tunnel --url http://127.0.0.1:${port}" 2>/dev/null || true
  sleep 1

  : > "${log_file}"
  nohup "${CLOUDFLARED}" tunnel --url "http://127.0.0.1:${port}" >>"${log_file}" 2>&1 &
  echo $! > "${pid_file}"

  local url=""
  for _ in $(seq 1 30); do
    url="$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "${log_file}" | head -1 || true)"
    if [[ -n "${url}" ]]; then
      echo "${url}"
      return 0
    fi
    sleep 1
  done

  echo "failed to read tunnel URL for ${name} (port ${port})" >&2
  tail -5 "${log_file}" >&2 || true
  return 1
}

echo "[tunnels] starting HLS (8888), WS ingest (8090), WHIP (8889)..."
HLS_URL="$(start_tunnel hls 8888)"
WS_URL="$(start_tunnel http 8090)"
WHIP_URL="$(start_tunnel whip 8889)"

cat > "${URL_FILE}" <<EOF
# Generated $(date -u +"%Y-%m-%dT%H:%M:%SZ") — copy to Vercel production env
STREAM_HLS_UPSTREAM_URL=${HLS_URL}
STREAM_WS_INGEST_UPSTREAM_URL=${WS_URL//https:\/\//wss://}
STREAM_HTTP_INGEST_UPSTREAM_URL=${WS_URL}
STREAM_WHIP_UPSTREAM_URL=${WHIP_URL}
EOF

echo ""
echo "[tunnels] URLs written to ${URL_FILE}:"
cat "${URL_FILE}"
echo ""
echo "Update Vercel production env with the values above, then retry Browser Studio."
