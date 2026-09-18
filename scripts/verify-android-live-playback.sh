#!/usr/bin/env bash
#
# Plays a real live HLS stream through the Android app's shipping player, on an
# emulator: `app/src/androidTest/.../LivePlaybackProofTest.kt`.
#
# The stream is shaped like the one the delivery route serves to the apps (see
# `verify-ios-live-playback.sh`), and `live-proof-server.py` answers the grant
# and the live projection, so the real client resolves the real URL.
#
# Needs ffmpeg, a JDK 17+ (JAVA_HOME) and a running emulator or device — or an
# AVD name in AVD, which is booted headless. The emulator reaches this machine
# at 10.0.2.2, the one cleartext exception the debug build allows.
# HOLD=<seconds> keeps the full-screen player up so it can be captured.
#
#   AVD=FaithForm_API_36 HOLD=15 ./scripts/verify-android-live-playback.sh

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR/apps/faithform-android"

ADB="${ANDROID_HOME:-$HOME/Library/Android/sdk}/platform-tools/adb"
EMULATOR="${ANDROID_HOME:-$HOME/Library/Android/sdk}/emulator/emulator"
for tool in ffmpeg python3; do
  command -v "$tool" >/dev/null 2>&1 || { echo "$tool is required." >&2; exit 1; }
done

WORK="$(mktemp -d "${TMPDIR:-/tmp}/faithform-live-proof.XXXXXX")"
TOKEN="FFD1.proof.token"
ROUTE="/api/media/v1/live/grace/e1/${TOKEN}"
PORT="${PORT:-8765}"
mkdir -p "${WORK}${ROUTE}"

cleanup() {
  local status=$?
  set +e
  [ -n "${FFMPEG_PID:-}" ] && kill "$FFMPEG_PID" 2>/dev/null && wait "$FFMPEG_PID" 2>/dev/null
  [ -n "${SERVER_PID:-}" ] && kill "$SERVER_PID" 2>/dev/null && wait "$SERVER_PID" 2>/dev/null
  rm -rf "$WORK" 2>/dev/null
  exit "$status"
}
trap cleanup EXIT

if [ -z "$("$ADB" devices | sed 1d | grep -w device)" ]; then
  if [ -z "${AVD:-}" ]; then
    echo "No device. Start an emulator, or set AVD to one to boot." >&2
    exit 1
  fi
  "$EMULATOR" -avd "$AVD" -no-window -no-audio -no-snapshot-save >/dev/null 2>&1 &
  "$ADB" wait-for-device
  until [ "$("$ADB" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ]; do sleep 2; done
fi

cat > "${WORK}${ROUTE}/index.m3u8" <<EOF
#EXTM3U
#EXT-X-VERSION:3
#EXT-X-STREAM-INF:BANDWIDTH=2500000,RESOLUTION=1280x720,CODECS="avc1.64001f,mp4a.40.2"
${ROUTE}/stream.m3u8
EOF

ffmpeg -loglevel error -re \
  -f lavfi -i "testsrc2=size=1280x720:rate=30" \
  -f lavfi -i "sine=frequency=440:sample_rate=48000" \
  -c:v libx264 -preset veryfast -tune zerolatency -g 30 -keyint_min 30 -sc_threshold 0 \
  -c:a aac -b:a 128k \
  -f hls -hls_time 1 -hls_list_size 8 \
  -hls_flags delete_segments+omit_endlist \
  -hls_base_url "${ROUTE}/" \
  -hls_segment_filename "${WORK}${ROUTE}/seg%d.ts" \
  "${WORK}${ROUTE}/stream.m3u8" &
FFMPEG_PID=$!

python3 "$ROOT_DIR/scripts/live-proof-server.py" "$WORK" "$PORT" "$ROUTE" &
SERVER_PID=$!

for _ in $(seq 1 60); do
  if [ -f "${WORK}${ROUTE}/stream.m3u8" ] && [ "$(grep -c '\.ts' "${WORK}${ROUTE}/stream.m3u8")" -ge 4 ]; then
    break
  fi
  sleep 0.5
done
curl -fsS "http://127.0.0.1:${PORT}${ROUTE}/index.m3u8" >/dev/null

./gradlew :app:connectedDebugAndroidTest --console=plain \
  -Pandroid.testInstrumentationRunnerArguments.class=io.faithform.app.media.LivePlaybackProofTest \
  -Pandroid.testInstrumentationRunnerArguments.liveOrigin="http://10.0.2.2:${PORT}" \
  -Pandroid.testInstrumentationRunnerArguments.liveHoldSeconds="${HOLD:-0}"
