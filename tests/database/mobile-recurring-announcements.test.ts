import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { suiteOptions, withChurch } from "./groups-fixtures";

test("mobile recurring events retain UUID detail links and member visibility", suiteOptions, async () => {
  await withChurch(async (client, church) => {
    const parent = randomUUID();
    const active = randomUUID();
    const cancelled = randomUUID();
    await client.query(
      `insert into public.announcements
        (id, church_id, event_title, title, status, is_ready, start_at, mobile_visibility,
         is_recurring, recurrence_rule, recurrence_until)
       values ($1, $2, 'Weekly event', 'Weekly event', 'published', true, '2027-01-02T10:00Z',
         'members', true, 'FREQ=WEEKLY;UNTIL=2027-01-09', '2027-01-09')`,
      [parent, church.id],
    );
    await client.query(
      `insert into public.announcement_occurrences
        (id, church_id, announcement_id, occurrence_date, start_at, status, title)
       values ($1, $3, $4, '2027-01-02', '2027-01-02T10:00Z', 'active', 'Edited event'),
              ($2, $3, $4, '2027-01-09', '2027-01-09T10:00Z', 'cancelled', null)`,
      [active, cancelled, church.id, parent],
    );
    const now = "2027-01-01T00:00Z";
    for (const signature of [
      "mobile_announcement_feed(text,text,boolean,timestamptz,uuid,integer,timestamptz)",
      "mobile_announcement_schedule(text,text,timestamptz,timestamptz,timestamptz)",
      "mobile_announcement_detail(text,uuid,text,timestamptz)",
    ]) {
      for (const role of ["anon", "authenticated", "service_role"]) {
        const result = await client.query("select has_function_privilege($1, $2, 'EXECUTE') as allowed", [role, `public.${signature}`]);
        assert.equal(result.rows[0].allowed, role === "service_role");
      }
    }
    const feed = await client.query(
      "select id, title from public.mobile_announcement_feed($1, $2, null, null, null, 20, $3)",
      [church.slug, "joined", now],
    );
    assert.deepEqual(feed.rows, [{ id: active, title: "Edited event" }]);
    const calendar = await client.query(
      "select id from public.mobile_announcement_schedule($1, 'joined', $2, '2027-02-01', $2)",
      [church.slug, now],
    );
    assert.deepEqual(calendar.rows, [{ id: active }]);
    for (const [id, relationship, expected] of [
      [active, "joined", [{ id: active, title: "Edited event" }]],
      [active, "following", []],
      [cancelled, "joined", []],
    ] as const) {
      const detail = await client.query(
        "select id, title from public.mobile_announcement_detail($1, $2, $3, $4)",
        [church.slug, id, relationship, now],
      );
      assert.deepEqual(detail.rows, expected);
    }
  });
});

test("group announcement jobs require explicit recipients and preserve existing group jobs", suiteOptions, async () => {
  await withChurch(async (client, church) => {
    const addJob = (kind: string, topic: string, subject: string, recipients: string[] | null) =>
      client.query(
        `insert into public.notification_outbox
          (church_id, kind, topic, subject_type, subject_id, target_visibility,
           target_account_ids, title, deep_link, collapse_key, dedupe_key)
         values ($1, $2, $3, $4, $5, 'members', $6, 'Test', 'faithform://test', 'test', $7)`,
        [church.id, kind, topic, subject, randomUUID(), recipients, randomUUID()],
      );
    const recipients = [randomUUID()];
    await addJob("group_announcement", "groups", "group", recipients);
    await addJob("group_join_requested", "groups", "group_join_request", recipients);
    await addJob("recording_published", "events", "stream_recording", null);
    await assert.rejects(addJob("group_announcement", "groups", "group", null), /notification_outbox_target_shape_check/);
    await assert.rejects(addJob("group_announcement", "events", "group", null), /notification_outbox_target_shape_check/);
    await assert.rejects(addJob("group_announcement", "groups", "group_event", recipients), /notification_outbox_target_shape_check/);
  });
});

test("the recordings bucket is private with a bounded upload size", suiteOptions, async () => {
  await withChurch(async (client) => {
    const { rows } = await client.query(
      "select public, file_size_limit::text from storage.buckets where id = 'stream-recordings'",
    );
    assert.deepEqual(rows, [{ public: false, file_size_limit: "5368709120" }]);
  });
});
