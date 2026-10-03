import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

function runAudit(report: object, status: number) {
  const dir = mkdtempSync(join(tmpdir(), "faithform-audit-"));
  try {
    const fakePnpm = join(dir, "pnpm");
    writeFileSync(fakePnpm, `#!${process.execPath}\nprocess.stdout.write(process.env.AUDIT_TEST_REPORT); process.exit(Number(process.env.AUDIT_TEST_STATUS));\n`);
    chmodSync(fakePnpm, 0o755);
    return spawnSync(process.execPath, ["scripts/audit-production.mjs"], {
      encoding: "utf8",
      env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, AUDIT_TEST_REPORT: JSON.stringify(report), AUDIT_TEST_STATUS: String(status) },
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const counts = { low: 0, moderate: 0, high: 0, critical: 0 };

test("dependency audit rejects registry errors rather than reporting no vulnerabilities", () => {
  const result = runAudit({ error: { code: "ENOTFOUND", message: "Registry unavailable" } }, 1);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /incomplete or failed report/);
  assert.doesNotMatch(result.stdout, /unresolvedHighOrCritical/);
});

test("dependency audit rejects empty reports and abnormal exits", () => {
  assert.equal(runAudit({}, 0).status, 1);
  const result = runAudit({ advisories: {}, metadata: { vulnerabilities: counts } }, 2);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /did not complete/);
});

test("dependency audit accepts a complete clean report", () => {
  assert.equal(runAudit({ advisories: {}, metadata: { vulnerabilities: counts } }, 0).status, 0);
});

test("dependency audit rejects an unresolved high advisory", () => {
  const result = runAudit({ advisories: { 1: { severity: "high", github_advisory_id: "GHSA-test", module_name: "example" } }, metadata: { vulnerabilities: { ...counts, high: 1 } } }, 1);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /GHSA-test/);
});
