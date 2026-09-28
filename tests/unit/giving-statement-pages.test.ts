import assert from "node:assert/strict";
import test from "node:test";

import { statementPageSizes } from "../../lib/giving/statement-pages";

test("large statements keep all gifts on headed pages with room for the total", () => {
  for (const count of [0, 1, 14, 15, 32, 33, 56, 1001, 2000]) {
    const pages = statementPageSizes(count);
    assert.equal(pages.reduce((sum, size) => sum + size, 0), count);
    assert.ok(pages[0]! <= 18);
    assert.ok(pages.at(-1)! <= 14, `final page overfull for ${count} gifts`);
    assert.ok(pages.slice(1, -1).every((size) => size > 0 && size <= 24));
  }
  assert.equal(statementPageSizes(1001).length, 43);
  const wrapped = statementPageSizes(1001, 3);
  assert.equal(wrapped.reduce((sum, size) => sum + size, 0), 1001);
  assert.ok(wrapped[0]! <= 6);
  assert.ok(wrapped.at(-1)! <= 4);
  assert.ok(wrapped.slice(1, -1).every((size) => size <= 8));
  assert.throws(() => statementPageSizes(1, 15), /too long/);
});
