import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";

import { requireChurchFeatureEmailEnabled } from "@/lib/features/access";
import { getAnnouncementEmailSettings } from "@/lib/queries/announcement-email-settings";

function singleRowClient(data: unknown, error: { message: string } | null = null): SupabaseClient {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({ maybeSingle: async () => ({ data, error }) }),
          maybeSingle: async () => ({ data, error }),
        }),
      }),
    }),
  } as unknown as SupabaseClient;
}

test("a disabled announcement email switch prevents delivery", async () => {
  assert.equal(
    await requireChurchFeatureEmailEnabled(
      "church",
      "announcements",
      singleRowClient({ emails_enabled: false }),
    ),
    false,
  );
});

test("a failed email-switch read cannot turn a disabled switch on", async () => {
  await assert.rejects(
    requireChurchFeatureEmailEnabled(
      "church",
      "announcements",
      singleRowClient(null, { message: "database unavailable" }),
    ),
    /Email permission check failed/,
  );
});

test("a failed settings read cannot substitute enabled defaults", async () => {
  await assert.rejects(
    getAnnouncementEmailSettings(
      "church",
      singleRowClient(null, { message: "database unavailable" }),
    ),
    /Weekly email settings read failed/,
  );
});
