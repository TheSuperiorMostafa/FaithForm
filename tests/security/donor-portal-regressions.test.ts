import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

for (const [scenario, description] of [
  ["giving-gates", "portal money-moving handlers fail closed while pause and cancel remain available"],
  ["sign-out-retry", "portal sign-out preserves its retry cookie on revocation failure and rejects replay after retry"],
]) {
  test(description, () => {
    const result = spawnSync(process.execPath, ["tests/fixtures/donor-portal-regressions.mjs", scenario], {
      encoding: "utf8",
    });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /Passed /);
  });
}
