import assert from "node:assert/strict";
import test from "node:test";

import { readAllById } from "@/lib/queries/paged-read";

const source = Array.from({ length: 1205 }, (_, index) => ({
  id: String(index).padStart(5, "0"),
}));

test("reads every row through an API with a 500-row response limit", async () => {
  const cursors: (string | null)[] = [];
  const rows = await readAllById(async (afterId, includeCount, pageSize) => {
    cursors.push(afterId);
    const start = afterId ? source.findIndex((row) => row.id === afterId) + 1 : 0;
    return {
      data: source.slice(start, start + pageSize),
      error: null,
      count: includeCount ? source.length : null,
    };
  }, { label: "children" });

  assert.deepEqual(rows, source);
  assert.deepEqual(cursors, [null, "00499", "00999"]);
});

test("rejects a truncated page instead of presenting a partial roster", async () => {
  await assert.rejects(
    readAllById(async (afterId) => ({
      data: afterId ? [] : source.slice(0, 500),
      error: null,
      count: source.length,
    }), { label: "children" }),
    /children incomplete/,
  );
});

test("rejects an unavailable count, failed page, or changed row order", async () => {
  await assert.rejects(
    readAllById(async () => ({ data: [], error: null, count: null }), { label: "children" }),
    /count unavailable/,
  );
  await assert.rejects(
    readAllById(async (afterId) => ({
      data: afterId ? null : source.slice(0, 500),
      error: afterId ? { message: "network error" } : null,
      count: source.length,
    }), { label: "children" }),
    /read failed/,
  );
  await assert.rejects(
    readAllById(async () => ({
      data: [source[1], source[0]],
      error: null,
      count: 2,
    }), { label: "children" }),
    /unordered row/,
  );
});

test("rejects an unbounded roster before reading it all", async () => {
  await assert.rejects(
    readAllById(async () => ({ data: source.slice(0, 500), error: null, count: 10_001 }), {
      label: "children",
    }),
    /exceeds 10000 rows/,
  );
});
