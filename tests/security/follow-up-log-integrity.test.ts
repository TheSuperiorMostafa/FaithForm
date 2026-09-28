import assert from "node:assert/strict";
import test from "node:test";

import type { SupabaseClient } from "@supabase/supabase-js";

import { getFollowUpLog } from "../../lib/queries/follow-up-log";

type Row = {
  id: string;
  service_date: string;
  recipient_name: string;
  recipient_phone: string | null;
  message: string;
  status: string;
  error: string | null;
  sender_phone: string | null;
  sender_name: string | null;
  created_at: string;
};

function logRow(index: number, date = "2026-09-27"): Row {
  return {
    id: String(1002 - index).padStart(5, "0"),
    service_date: date,
    recipient_name: `QA recipient ${index}`,
    recipient_phone: null,
    message: "QA follow-up",
    status: index === 1000 ? "failed" : "sent",
    error: null,
    sender_phone: null,
    sender_name: "QA sender",
    created_at: "2026-09-27T12:00:00Z",
  };
}

function clientWithPages(
  ...pages: Array<{ data: Row[] | null; error: { message: string } | null }>
) {
  const ranges: Array<[number, number]> = [];
  const builder = {
    select: () => builder,
    eq: () => builder,
    order: () => builder,
    range: (from: number, to: number) => {
      ranges.push([from, to]);
      const page = pages.shift();
      assert.ok(page, "unexpected extra follow-up query");
      return Promise.resolve(page);
    },
  };
  return { client: { from: () => builder } as unknown as SupabaseClient, ranges };
}

test("a large Sunday includes every follow-up text before moving to the next Sunday", async () => {
  const current = Array.from({ length: 1001 }, (_, index) => logRow(index));
  const next = logRow(1001, "2026-09-20");
  const db = clientWithPages(
    { data: current.slice(0, 500), error: null },
    { data: current.slice(500, 1000), error: null },
    { data: [current[1000]!, next], error: null },
  );

  const sundays = await getFollowUpLog("church-a", 1, db.client);
  assert.equal(sundays.length, 1);
  assert.equal(sundays[0]?.entries.length, 1001);
  assert.equal(sundays[0]?.failedCount, 1);
  assert.deepEqual(db.ranges, [[0, 499], [500, 999], [1000, 1499]]);
});

test("a failed follow-up page never appears as an empty or partial log", async () => {
  const first = Array.from({ length: 500 }, (_, index) => logRow(index));
  const db = clientWithPages(
    { data: first, error: null },
    { data: null, error: { message: "connection lost" } },
  );
  await assert.rejects(getFollowUpLog("church-a", 12, db.client), /read failed: connection lost/);
  await assert.rejects(getFollowUpLog("church-a", 12, null), /service is unavailable/);
});
