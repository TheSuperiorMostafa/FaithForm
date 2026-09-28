import assert from "node:assert/strict";
import test from "node:test";

import type { SupabaseClient } from "@supabase/supabase-js";

import { getActiveSession } from "../../lib/attendance/v2/checkin-session";

test("a failed active-display read is not mistaken for a stopped screen", async () => {
  const failure = new Error("forced session read failure");
  const builder = {
    select() { return this; },
    eq() { return this; },
    async maybeSingle() { return { data: null, error: failure }; },
  };
  const client = {
    from(table: string) {
      assert.equal(table, "attendance_checkin_sessions");
      return builder;
    },
  } as unknown as SupabaseClient;

  await assert.rejects(
    getActiveSession({
      occurrenceId: "d1d65673-2d45-4825-9e6e-c2d85d4583fd",
      churchId: "ffde855b-e97a-499f-aa75-d2fab09382b8",
      client,
    }),
    (error: unknown) => error === failure,
  );
});
