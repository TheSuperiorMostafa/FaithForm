#!/usr/bin/env bash
set -euo pipefail

set -a
source ~/faithform-stream-relay.env
set +a

export HTTP_INGEST_HOST=127.0.0.1
export HTTP_INGEST_PORT=8090
export FFMPEG_PATH=/home/mostafa/bin/ffmpeg

pkill -f "http-ingest.py" 2>/dev/null || true
pkill -f "ws-ingest.py" 2>/dev/null || true
sleep 1

nohup python3 /home/mostafa/mediamtx/http-ingest.py >> /home/mostafa/mediamtx/logs/http-ingest.log 2>&1 &
echo "http-ingest started"
