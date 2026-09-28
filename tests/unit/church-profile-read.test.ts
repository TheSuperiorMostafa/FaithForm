import assert from "node:assert/strict";
import test from "node:test";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  emptyChurchProfileForm,
  getChurchProfile,
  upsertChurchProfile,
} from "@/lib/queries/church-profile";

type Row = { id: string; [key: string]: unknown };

function profileClient(
  records: Record<string, Row[]>,
  failTable?: string,
  onUpdate?: () => void,
): SupabaseClient {
  return {
    from(table: string) {
      const rows = records[table] ?? [];
      let afterId: string | null = null;
      let countRequested = false;
      let limit = 1000;
      const builder = {
        select(_columns: string, options?: { count?: string }) {
          countRequested = options?.count === "exact";
          return builder;
        },
        eq() { return builder; },
        gt(_column: string, id: string) { afterId = id; return builder; },
        order() { return builder; },
        limit(size: number) { limit = size; return builder; },
        update() { onUpdate?.(); return builder; },
        maybeSingle() {
          return Promise.resolve({
            data: rows[0] ?? null,
            error: table === failTable ? { message: "read failed" } : null,
          });
        },
        then(resolve: (result: {
          data: Row[] | null;
          error: { message: string } | null;
          count: number | null;
        }) => void) {
          if (table === failTable) {
            resolve({ data: null, error: { message: "read failed" }, count: null });
            return;
          }
          const visible = rows.filter((row) => !afterId || row.id > afterId)
            .sort((a, b) => a.id.localeCompare(b.id));
          resolve({
            data: visible.slice(0, limit),
            error: null,
            count: countRequested ? rows.length : null,
          });
        },
      };
      return builder;
    },
  } as unknown as SupabaseClient;
}

const records = {
  churches: [{ id: "church-a", name: "QA church" }],
  church_service_times: Array.from({ length: 1001 }, (_, index) => ({
    id: String(index).padStart(5, "0"),
    church_id: "church-a",
    label: `Service ${index}`,
    day_of_week: 0,
    start_time: "10:00",
    sort_order: 1000 - index,
  })),
  church_staff: [{ id: "staff-a", church_id: "church-a", full_name: "QA staff" }],
  church_recurring_events: [{ id: "event-a", church_id: "church-a", name: "QA event" }],
};

test("profile merges all child rows across API pages in display order", async () => {
  const profile = await getChurchProfile("church-a", profileClient(records));
  assert.equal(profile?.serviceTimes.length, 1001);
  assert.equal(profile?.serviceTimes[0]?.label, "Service 1000");
  assert.equal(profile?.serviceTimes.at(-1)?.label, "Service 0");
  assert.equal(profile?.staff[0]?.full_name, "QA staff");
  assert.equal(profile?.recurringEvents[0]?.name, "QA event");
});

test("failed child read cannot become an empty list that a later save replaces", async () => {
  await assert.rejects(
    getChurchProfile("church-a", profileClient(records, "church_staff")),
    /church_staff read failed/,
  );
});

test("failed church read cannot look like a nonexistent church", async () => {
  await assert.rejects(
    getChurchProfile("church-a", profileClient(records, "churches")),
    /church profile: read failed/,
  );
});

test("an incomplete staff preflight stops a profile save before any write", async () => {
  let updates = 0;
  await assert.rejects(
    upsertChurchProfile(
      "church-a",
      emptyChurchProfileForm("QA church"),
      profileClient(records, "church_staff", () => { updates += 1; }),
    ),
    /church_staff before profile save read failed/,
  );
  assert.equal(updates, 0);
});
