import assert from "node:assert/strict";
import test from "node:test";

import type { SupabaseClient } from "@supabase/supabase-js";

import { isPublicFeatureEnabled } from "../../lib/features/public-access";

function clientWith(result: { data: { enabled: boolean } | null; error: Error | null }) {
  const builder = {
    select() { return this; },
    eq() { return this; },
    async maybeSingle() { return result; },
  };
  return { from: () => builder } as unknown as SupabaseClient;
}

test("a public feature opt-out cannot be bypassed by a failed flag read", async () => {
  assert.equal(await isPublicFeatureEnabled("church", "website", null), false);

  const originalError = console.error;
  console.error = () => undefined;
  try {
    assert.equal(
      await isPublicFeatureEnabled("church", "website", clientWith({ data: null, error: new Error("read failed") })),
      false,
    );
  } finally {
    console.error = originalError;
  }

  assert.equal(
    await isPublicFeatureEnabled("church", "website", clientWith({ data: { enabled: false }, error: null })),
    false,
  );
  assert.equal(
    await isPublicFeatureEnabled("church", "website", clientWith({ data: { enabled: true }, error: null })),
    true,
  );
  assert.equal(
    await isPublicFeatureEnabled("church", "website", clientWith({ data: null, error: null })),
    true,
  );
});
