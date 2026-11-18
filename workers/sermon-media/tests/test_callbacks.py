import time

import pytest
from conftest import TOKEN

from sermon_media.callbacks import (CallbackClient, CallbackError, Cancelled, Heartbeat, Stale,
                                    Unauthorized, redact)


def client(stub, **kw):
    return CallbackClient(stub.callback_base, TOKEN, "att-1", sleep=lambda s: None, **kw)


def test_success_sends_bearer_and_attempt(stub):
    assert client(stub).post("begin") == {"status": "ok"}
    call = stub.calls[0]
    assert call["auth"] == f"Bearer {TOKEN}" and call["body"] == {"attempt_id": "att-1"}


@pytest.mark.parametrize("status,exc", [("stale", Stale), ("cancelled", Cancelled)])
def test_409_stops(stub, status, exc):
    stub.routes["begin"] = (409, {"status": status})
    with pytest.raises(exc):
        client(stub).post("begin")
    assert len(stub.calls) == 1  # no retry


def test_401_stops(stub):
    stub.routes["sources"] = (401, {"error": "nope"})
    with pytest.raises(Unauthorized):
        client(stub).post("sources")


def test_5xx_retries_then_succeeds(stub):
    stub.routes["transcript"] = [(503, {}), (500, {}), (200, {"status": "ok", "version": 3})]
    assert client(stub).post("transcript", {"segments": []})["version"] == 3
    assert stub.names() == ["transcript"] * 3


def test_5xx_bounded_and_redacted(stub):
    stub.routes["heartbeat"] = (502, {})
    with pytest.raises(CallbackError) as e:
        client(stub).post("heartbeat")
    assert len(stub.calls) == 5
    assert TOKEN not in str(e.value) and "http" not in str(e.value)


def test_network_error_redacted():
    c = CallbackClient(f"http://127.0.0.1:9/api/sermon-media/worker/x?token={TOKEN}", TOKEN, "a",
                       sleep=lambda s: None, max_tries=2, timeout=1)
    with pytest.raises(CallbackError) as e:
        c.post("begin")
    assert TOKEN not in str(e.value) and "127.0.0.1:9" not in str(e.value)


def test_redact_helper():
    text = f"GET https://x.supabase.co/storage/v1/object/sign/a.m4s?token=abc failed; Bearer {TOKEN}"
    out = redact(text, [TOKEN])
    assert TOKEN not in out and "supabase" not in out and "token=abc" not in out


def test_heartbeat_beats_and_propagates_cancel(stub):
    beats = []

    def hb_route(body):
        beats.append(body)
        return (409, {"status": "cancelled"}) if len(beats) >= 3 else (200, {"status": "ok"})

    stub.routes["heartbeat"] = hb_route
    with Heartbeat(client(stub), interval=0.05) as hb:
        hb.update("asr", 0.5)
        deadline = time.time() + 5
        while hb.stop_error is None and time.time() < deadline:
            time.sleep(0.02)
        with pytest.raises(Cancelled):
            hb.check()
    assert beats[0]["stage"] == "asr" and beats[0]["progress"] == 0.5
    assert all(b["attempt_id"] == "att-1" for b in beats)
