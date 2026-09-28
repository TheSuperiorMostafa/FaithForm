import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";

import { listEmailQueue } from "@/lib/announcements/email-queue";
import { listStandaloneEmailRows } from "@/lib/announcements/weekly-email";

test("draft queue read rejects a database error instead of claiming it is empty", async () => {
  const query = {
    eq: () => query,
    order: async () => ({ data: null, error: { message: "database unavailable" } }),
  };
  const client = { from: () => ({ select: () => query }) } as unknown as SupabaseClient;

  await assert.rejects(listEmailQueue("church", "2026-09-21", client, true), /queue read failed/);
});

test("draft standalone read rejects a database error instead of omitting announcements", async () => {
  const query = {
    eq: () => query,
    is: async () => ({ data: null, error: { message: "database unavailable" } }),
  };
  const client = { from: () => ({ select: () => query }) } as unknown as SupabaseClient;

  await assert.rejects(listStandaloneEmailRows("church", client, true), /announcements read failed/);
});
