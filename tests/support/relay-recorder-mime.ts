import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

/** Capture actual PUT headers from the Python recorder without network access. */
export function recorderUploadTypes(): Record<string, string> {
  const harness = `
import importlib.util, json, sys, tempfile
from pathlib import Path
sys.path.insert(0, "infra/stream-relay")
spec = importlib.util.spec_from_file_location("recorder", "infra/stream-relay/faithform-recorder.py")
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
with tempfile.TemporaryDirectory() as tmp:
    take = Path(tmp)
    m.write_json(take / "meta.json", {"path": "live/11111111-1111-4111-8111-111111111111", "takeId": "mime-test-take", "startedAt": "2026-11-15T15:00:00Z"})
    (take / "index.m3u8").write_text("#EXTM3U\\n#EXTINF:6.000,\\n#EXT-X-PROGRAM-DATE-TIME:2026-11-15T15:00:00Z\\nseg_000000.m4s\\n")
    (take / "seg_000000.m4s").write_bytes(b"media")
    (take / "init.mp4").write_bytes(b"init")
    def call(route, payload):
        if route.endswith("prepare"):
            return {"items": [{**item, "action": "upload", "uploadUrl": "https://storage.example.test/" + item["kind"]} for item in payload["items"]]}
        return {"committed": len(payload["items"])}
    headers = {}
    class Response:
        def __enter__(self): return self
        def __exit__(self, *args): return False
    def upload(request, timeout):
        assert request.get_method() == "PUT" and request.data
        headers[request.full_url.rsplit("/", 1)[-1]] = request.get_header("Content-type")
        return Response()
    m.call = call
    m.urllib.request.urlopen = upload
    assert m.process_take(take, final=True) is True
    print(json.dumps(headers))
`;
  const result = spawnSync("python3", ["-B", "-c", harness], { encoding: "utf8", timeout: 10_000 });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}
