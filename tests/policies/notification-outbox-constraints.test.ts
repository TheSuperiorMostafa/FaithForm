/**
 * Test notification_outbox constraint validation (migration 0149).
 * Security review: verify explicit per-kind target/topic/subject_type invariants.
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { createAdminClient } from "@/lib/supabase/admin";

describe("notification_outbox target_shape_check constraint", () => {
  const db = createAdminClient();

  // Valid combinations - should all succeed
  const validNotifications = [
    { kind: "announcement_published", topic: "announcements", subject_type: "announcement", target_account_ids: null },
    { kind: "event_published", topic: "announcements", subject_type: "announcement", target_account_ids: null },
    { kind: "service_live", topic: "streaming", subject_type: "stream_event", target_account_ids: null },
    { kind: "recording_published", topic: "streaming", subject_type: "stream_recording", target_account_ids: null },
    { kind: "group_join_requested", topic: "groups", subject_type: "group_join_request", target_account_ids: null },
    { kind: "group_request_approved", topic: "groups", subject_type: "group_join_request", target_account_ids: null },
    { kind: "group_event_cancelled", topic: "groups", subject_type: "group_event", target_account_ids: null },
    { kind: "group_message", topic: "groups", subject_type: "group_message", target_account_ids: null },
    { kind: "household_code_ready", topic: "checkin", subject_type: "household", target_account_ids: ["user-1"] },
    { kind: "checkin_guardian_alert", topic: "checkin", subject_type: "checkin_session", target_account_ids: ["user-1"] },
    { kind: "group_announcement", topic: "groups", subject_type: "group", target_account_ids: ["user-1"] },
  ];

  // Invalid combinations - should all fail
  const invalidNotifications = [
    { kind: "event_published", topic: "groups", subject_type: "announcement", target_account_ids: null, desc: "event_published with wrong topic" },
    { kind: "announcement_published", topic: "streaming", subject_type: "announcement", target_account_ids: null, desc: "announcement with streaming topic" },
    { kind: "service_live", topic: "announcements", subject_type: "stream_event", target_account_ids: null, desc: "service_live with wrong topic" },
    { kind: "group_join_requested", topic: "checkin", subject_type: "group_join_request", target_account_ids: null, desc: "group event with checkin topic" },
    { kind: "household_code_ready", topic: "checkin", subject_type: "household", target_account_ids: null, desc: "checkin without target_account_ids" },
    { kind: "group_announcement", topic: "groups", subject_type: "group", target_account_ids: null, desc: "group_announcement without target_account_ids" },
    { kind: "event_published", topic: "announcements", subject_type: "announcement", target_account_ids: ["user-1"], desc: "broadcast with target_account_ids" },
    { kind: "household_code_ready", topic: "groups", subject_type: "household", target_account_ids: ["user-1"], desc: "checkin kind with groups topic" },
  ];

  it("allows all valid kind/topic/subject_type combinations", async () => {
    for (const notification of validNotifications) {
      const { error } = await db.from("notification_outbox").insert({
        church_id: "00000000-0000-0000-0000-000000000000",
        kind: notification.kind,
        topic: notification.topic,
        subject_type: notification.subject_type,
        subject_id: "test-subject",
        target_account_ids: notification.target_account_ids,
        status: "pending",
        payload: {},
      });

      // Clean up on success
      if (!error) {
        await db.from("notification_outbox")
          .delete()
          .eq("subject_id", "test-subject")
          .eq("kind", notification.kind);
      }

      assert.equal(error, null, `Valid combination should succeed: ${notification.kind} + ${notification.topic}`);
    }
  });

  it("rejects mismatched kind/topic combinations", async () => {
    for (const notification of invalidNotifications) {
      const { error } = await db.from("notification_outbox").insert({
        church_id: "00000000-0000-0000-0000-000000000000",
        kind: notification.kind,
        topic: notification.topic,
        subject_type: notification.subject_type,
        subject_id: "test-invalid",
        target_account_ids: notification.target_account_ids,
        status: "pending",
        payload: {},
      });

      assert.ok(error, `Invalid combination should fail: ${notification.desc}`);
      assert.match(error.message, /notification_outbox_target_shape_check/, `Error should mention constraint for: ${notification.desc}`);
    }
  });

  it("validates target_account_ids cardinality (1-200)", async () => {
    // Empty array should fail
    const { error: emptyError } = await db.from("notification_outbox").insert({
      church_id: "00000000-0000-0000-0000-000000000000",
      kind: "household_code_ready",
      topic: "checkin",
      subject_type: "household",
      subject_id: "test-empty",
      target_account_ids: [],
      status: "pending",
      payload: {},
    });
    assert.ok(emptyError, "Empty target_account_ids should fail");

    // 201 items should fail
    const tooMany = Array.from({ length: 201 }, (_, i) => `user-${i}`);
    const { error: tooManyError } = await db.from("notification_outbox").insert({
      church_id: "00000000-0000-0000-0000-000000000000",
      kind: "household_code_ready",
      topic: "checkin",
      subject_type: "household",
      subject_id: "test-too-many",
      target_account_ids: tooMany,
      status: "pending",
      payload: {},
    });
    assert.ok(tooManyError, "More than 200 target_account_ids should fail");
  });
});
