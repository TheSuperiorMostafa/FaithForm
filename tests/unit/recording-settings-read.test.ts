import assert from "node:assert/strict";
import test from "node:test";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  createSupabaseRecordingRepo,
  DEFAULT_RECORDING_SETTINGS,
} from "@/lib/stream/recording-repo";

function settingsClient(result: { data: null; error: { message: string } | null }): SupabaseClient {
  const query = {
    select: () => query,
    eq: () => query,
    maybeSingle: async () => result,
  };
  return {
    from: (table: string) => {
      assert.equal(table, "stream_recording_settings");
      return query;
    },
  } as unknown as SupabaseClient;
}

test("recording settings read errors cannot masquerade as default publication choices", async () => {
  const repo = createSupabaseRecordingRepo(settingsClient({
    data: null,
    error: { message: "database unavailable" },
  }));

  await assert.rejects(repo.getSettings("church-a"), /Could not load recording settings/);
});

test("a church without a settings row still receives safe defaults", async () => {
  const repo = createSupabaseRecordingRepo(settingsClient({ data: null, error: null }));

  assert.deepEqual(await repo.getSettings("church-a"), DEFAULT_RECORDING_SETTINGS);
});
