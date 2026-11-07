import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("operations monitor authenticates cron and restricts test delivery to existing recipients", () => {
  const result = spawnSync(process.execPath, ["tests/fixtures/operations-monitor-route.mjs"], { encoding: "utf8" });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Passed operations monitor route/);
});
