#!/usr/bin/env python3
"""Report a ready RTMP source or its departure to FaithForm."""

import os
import re
import sys
import time
import urllib.error
import urllib.request
from uuid import UUID

from relay_api import signed_request


def encoder_event(event, environ):
    if environ.get("MTX_SOURCE_TYPE") not in ("rtmpConn", "rtmpsConn"):
        return None

    path = environ.get("MTX_PATH", "")
    if not re.fullmatch(r"live/[0-9a-fA-F-]{36}", path):
        return None
    try:
        source_id = UUID(environ.get("MTX_SOURCE_ID", ""))
    except ValueError:
        return None
    if not source_id.int:
        return None

    # Browser RTMP and simulated playout have source IDs too. FaithForm checks
    # that this exact connection was authorized with the permanent church key.
    return {"path": path, "event": event, "sourceId": str(source_id)}


def main(event):
    payload = encoder_event(event, os.environ)
    secret = os.environ.get("STREAM_RELAY_WEBHOOK_SECRET")
    if not payload or not secret:
        return

    app_url = os.environ.get("FAITHFORM_APP_URL", "https://faithform.io").rstrip("/")
    # Publish already retries on every heartbeat. A stop has only this hook,
    # so retry transient failures with fresh nonces before relying on expiry.
    attempts = 3 if event == "unpublish" else 1
    for attempt in range(attempts):
        request = signed_request(f"{app_url}/api/stream/relay/encoder", secret, payload)
        try:
            with urllib.request.urlopen(request, timeout=15):
                return
        except urllib.error.HTTPError as error:
            print(f"[relay] encoder lifecycle returned {error.code}", flush=True)
            if error.code < 500:
                return
        except (OSError, ValueError) as error:
            print(f"[relay] encoder lifecycle failed: {type(error).__name__}", flush=True)
        if attempt + 1 < attempts:
            time.sleep(3)


if __name__ == "__main__":
    if len(sys.argv) != 2 or sys.argv[1] not in ("publish", "unpublish"):
        raise SystemExit("usage: encoder-lifecycle.py publish|unpublish")
    main(sys.argv[1])
