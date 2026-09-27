import assert from "node:assert/strict";
import test from "node:test";

import { omitMissingOptionalTakedownColumn } from "@/lib/announcements/takedown-fallback";

test("an older database without Facebook scheduling still records a recoverable takedown", () => {
  const patch = {
    status: "pending",
    facebook_scheduled_publish_time: null,
    unsubmitted_at: "2026-09-27T18:00:00.000Z",
    unsubmitted_by: "qa-admin",
  };
  const retry = omitMissingOptionalTakedownColumn(
    patch,
    "Could not find the 'facebook_scheduled_publish_time' column of 'announcements' in the schema cache",
  );

  assert.deepEqual(retry, {
    status: "pending",
    unsubmitted_at: patch.unsubmitted_at,
    unsubmitted_by: patch.unsubmitted_by,
  });
  assert.deepEqual(
    omitMissingOptionalTakedownColumn(retry!, "Could not find the 'unsubmitted_by' column"),
    { status: "pending", unsubmitted_at: patch.unsubmitted_at },
  );
});

test("an absent takedown timestamp cannot be silently ignored", () => {
  const patch = { status: "pending", unsubmitted_at: "2026-09-27T18:00:00.000Z" };
  assert.equal(
    omitMissingOptionalTakedownColumn(patch, "Could not find the 'unsubmitted_at' column"),
    null,
  );
});
