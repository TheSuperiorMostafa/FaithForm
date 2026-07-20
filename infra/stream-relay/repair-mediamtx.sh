#!/usr/bin/env bash
# Repair MediaMTX config, stop rogue processes, restart systemd with auth wiring.
# Run on the server as: sudo bash ~/scripts/repair-mediamtx.sh

set -euo pipefail

USER_NAME="${SUDO_USER:-mostafa}"
HOME_DIR="/home/${USER_NAME}"
BIN_DIR="${HOME_DIR}/bin"
MEDIAMTX_DIR="${HOME_DIR}/mediamtx"
CONFIG_FILE="${MEDIAMTX_DIR}/mediamtx.yml"
ENV_FILE="/etc/faithform-stream-relay.env"
SERVICE="faithform-mediamtx"
RTMP_PORT=1935

pass() { echo "[repair] OK: $*"; }
fail() { echo "[repair] FAIL: $*" >&2; exit 1; }
warn() { echo "[repair] WARN: $*" >&2; }

if [[ $EUID -ne 0 ]]; then
  echo "Run with sudo: sudo bash repair-mediamtx.sh"
  exit 1
fi

if [[ ! -x "${BIN_DIR}/mediamtx" ]]; then
  fail "MediaMTX binary not found at ${BIN_DIR}/mediamtx"
fi

if [[ ! -f "${CONFIG_FILE}" ]]; then
  fail "Config not found at ${CONFIG_FILE}"
fi

echo "[repair] MediaMTX version:"
"${BIN_DIR}/mediamtx" --version 2>&1 || "${BIN_DIR}/mediamtx" -version 2>&1 || true

# --- Config fix: hlsAllowOrigins (new) -> hlsAllowOrigin (installed binary) ---
echo "[repair] Fixing HLS CORS field in ${CONFIG_FILE}..."
cp -a "${CONFIG_FILE}" "${CONFIG_FILE}.bak.$(date +%Y%m%d%H%M%S)"

python3 - "${CONFIG_FILE}" <<'PY'
import re
import sys

path = sys.argv[1]
text = open(path, encoding="utf-8").read()
original = text

# Drop plural field (any YAML list or scalar form).
text = re.sub(r"^hlsAllowOrigins:.*(?:\n(?:[ \t]+-.*|\[.*\]))*\n?", "", text, flags=re.M)

# Ensure singular deprecated field exists (compatible with older binary).
if not re.search(r"^hlsAllowOrigin:", text, flags=re.M):
    text = re.sub(
        r"(^hlsAddress:.*\n)",
        r"\1hlsAllowOrigin: '*'\n",
        text,
        count=1,
        flags=re.M,
    )
else:
    text = re.sub(r"^hlsAllowOrigin:.*$", "hlsAllowOrigin: '*'", text, flags=re.M)

if text != original:
    open(path, "w", encoding="utf-8").write(text)
    print("config updated")
else:
    print("config already compatible")
PY

chown "${USER_NAME}:${USER_NAME}" "${CONFIG_FILE}"

if grep -q '^hlsAllowOrigins:' "${CONFIG_FILE}"; then
  fail "hlsAllowOrigins still present after fix"
fi
if ! grep -q "^hlsAllowOrigin:" "${CONFIG_FILE}"; then
  fail "hlsAllowOrigin missing after fix"
fi
pass "config uses hlsAllowOrigin"

# --- Env file ---
if [[ ! -f "${ENV_FILE}" ]]; then
  fail "${ENV_FILE} missing — run bootstrap.sh first"
fi

# shellcheck disable=SC1090
set -a
source "${ENV_FILE}"
set +a

: "${FAITHFORM_APP_URL:?FAITHFORM_APP_URL must be set in ${ENV_FILE}}"
: "${STREAM_RELAY_WEBHOOK_SECRET:?STREAM_RELAY_WEBHOOK_SECRET must be set in ${ENV_FILE}}"

if [[ "${STREAM_RELAY_WEBHOOK_SECRET}" == "replace-me" || -z "${STREAM_RELAY_WEBHOOK_SECRET}" ]]; then
  fail "STREAM_RELAY_WEBHOOK_SECRET is unset or still 'replace-me'"
fi
pass "env file loaded"

export MTX_AUTHMETHOD=http
export MTX_AUTHHTTPADDRESS="${FAITHFORM_APP_URL%/}/api/stream/publish-auth?secret=${STREAM_RELAY_WEBHOOK_SECRET}"

# --- Validate config starts cleanly (no unknown field) ---
echo "[repair] Validating config with a brief test start..."
TEST_LOG="$(mktemp)"
set +e
timeout 3 "${BIN_DIR}/mediamtx" "${CONFIG_FILE}" >"${TEST_LOG}" 2>&1 &
TEST_PID=$!
sleep 2
kill "${TEST_PID}" 2>/dev/null || true
wait "${TEST_PID}" 2>/dev/null || true
set -e

if grep -qi 'unknown field' "${TEST_LOG}"; then
  echo "--- test start log ---" >&2
  cat "${TEST_LOG}" >&2
  rm -f "${TEST_LOG}"
  fail "config still has unknown fields"
fi
if grep -qiE 'ERR|error while loading' "${TEST_LOG}"; then
  echo "--- test start log ---" >&2
  cat "${TEST_LOG}" >&2
  rm -f "${TEST_LOG}"
  fail "config failed validation"
fi
rm -f "${TEST_LOG}"
pass "config validates"

# --- Stop rogue processes ---
echo "[repair] Stopping existing MediaMTX processes..."
systemctl stop "${SERVICE}" 2>/dev/null || true
sleep 1

if pgrep -x mediamtx >/dev/null; then
  echo "[repair] Killing stray mediamtx PIDs: $(pgrep -x mediamtx | tr '\n' ' ')"
  pkill -x mediamtx 2>/dev/null || true
  sleep 2
fi

if pgrep -x mediamtx >/dev/null; then
  fail "mediamtx still running after stop/kill: $(pgrep -a mediamtx)"
fi

if command -v ss >/dev/null; then
  if ss -ltn "sport = :${RTMP_PORT}" 2>/dev/null | grep -q ":${RTMP_PORT}"; then
    fail "port ${RTMP_PORT} still in use"
  fi
fi
pass "no stray mediamtx processes; port ${RTMP_PORT} free"

# --- Warn about cron mediamtx without systemd ---
CRON_MEDIAMTX="$(crontab -u "${USER_NAME}" -l 2>/dev/null | grep -i mediamtx || true)"
if [[ -n "${CRON_MEDIAMTX}" ]]; then
  warn "crontab references mediamtx — prefer systemd only:"
  echo "${CRON_MEDIAMTX}" >&2
fi

# --- Start systemd service ---
systemctl daemon-reload
systemctl enable "${SERVICE}"
systemctl start "${SERVICE}"

ACTIVE=0
for _ in $(seq 1 10); do
  if systemctl is-active --quiet "${SERVICE}"; then
    ACTIVE=1
    break
  fi
  sleep 1
done

if [[ "${ACTIVE}" -ne 1 ]]; then
  echo "--- systemctl status ---" >&2
  systemctl --no-pager status "${SERVICE}" >&2 || true
  echo "--- recent journal ---" >&2
  journalctl -u "${SERVICE}" -n 30 --no-pager >&2 || true
  fail "service not active after 10s"
fi
pass "systemd service active"

# --- Verify auth env on running process ---
MTX_PID="$(pgrep -x mediamtx | head -1 || true)"
if [[ -z "${MTX_PID}" ]]; then
  fail "no mediamtx process found after start"
fi

MTX_COUNT="$(pgrep -x mediamtx | wc -l | tr -d ' ')"
if [[ "${MTX_COUNT}" -ne 1 ]]; then
  fail "expected exactly one mediamtx process, found ${MTX_COUNT}: $(pgrep -a mediamtx)"
fi
pass "single mediamtx process (pid ${MTX_PID})"

PROC_ENV="$(tr '\0' '\n' < "/proc/${MTX_PID}/environ" 2>/dev/null || true)"
if ! echo "${PROC_ENV}" | grep -q '^MTX_AUTHMETHOD=http$'; then
  fail "MTX_AUTHMETHOD not set on running process"
fi
if ! echo "${PROC_ENV}" | grep -q '^MTX_AUTHHTTPADDRESS='; then
  fail "MTX_AUTHHTTPADDRESS not set on running process"
fi
pass "auth env vars present on running process"

RECENT_LOG="$(journalctl -u "${SERVICE}" --since "2 min ago" --no-pager 2>/dev/null || true)"
if echo "${RECENT_LOG}" | grep -qi 'unknown field'; then
  fail "journal still reports unknown field"
fi
if echo "${RECENT_LOG}" | grep -qiE 'listener opened on :1935|RTMP'; then
  pass "RTMP listener reported in journal"
else
  warn "RTMP listener line not found in recent journal — check manually"
fi

# --- Publish-auth smoke test (endpoint reachable, secret accepted) ---
echo "[repair] Publish-auth smoke test..."
AUTH_BODY='{"action":"publish","path":"live/00000000-0000-0000-0000-000000000000/invalidkey000000","protocol":"rtmp"}'
AUTH_HTTP="$(curl -sS -o /tmp/faithform-publish-auth-smoke.json -w '%{http_code}' \
  -X POST \
  -H 'Content-Type: application/json' \
  -d "${AUTH_BODY}" \
  "${MTX_AUTHHTTPADDRESS}" || echo "000")"

case "${AUTH_HTTP}" in
  401)
    pass "publish-auth reachable (401 for invalid stream path/key as expected)"
    ;;
  200)
    warn "publish-auth returned 200 for dummy path — unexpected but endpoint is reachable"
    ;;
  000)
    fail "publish-auth unreachable at ${MTX_AUTHHTTPADDRESS}"
    ;;
  *)
    fail "publish-auth returned HTTP ${AUTH_HTTP} (expected 401)"
    ;;
esac

# --- Summary ---
echo ""
echo "=== faithform-mediamtx status ==="
systemctl --no-pager status "${SERVICE}" || true
echo ""
echo "=== recent journal (last 20 lines) ==="
journalctl -u "${SERVICE}" -n 20 --no-pager || true
echo ""
echo "=== optional RTMP probe (requires real churchId/publishKey) ==="
echo "ffmpeg -re -f lavfi -i testsrc=size=320x240:rate=1 -f lavfi -i sine=frequency=1000 \\"
echo "  -t 5 -c:v libx264 -preset ultrafast -c:a aac \\"
echo "  -f flv 'rtmp://127.0.0.1/live/{churchId}/{publishKey}'"
echo ""
echo "While publishing, watch auth callbacks:"
echo "  journalctl -u ${SERVICE} -f"
echo ""
pass "repair complete — safe to retest OBS"
