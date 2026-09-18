import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(path, "utf8");

test("browser ingest starts the copy deployed to the relay scripts directory", () => {
  const start = read("infra/stream-relay/start-ws-ingest.sh");

  assert.match(start, /scripts\/ws-ingest\.py/);
  assert.doesNotMatch(start, /mediamtx\/ws-ingest\.py/);
  assert.match(start, /\/etc\/faithform-stream-relay\.env/);
});

test("relay deployment can restart browser ingest after syncing it", () => {
  const deploy = read("infra/stream-relay/deploy.sh");

  assert.match(deploy, /--restart-ws-ingest/);
  assert.match(deploy, /bash ~\/scripts\/start-ws-ingest\.sh/);
});

test("every relay deployment syncs and verifies the current MediaMTX path rule", () => {
  const deploy = read("infra/stream-relay/deploy.sh");

  assert.match(deploy, /rsync -av "\$SRC\/mediamtx\.yml"/);
  assert.match(deploy, /grep -Fq .*live\/\(\[0-9a-fA-F-\]\{36\}\)/);
  assert.doesNotMatch(deploy, /if \[\[ \$WITH_CONFIG/);
});

test("bootstrap keeps browser ingest alive under systemd", () => {
  const bootstrap = read("infra/stream-relay/bootstrap.sh");

  assert.match(bootstrap, /faithform-ws-ingest\.service/);
  assert.match(bootstrap, /ExecStart=\/usr\/bin\/python3 \$\{HOME_DIR\}\/scripts\/ws-ingest\.py/);
  assert.match(bootstrap, /systemctl restart faithform-ws-ingest/);
});
