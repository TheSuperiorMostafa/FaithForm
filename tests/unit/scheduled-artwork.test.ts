import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireScheduledArtworkTarget, setScheduledArtwork } from "../../lib/stream/scheduled-artwork";

function store(options: { missing?: boolean; error?: boolean } = {}) {
  const filters: [string, unknown][] = [];
  const writes: Record<string, unknown>[] = [];
  const tables: string[] = [];
  const result = async () => ({
    data: options.missing ? null : { id: "service", church_id: "church", status: "scheduled" },
    error: options.error ? { message: "private database detail" } : null,
  });
  const query = {
    select: () => query,
    update: (patch: Record<string, unknown>) => { writes.push(patch); return query; },
    eq: (column: string, value: unknown) => { filters.push([column, value]); return query; },
    maybeSingle: result,
    single: result,
  };
  return {
    client: { from: (table: string) => { tables.push(table); return query; } } as unknown as SupabaseClient,
    filters, writes, tables,
  };
}

const expectedFilters = [["id", "service"], ["church_id", "church"], ["status", "scheduled"]];

test("scheduled artwork upload preflight scopes ownership and status before accepting storage", async () => {
  const fake = store();
  await requireScheduledArtworkTarget("church", "service", fake.client);
  assert.deepEqual(fake.tables, ["stream_events"]);
  assert.deepEqual(fake.filters, expectedFilters);
  assert.deepEqual(fake.writes, []);
  await assert.rejects(requireScheduledArtworkTarget("church", "service", store({ missing: true }).client), /Only an upcoming service/);
  await assert.rejects(requireScheduledArtworkTarget("church", "service", store({ error: true }).client), /couldn't check/);
});

test("each scheduled crop writes only its own columns under an atomic tenant and status condition", async () => {
  for (const [crop, expected] of [
    ["poster", { artwork_poster_url: "https://test.invalid/image.jpg" }],
    ["wide", { artwork_wide_url: "https://test.invalid/image.jpg", artwork_url: "https://test.invalid/image.jpg" }],
    ["banner", { artwork_banner_url: "https://test.invalid/image.jpg" }],
  ] as const) {
    const fake = store();
    assert.deepEqual(await setScheduledArtwork("church", "service", crop, "https://test.invalid/image.jpg", fake.client), { ok: true });
    assert.deepEqual(fake.filters, expectedFilters);
    assert.deepEqual(fake.writes, [expected]);
  }
});

test("removing a wide crop also clears legacy artwork without touching other crops or metadata", async () => {
  const fake = store();
  assert.deepEqual(await setScheduledArtwork("church", "service", "wide", null, fake.client), { ok: true });
  assert.deepEqual(fake.writes, [{ artwork_wide_url: null, artwork_url: null }]);
  assert.deepEqual(fake.filters, expectedFilters);
  for (const [crop, column] of [["poster", "artwork_poster_url"], ["banner", "artwork_banner_url"]] as const) {
    const other = store();
    assert.deepEqual(await setScheduledArtwork("church", "service", crop, null, other.client), { ok: true });
    assert.deepEqual(other.writes, [{ [column]: null }]);
  }
});

test("a service going live, missing ownership or database errors fail the artwork write safely", async () => {
  for (const options of [{ missing: true }, { error: true }]) {
    const fake = store(options);
    const result = await setScheduledArtwork("church", "service", "poster", null, fake.client);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.match(result.error, /still upcoming/);
      assert.doesNotMatch(result.error, /private database/);
    }
    assert.deepEqual(fake.filters, expectedFilters);
  }
});
