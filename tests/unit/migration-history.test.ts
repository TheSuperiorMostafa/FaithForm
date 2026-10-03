import assert from "node:assert/strict";
import { cpSync, mkdtempSync, appendFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const checker = resolve("scripts/verify-migration-baseline.mjs");
function check(mutate: (directory: string) => void) {
  const directory = mkdtempSync(join(tmpdir(), "faithform-migration-history-"));
  try {
    cpSync("supabase", join(directory, "supabase"), { recursive: true });
    mutate(join(directory, "supabase/migrations"));
    return spawnSync(process.execPath, [checker], { cwd: directory, encoding: "utf8" });
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

test("existing migration filename collisions pass without rewriting history", () => {
  const result = check(() => {});
  assert.equal(result.status, 0, result.stderr);
});
test("an additional migration under a historical collision is refused", () => {
  const result = check(directory => writeFileSync(join(directory, "0111_new.sql"), "select 1;"));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /existing duplicate migration history changed for 0111/);
});
test("an edit to a historical colliding migration is refused", () => {
  const result = check(directory => appendFileSync(join(directory, "0112_site_layout_mode.sql"), "\n-- changed\n"));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /existing duplicate migration history changed for 0112/);
});
test("an unrelated new duplicate prefix is still refused", () => {
  const result = check(directory => {
    writeFileSync(join(directory, "9998_a.sql"), "select 1;");
    writeFileSync(join(directory, "9998_b.sql"), "select 1;");
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /new duplicate migration prefix 9998/);
});
