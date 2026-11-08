"""Build authenticated relay callbacks without sending the shared secret."""

import hashlib
import hmac
import json
import secrets
import time
from urllib.request import Request


def signed_request(url, secret, payload):
    body = json.dumps(payload, separators=(",", ":"))
    timestamp = str(int(time.time()))
    nonce = secrets.token_urlsafe(24)
    signature = hmac.new(
        secret.encode(),
        f"v1:{timestamp}:{nonce}:{body}".encode(),
        hashlib.sha256,
    ).hexdigest()
    return Request(
        url,
        data=body.encode(),
        method="POST",
        headers={
            "content-type": "application/json",
            "x-faithform-relay-signature": f"v1={signature}",
            "x-faithform-relay-timestamp": timestamp,
            "x-faithform-relay-nonce": nonce,
        },
    )
