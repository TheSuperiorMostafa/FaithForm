#!/usr/bin/env bash
#
# Plays a real live HLS stream through the iOS app's shipping player, on a
# simulator: `AppTests/LivePlaybackProofTests.swift`.
#
# The stream is shaped like the one the delivery route serves to the apps:
#
#   * a live, sliding-window MPEG-TS playlist — 1s segments, 8 listed, no
#     ENDLIST — which is the relay's geometry (`infra/stream-relay/mediamtx.yml`);
#   * addressed by a delivery path, `/api/media/v1/live/<slug>/<event>/<token>/…`;
#   * with every playlist and segment URI root-relative under that path, as
#     `rewriteM3u8Playlist` writes them.
#
# Needs ffmpeg, xcodegen and Xcode. HOLD=<seconds> keeps the full-screen player
# up after it starts so it can be looked at or captured.
#
#   ./scripts/verify-ios-live-playback.sh
#   HOLD=20 IOS_TEST_DESTINATION='platform=iOS Simulator,name=iPhone 16 Pro' ./scripts/verify-ios-live-playback.sh

set -euo pipefail

SCRIPTS="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPTS/../apps/faithform-ios"

for tool in ffmpeg xcodegen xcodebuild python3; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "$tool is required." >&2
    exit 1
  fi
done

WORK="$(mktemp -d "${TMPDIR:-/tmp}/faithform-live-proof.XXXXXX")"
TOKEN="FFD1.proof.token"
ROUTE="/api/media/v1/live/grace/e1/${TOKEN}"
mkdir -p "${WORK}${ROUTE}"
PORT="${PORT:-8765}"

cleanup() {
  # The tests' result, not the cleanup's: ffmpeg can still be writing a
  # segment while the directory is removed.
  local status=$?
  set +e
  [ -n "${FFMPEG_PID:-}" ] && kill "$FFMPEG_PID" 2>/dev/null && wait "$FFMPEG_PID" 2>/dev/null
  [ -n "${SERVER_PID:-}" ] && kill "$SERVER_PID" 2>/dev/null && wait "$SERVER_PID" 2>/dev/null
  rm -rf "$WORK" 2>/dev/null
  exit "$status"
}
trap cleanup EXIT

# The multivariant playlist, pointing at the media playlist under the same path.
cat > "${WORK}${ROUTE}/index.m3u8" <<EOF
#EXTM3U
#EXT-X-VERSION:3
#EXT-X-STREAM-INF:BANDWIDTH=2500000,RESOLUTION=1280x720,CODECS="avc1.64001f,mp4a.40.2"
${ROUTE}/stream.m3u8
EOF

# A live encoder, in real time: a test card and a tone, like a church's feed.
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

python3 "$SCRIPTS/live-proof-server.py" "$WORK" "$PORT" "$ROUTE" &
SERVER_PID=$!

# Wait until the playlist is a few segments deep, as a real stream would be.
for _ in $(seq 1 60); do
  if [ -f "${WORK}${ROUTE}/stream.m3u8" ] && [ "$(grep -c '\.ts' "${WORK}${ROUTE}/stream.m3u8")" -ge 4 ]; then
    break
  fi
  sleep 0.5
done
curl -fsS "http://127.0.0.1:${PORT}${ROUTE}/index.m3u8" >/dev/null

xcodegen generate --spec project.yml --quiet

DEST="${IOS_TEST_DESTINATION:-platform=iOS Simulator,name=iPhone 16 Pro}"
DERIVED="${IOS_APP_DERIVED_DATA:-${TMPDIR:-/tmp}/faithform-ios-app}"

TEST_RUNNER_FAITHFORM_LIVE_PLAYBACK_URL="http://127.0.0.1:${PORT}${ROUTE}/index.m3u8" \
TEST_RUNNER_FAITHFORM_LIVE_PLAYBACK_HOLD_SECONDS="${HOLD:-0}" \
xcodebuild test \
  -project FaithForm.xcodeproj \
  -scheme FaithForm \
  -destination "$DEST" \
  -derivedDataPath "$DERIVED" \
  -only-testing:FaithFormAppTests/LivePlaybackProofTests \
  CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY=
