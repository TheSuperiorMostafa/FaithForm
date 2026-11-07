import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

for (const [scenario, description] of [
  ["concurrent", "concurrent Go Live callers claim before platform mutations"],
  ["setup-failure", "uncertain setup retains a recoverable claim and never repeats providers"],
  ["pre-migration", "scheduled playout signs, lists and acknowledges through the existing schema"],
  ["signing-failure", "simulated signing failure recovers the existing live event"],
  ["write-failure", "simulated handoff write failure retries without provisioning platforms"],
  ["route-handoff-failure", "scheduled cron reports a partial handoff failure with non-success status"],
  ["route-fatal", "scheduled cron reports a database failure without private details"],
  ["route-poll", "relay poll preserves other churches ready jobs while reporting failed recovery"],
]) {
  test(description, () => {
    const result = spawnSync(process.execPath, ["tests/fixtures/stream-start-recovery.mjs", scenario], { encoding: "utf8" });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /Passed /);
  });
}
