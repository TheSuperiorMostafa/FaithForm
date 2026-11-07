import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getMembersForChurch } from "@/lib/queries/members";

type Reply = { data: unknown[] | null; error: { message: string; code?: string } | null };
function directoryClient(reply: (columns: string) => Reply) {
  const requests: { columns: string; predicates: [string, unknown][] }[] = [];
  const client = {
    from(table: string) {
      assert.equal(table, "members");
      const request = { columns: "", predicates: [] as [string, unknown][] };
      requests.push(request);
      const query = {
        select(columns: string) { request.columns = columns; return query; },
        eq(column: string, value: unknown) { request.predicates.push([column, value]); return query; },
        order() { return query; },
        then(resolve: (result: Reply) => unknown) { return Promise.resolve(reply(request.columns)).then(resolve); },
      };
      return query;
    },
  } as unknown as SupabaseClient;
  return { client, requests };
}
const person = { id: "person", first_name: "Ann", last_name: "Lee", phone: null, email: null, photo_url: null, is_active: true, attendance_entries: [{ count: 3 }] };

test("a missing membership-status column retries the church's existing directory", async () => {
  const { client, requests } = directoryClient(columns => columns.includes("membership_status")
    ? { data: null, error: { message: "column members.membership_status does not exist" } }
    : { data: [person], error: null });
  const people = await getMembersForChurch(client, "church", { includeInactive: true });
  assert.equal(people.length, 1);
  assert.equal(people[0].membership_status, "unknown");
  assert.equal(people[0].attendance_count, 3);
  assert.equal(requests.length, 2);
  for (const request of requests) assert.ok(request.predicates.some(([column, value]) => column === "church_id" && value === "church"));
});

test("both optional legacy columns may be absent without hiding people", async () => {
  const { client } = directoryClient(columns => {
    if (columns.includes(", source")) return { data: null, error: { message: "column members.source does not exist" } };
    if (columns.includes("membership_status")) return { data: null, error: { message: "column members.membership_status does not exist" } };
    return { data: [person], error: null };
  });
  assert.equal((await getMembersForChurch(client, "church")).length, 1);
});

test("a failed directory query is an error, never a claim that no people exist", async () => {
  const { client } = directoryClient(() => ({ data: null, error: { message: "database temporarily unavailable" } }));
  await assert.rejects(getMembersForChurch(client, "church"), /couldn't load your church's people/);
});

test("a successful empty directory remains an empty result", async () => {
  const { client } = directoryClient(() => ({ data: [], error: null }));
  assert.deepEqual(await getMembersForChurch(client, "church"), []);
});

test("23501 on the newly added classification column never becomes an empty directory", async () => {
  const { client, requests } = directoryClient(() => ({
    data: null,
    error: { code: "23501", message: "permission denied for table members" },
  }));
  await assert.rejects(getMembersForChurch(client, "church"), /couldn't load your church's people/);
  assert.equal(requests.length, 1, "permission errors require the read grant, not schema fallback");
});
