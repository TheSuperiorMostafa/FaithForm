import assert from "node:assert/strict";
import test from "node:test";

import type { SupabaseClient } from "@supabase/supabase-js";
import { emptyChurchProfileForm, upsertChurchProfile } from "@/lib/queries/church-profile";
import { newStaffRow } from "@/types/church-profile";

type Row = { id?: string; church_id?: string; [key: string]: unknown };

function memoryClient(tables: Record<string, Row[]>): SupabaseClient {
  return {
    from(table: string) {
      const filters: ((row: Row) => boolean)[] = [];
      let mode: "select" | "update" | "insert" | "upsert" = "select";
      let payload: Row = {};
      let countRequested = false;
      let limit = 1000;
      const builder = {
        select(_columns: string, options?: { count?: string }) {
          countRequested = options?.count === "exact";
          return builder;
        },
        eq(column: string, value: string) {
          filters.push((row: Row) => row[column] === value);
          return builder;
        },
        gt(column: string, value: string) {
          filters.push((row: Row) => String(row[column]) > value);
          return builder;
        },
        order() { return builder; },
        limit(value: number) { limit = value; return builder; },
        update(value: Row) { mode = "update"; payload = value; return builder; },
        insert(value: Row) { mode = "insert"; payload = value; return builder; },
        upsert(value: Row) { mode = "upsert"; payload = value; return builder; },
        maybeSingle() {
          const result = run();
          return Promise.resolve({ data: result.data?.[0] ?? null, error: result.error });
        },
        single() {
          const result = run();
          return Promise.resolve({ data: result.data?.[0] ?? null, error: result.error });
        },
        then(resolve: (value: ReturnType<typeof run>) => void) { resolve(run()); },
      };
      function run() {
        const stored = tables[table] ?? (tables[table] = []);
        let matched = stored.filter((row) => filters.every((filter) => filter(row)))
          .sort((a, b) => String(a.id).localeCompare(String(b.id)));
        if (mode === "update") matched.forEach((row) => Object.assign(row, payload));
        if (mode === "insert") {
          const row = { ...payload, id: payload.id ?? crypto.randomUUID() };
          stored.push(row);
          matched = [row];
        }
        if (mode === "upsert") {
          const row = stored.find((item) => item.church_id === payload.church_id);
          if (row) Object.assign(row, payload);
          else stored.push({ ...payload });
          matched = row ? [row] : [stored.at(-1)!];
        }
        return {
          data: matched.slice(0, limit),
          error: null,
          count: countRequested ? matched.length : null,
        };
      }
      return builder;
    },
  } as unknown as SupabaseClient;
}

test("retrying a partially completed profile save reuses a new staff ID", async () => {
  const tables: Record<string, Row[]> = {
    churches: [{ id: "church-a", name: "QA church" }],
    church_service_times: [],
    church_staff: [],
    church_recurring_events: [],
  };
  const client = memoryClient(tables);
  const row = { ...newStaffRow(), fullName: "QA staff" };
  const form = { ...emptyChurchProfileForm("QA church"), staff: [row] };

  await upsertChurchProfile("church-a", form, client);
  await upsertChurchProfile("church-a", form, client);

  assert.equal(tables.church_staff.length, 1);
  assert.equal(tables.church_staff[0]?.id, row.clientId);
  assert.equal(tables.church_staff[0]?.full_name, "QA staff");
});
