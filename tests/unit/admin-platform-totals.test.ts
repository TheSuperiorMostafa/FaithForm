import assert from "node:assert/strict";
import test from "node:test";

import { loadAllAdminPages } from "../../lib/queries/admin-platform-totals";

test("admin rollout fallback reads beyond PostgREST's 1,000-row page", async () => {
  const records = Array.from({ length: 2005 }, (_, id) => ({ id }));
  const ranges: [number, number][] = [];
  const result = await loadAllAdminPages("test", async (from, to) => {
    ranges.push([from, to]);
    return { data: records.slice(from, to + 1), error: null };
  });

  assert.deepEqual(result, records);
  assert.deepEqual(ranges, [[0, 999], [1000, 1999], [2000, 2999]]);
});

test("admin rollout fallback fails rather than presenting a partial total", async () => {
  await assert.rejects(
    loadAllAdminPages("gifts", async (from) =>
      from === 0
        ? { data: Array.from({ length: 1000 }, () => ({ amount: 1 })), error: null }
        : { data: null, error: { message: "page unavailable" } },
    ),
    /gifts: page unavailable/,
  );
});
