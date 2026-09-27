import assert from "node:assert/strict";
import test from "node:test";

import { asUser, group, one, staffUser, suiteOptions, withChurch, type Client } from "./groups-fixtures";

const firstStart = "2026-10-01T22:00:00Z";
const firstEnd = "2026-10-01T23:00:00Z";
const movedStart = "2026-10-02T22:00:00Z";
const movedEnd = "2026-10-02T23:00:00Z";

async function update(
  client: Client,
  ids: { church: string; group: string; event: string; staff: string },
  values: { title?: string; start?: string; end?: string } = {},
) {
  return one<{ outcome: string }>(
    client,
    `select public.update_group_gathering(
      $1, $2, $3, $4, 'staff', $5, null, $6, $7,
      'America/New_York', null, null, null
    ) as outcome`,
    [ids.church, ids.group, ids.event, ids.staff, values.title ?? "Moved meeting", values.start ?? movedStart, values.end ?? movedEnd],
  );
}

test("gathering, attendance window, and audit save together or roll back together", suiteOptions, async () => {
  await withChurch(async (client, church) => {
    const groupId = await group(client, church.id);
    const staff = await staffUser(client, church.id);
    const event = await one<{ id: string }>(client,
      `insert into public.group_events (church_id, group_id, title, starts_at, ends_at, timezone)
       values ($1, $2, 'Original meeting', $3, $4, 'America/New_York') returning id`,
      [church.id, groupId, firstStart, firstEnd]);
    const ids = { church: church.id, group: groupId, event: event.id, staff };
    const occurrence = await one<{ id: string }>(client,
      `select public.ensure_group_event_occurrence($1, $2, $3) as id`,
      [event.id, church.id, staff]);

    await client.query("begin");
    try {
      await client.query("set local role service_role");
      assert.equal((await update(client, ids)).outcome, "updated");
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    }
    const changed = await one<{ title: string; starts_at: Date; local_service_date: Date; occurrence_start: Date; opens: Date; audits: string }>(client,
      `select e.title, e.starts_at, o.local_service_date, o.starts_at_utc as occurrence_start,
              o.checkin_opens_at_utc as opens,
              (select count(*)::text from public.group_audit_events where group_id = $2 and action = 'event_updated') as audits
         from public.group_events e join public.service_occurrences o on o.group_event_id = e.id
        where e.id = $1`, [event.id, groupId]);
    assert.equal(changed.title, "Moved meeting");
    assert.equal(changed.starts_at.toISOString(), "2026-10-02T22:00:00.000Z");
    assert.equal(changed.occurrence_start.toISOString(), changed.starts_at.toISOString());
    assert.equal(changed.opens.toISOString(), "2026-10-01T22:00:00.000Z");
    assert.equal(changed.audits, "1");

    await client.query("begin");
    try {
      await client.query(`create function pg_temp.fail_group_occurrence_update() returns trigger language plpgsql as
        'begin raise exception ''injected occurrence failure''; end'`);
      await client.query(`create trigger fail_group_occurrence_update before update on public.service_occurrences
        for each row execute function pg_temp.fail_group_occurrence_update()`);
      await assert.rejects(update(client, ids, { title: "Must roll back", start: firstStart, end: firstEnd }), /injected occurrence failure/);
    } finally {
      await client.query("rollback");
    }
    const afterFailure = await one<{ title: string; starts_at: Date; audits: string }>(client,
      `select title, starts_at,
              (select count(*)::text from public.group_audit_events where group_id = $2 and action = 'event_updated') as audits
         from public.group_events where id = $1`, [event.id, groupId]);
    assert.equal(afterFailure.title, "Moved meeting");
    assert.equal(afterFailure.starts_at.toISOString(), "2026-10-02T22:00:00.000Z");
    assert.equal(afterFailure.audits, "1");

    // A zero-attendee submission still freezes the schedule as attendance history.
    await client.query(`insert into public.group_attendance_records
      (event_id, church_id, group_id, occurrence_id) values ($1, $2, $3, $4)`,
      [event.id, church.id, groupId, occurrence.id]);
    assert.equal((await update(client, ids, { start: firstStart, end: firstEnd })).outcome, "attendance_locked");
    assert.equal((await update(client, ids, { title: "Details may change", start: movedStart, end: movedEnd })).outcome, "updated");

    const otherGroup = await group(client, church.id);
    assert.equal((await update(client, { ...ids, group: otherGroup })).outcome, "not_found");
    await asUser(client, staff, async () => {
      await assert.rejects(update(client, ids), (error: unknown) => (error as { code?: string }).code === "42501");
    });
  });
});
