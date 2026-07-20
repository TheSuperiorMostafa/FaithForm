#!/usr/bin/env bash
# Re-encodes a MediaMTX path into timestamp-safe HLS for public playback.

set -euo pipefail

RELAY_HOME="${HOME:-/home/mostafa}"
FFMPEG="${RELAY_HOME}/bin/ffmpeg"
HLS_ROOT="${RELAY_HOME}/mediamtx/public-hls"

if [[ ! "${MTX_PATH:-}" =~ ^live/[0-9a-fA-F-]{36}/[A-Za-z0-9_-]{16,}$ ]]; then
  echo "[hls-normalizer] invalid MTX_PATH"
  exit 1
fi

SAFE_PATH="${MTX_PATH//\//_}"
PID_FILE="${RELAY_HOME}/mediamtx/pids/${SAFE_PATH}.hls.pid"
OUTPUT_DIR="${HLS_ROOT}/${MTX_PATH}"
SOURCE_URL="rtsp://127.0.0.1:8554/${MTX_PATH}"

mkdir -p "${OUTPUT_DIR}" "${RELAY_HOME}/mediamtx/pids"
rm -f "${OUTPUT_DIR}"/*.m3u8 "${OUTPUT_DIR}"/*.ts

if [[ -f "${PID_FILE}" ]]; then
  old_pid="$(cat "${PID_FILE}")"
  if kill -0 "${old_pid}" 2>/dev/null; then
    kill "${old_pid}" 2>/dev/null || true
  fi
fi

"${FFMPEG}" -nostdin -hide_banner -loglevel warning \
  -rtsp_transport tcp -fflags +genpts+igndts+discardcorrupt \
  -i "${SOURCE_URL}" \
  -map 0:v:0 -map 0:a:0? \
  -vf "scale='min(1280,iw)':-2" -r 30 \
  -c:v libx264 -preset veryfast -tune zerolatency -pix_fmt yuv420p \
  -g 60 -keyint_min 60 -sc_threshold 0 -bf 0 \
  -c:a aac -b:a 128k -ar 48000 -af "aresample=async=1:first_pts=0" \
  -f hls -hls_time 1 -hls_list_size 6 \
  -hls_flags delete_segments+append_list+independent_segments \
  -hls_segment_filename "${OUTPUT_DIR}/segment%05d.ts" \
  "${OUTPUT_DIR}/index.m3u8" \
  >>"${RELAY_HOME}/mediamtx/logs/${SAFE_PATH}.hls.log" 2>&1 &

echo $! >"${PID_FILE}"
echo "[hls-normalizer] started ${MTX_PATH}"
