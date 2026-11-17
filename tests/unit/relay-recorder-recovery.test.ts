import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("the real recorder retries init and frames after media commits, and retains unacknowledged frame uploads", () => {
  const harness = `
import importlib.util, json, sys, tempfile
from pathlib import Path
sys.path.insert(0, "infra/stream-relay")
spec = importlib.util.spec_from_file_location("recorder", "infra/stream-relay/faithform-recorder.py")
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
with tempfile.TemporaryDirectory() as tmp:
    take = Path(tmp)
    m.write_json(take / "meta.json", {"path": "live/11111111-1111-4111-8111-111111111111", "takeId": "test-take", "startedAt": "2026-11-15T15:00:00Z"})
    (take / "index.m3u8").write_text("#EXTM3U\\n#EXTINF:6.000,\\n#EXT-X-PROGRAM-DATE-TIME:2026-11-15T15:00:00Z\\nseg_000002.m4s\\n")
    (take / "seg_000002.m4s").write_bytes(b"media")
    (take / "init.mp4").write_bytes(b"init")
    frame = take / "frame_000002.jpg"
    frame.write_bytes(b"frame")
    m.make_frame = lambda *args: frame
    requested = []
    uploads = []
    failures = {"init": True, "frame": True, "commit": False}
    def call(route, payload):
        if route.endswith("prepare"):
            requested.append([item["kind"] for item in payload["items"]])
            return {"items": [{**item, "action": "upload", "uploadUrl": item["kind"]} for item in payload["items"]]}
        return None if failures["commit"] else {"committed": len(payload["items"])}
    def put(url, path, content_type):
        uploads.append(url)
        return None if failures.get(url) else Path(path).stat().st_size
    m.call, m.put = call, put
    assert m.process_take(take) is False
    state = m.read_json(take / "state.json", {})
    assert state["segments"] == {"2": "done"}, state
    assert state["init"] is None and not state["frames"], state
    failures["init"] = False
    assert m.process_take(take) is True
    assert requested[-1] == ["init", "frame"], requested
    failures["frame"] = False
    failures["commit"] = True
    assert m.process_take(take) is False
    assert not m.read_json(take / "state.json", {})["frames"]
    failures["commit"] = False
    assert m.process_take(take) is True
    assert requested[-1] == ["frame"], requested
    assert m.read_json(take / "state.json", {})["frames"] == {"2": "handled"}
    assert uploads.count("segment") == 1, uploads
print("recorder recovery passed")
`;
  const result = spawnSync("python3", ["-B", "-c", harness], { encoding: "utf8", timeout: 10_000 });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /recorder recovery passed/);
});

test("stopping the recorder releases path ownership before the old take finishes uploading", () => {
  const harness = `
import importlib.util, signal, sys, tempfile
from pathlib import Path
sys.path.insert(0, "infra/stream-relay")
spec = importlib.util.spec_from_file_location("recorder", "infra/stream-relay/faithform-recorder.py")
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
with tempfile.TemporaryDirectory() as tmp:
    m.PIDS = Path(tmp)
    path = "live/11111111-1111-4111-8111-111111111111"
    pidfile = m.PIDS / f"rec_{m.digest(path)}.pid"
    pidfile.write_text("123 456 old-take")
    signals = []
    m.os.kill = lambda pid, sig: signals.append((pid, sig))
    assert m.cmd_stop(path) == 0
    assert signals == [(456, signal.SIGINT)], signals
    assert not pidfile.exists(), "old uploading take must not block reconnect recording"
`;
  const result = spawnSync("python3", ["-B", "-c", harness], { encoding: "utf8", timeout: 10_000 });
  assert.equal(result.status, 0, result.stderr);
});

test("a dead recording reader is replaced and upload timeout preserves the take and reconnect ownership", () => {
  const harness = `
import importlib.util, sys, tempfile
from pathlib import Path
sys.path.insert(0, "infra/stream-relay")
spec = importlib.util.spec_from_file_location("recorder", "infra/stream-relay/faithform-recorder.py")
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
with tempfile.TemporaryDirectory() as tmp:
    m.PIDS = Path(tmp) / "pids"
    m.TAKES = Path(tmp) / "takes"
    m.PIDS.mkdir()
    m.SECRET = "safe-test-secret"
    path = "live/11111111-1111-4111-8111-111111111111"
    pidfile = m.PIDS / f"rec_{m.digest(path)}.pid"
    pidfile.write_text("123 456 old-take")
    def kill(pid, sig):
        if pid == 456: raise ProcessLookupError()
    m.os.kill = kill
    class Reader:
        pid = 789
        def poll(self): return 1
    launches = []
    def launch(*args, **kwargs):
        launches.append(args)
        return Reader()
    m.subprocess.Popen = launch
    calls = []
    def call(route, body):
        calls.append((route, body))
        return {}
    m.call = call
    m.ingest_stats = lambda *args: {}
    def process(take, final=False):
        pidfile.write_text("900 901 replacement-take")
        return False
    m.process_take = process
    ticks = iter(range(10000, 100000, 1000))
    m.time.time = lambda: next(ticks)
    m.time.sleep = lambda *args: None
    assert m.cmd_take(path) == 0
    assert len(launches) == 1, "the dead reader must be replaced while old uploads drain"
    assert pidfile.read_text() == "900 901 replacement-take", "old cleanup must not remove reconnect ownership"
    takes = list(m.TAKES.iterdir())
    assert len(takes) == 1 and not (takes[0] / "done").exists(), "timed-out uploads must stay eligible for sweep"
    assert not any(body.get("event") == "ended" for route, body in calls), calls
`;
  const result = spawnSync("python3", ["-B", "-c", harness], { encoding: "utf8", timeout: 10_000 });
  assert.equal(result.status, 0, result.stderr);
});

test("the sweeper resumes retained media that an older recorder incorrectly marked done", () => {
  const harness = `
import importlib.util, sys, tempfile
from pathlib import Path
sys.path.insert(0, "infra/stream-relay")
spec = importlib.util.spec_from_file_location("recorder", "infra/stream-relay/faithform-recorder.py")
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
with tempfile.TemporaryDirectory() as tmp:
    m.PIDS = Path(tmp) / "pids"
    m.TAKES = Path(tmp) / "takes"
    m.PIDS.mkdir()
    take = m.TAKES / "old-take"
    take.mkdir(parents=True)
    m.SECRET = "safe-test-secret"
    m.write_json(take / "meta.json", {"path": "live/11111111-1111-4111-8111-111111111111", "takeId": "old-take", "startedAt": "2026-11-15T15:00:00Z"})
    m.write_json(take / "state.json", {"segments": {}, "init": None, "frames": {}})
    (take / "index.m3u8").write_text("#EXTM3U\\n#EXTINF:6.000,\\n#EXT-X-PROGRAM-DATE-TIME:2026-11-15T15:00:00Z\\nseg_000000.m4s\\n")
    (take / "seg_000000.m4s").write_bytes(b"media")
    (take / "done").write_text("incorrectly completed before upload")
    processed = []
    def process(folder, final=False):
        assert not (folder / "done").exists(), "must reopen incomplete take first"
        processed.append(folder.name)
        m.write_json(folder / "state.json", {"segments": {"0": "done"}, "init": "done", "frames": {}})
        return True
    m.process_take = process
    m.call = lambda *args: {}
    assert m.cmd_sweep() == 0
    assert processed == ["old-take"], processed
    assert (take / "done").exists()
    assert m.cmd_sweep() == 0
    assert processed == ["old-take"], "completed take must settle"
`;
  const result = spawnSync("python3", ["-B", "-c", harness], { encoding: "utf8", timeout: 10_000 });
  assert.equal(result.status, 0, result.stderr);
});
