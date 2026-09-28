import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { asUser, one, suiteOptions, withChurch, type Client } from "./groups-fixtures";

const profile = (name: string) => ({
  name,
  denomination: "Other",
  phone: "555-010-0199",
  office_hours: {},
  announcement_facebook_post_time: "09:00",
  ai_knowledge: {},
});

async function save(
  client: Client,
  churchId: string,
  name: string,
  services: object[] = [],
  staff: object[] = [],
  events: object[] = [],
) {
  await client.query(
    "select public.save_church_profile($1, $2::jsonb, $3::jsonb, $4::jsonb, $5::jsonb)",
    [churchId, JSON.stringify(profile(name)), JSON.stringify(services), JSON.stringify(staff), JSON.stringify(events)],
  );
}

async function asServiceRole<T>(client: Client, work: () => Promise<T>): Promise<T> {
  await client.query("begin");
  try {
    await client.query("set local role service_role");
    const result = await work();
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
}

test("profile and child rows save together, with stable IDs on retry", suiteOptions, async () => {
  await withChurch(async (client, church) => {
    const serviceId = randomUUID();
    const staffId = randomUUID();
    const eventId = randomUUID();
    const services = [{ id: serviceId, label: "QA service", day_of_week: 0,
      start_time: "10:00", end_time: "11:00", kind: "regular", sort_order: 0 }];
    const staff = [{ id: staffId, full_name: "QA staff", is_senior_pastor: false,
      is_executive_pastor: false, ai_contact_priority: 0, is_public: true, sort_order: 0 }];
    const events = [{ id: eventId, name: "QA event", aliases: ["QA gathering"],
      is_active: true, sort_order: 0 }];

    await asServiceRole(client, () => save(client, church.id, "QA saved", services, staff, events));
    await asServiceRole(client, () => save(client, church.id, "QA saved", services, staff, events));
    const state = await one<{ name: string; service_count: string; staff_count: string; event_count: string }>(
      client,
      `select c.name,
        (select count(*)::text from public.church_service_times where church_id = c.id) as service_count,
        (select count(*)::text from public.church_staff where church_id = c.id) as staff_count,
        (select count(*)::text from public.church_recurring_events where church_id = c.id) as event_count
       from public.churches c where c.id = $1`, [church.id],
    );
    assert.deepEqual(state, { name: "QA saved", service_count: "1", staff_count: "1", event_count: "1" });

    await assert.rejects(
      asServiceRole(client, () => save(client, church.id, "Should roll back",
        [{ ...services[0], label: "Changed service" }],
        [{ ...staff[0], full_name: "Changed staff" }],
        [{ ...events[0], name: "" }])),
      /church_recurring_events_name_present/,
    );
    const after = await one<{ name: string; label: string; full_name: string; event_name: string }>(
      client,
      `select c.name, s.label, st.full_name, e.name as event_name
       from public.churches c
       join public.church_service_times s on s.church_id = c.id
       join public.church_staff st on st.church_id = c.id
       join public.church_recurring_events e on e.church_id = c.id
       where c.id = $1`, [church.id],
    );
    assert.deepEqual(after, {
      name: "QA saved", label: "QA service", full_name: "QA staff", event_name: "QA event",
    });

    await asUser(client, null, async () => {
      await assert.rejects(save(client, church.id, "Anon denied"),
        (error: unknown) => (error as { code?: string }).code === "42501");
    });
    await asUser(client, randomUUID(), async () => {
      await assert.rejects(save(client, church.id, "Member denied"),
        (error: unknown) => (error as { code?: string }).code === "42501");
    });
  });
});

test("profile save rejects another church's child ID and a removed row", suiteOptions, async () => {
  await withChurch(async (client, church) => {
    const otherChurchId = randomUUID();
    const otherStaffId = randomUUID();
    await client.query(
      "insert into public.churches (id, name, slug) values ($1, 'Other QA church', $2)",
      [otherChurchId, `profile-qa-${otherChurchId.slice(0, 8)}`],
    );
    try {
      await client.query(
        "insert into public.church_staff (id, church_id, full_name) values ($1, $2, 'Other staff')",
        [otherStaffId, otherChurchId],
      );
      const staff = [{ id: otherStaffId, full_name: "Wrong church", is_senior_pastor: false,
        is_executive_pastor: false, ai_contact_priority: 0, is_public: true, sort_order: 0 }];
      await assert.rejects(
        asServiceRole(client, () => save(client, church.id, "Must not save", [], staff)),
        /Staff entry belongs to another church/,
      );
      await assert.rejects(
        asServiceRole(client, () => save(client, church.id, "Must not save", [],
          [{ ...staff[0], id: randomUUID(), is_existing: true }])),
        /Staff entry changed since the form opened/,
      );
      const row = await one<{ own_name: string; other_staff: string }>(client,
        `select c.name as own_name,
          (select full_name from public.church_staff where id = $2) as other_staff
         from public.churches c where c.id = $1`, [church.id, otherStaffId]);
      assert.deepEqual(row, { own_name: "Groups Test Church", other_staff: "Other staff" });
    } finally {
      await client.query("delete from public.churches where id = $1", [otherChurchId]);
    }
  });
});
