import assert from "node:assert/strict";
import test from "node:test";
import { guardianAccountIds, kidsCheckIn, notifyHouseholdCode, queueGuardianAlert } from "@/lib/checkin/guardian-service";
import { runNotificationWorker } from "@/lib/faithform/push/outbox";
import { serviceWeekStart } from "@/lib/checkin/service-week";

type Row = Record<string, unknown>;
function database() {
  const tables: Record<string, Row[]> = {
    churches: [{ id: "church", slug: "grace", timezone: "America/New_York" }], church_features: [],
    visitor_accounts: [{ id: "a1", user_id: "u1", status: "active" }, { id: "a2", user_id: "u2", status: "active" }, { id: "outsider", user_id: "u3", status: "active" }],
    visitor_church_relationships: ["a1", "a2", "outsider"].map(account_id => ({ church_id: "church", account_id, state: "joined" })),
    visitor_people_links: [{ account_id: "a1", member_id: "g1", church_id: "church", is_active: true }, { account_id: "a2", member_id: "g2", church_id: "church", is_active: true }],
    household_members: [
      { id: "hm1", household_id: "family", church_id: "church", member_id: "g1", relationship: "guardian", households: { id: "family", name: "Family" } },
      { id: "hm2", household_id: "family", church_id: "church", member_id: "g2", relationship: "guardian", households: { id: "family", name: "Family" } },
      { id: "hm3", household_id: "family", church_id: "church", member_id: "kid", relationship: "dependent" },
    ],
    households: [{ id: "family", church_id: "church", code_rotation: 0 }],
    household_checkout_codes: [{ id: "code", household_id: "family", church_id: "church", week_start: serviceWeekStart("America/New_York"), code: "123456", revoked_at: null }],
    checkin_sessions: [{ id: "session", church_id: "church", household_id: "family", member_id: "kid", status: "checked_in", checked_in_at: new Date().toISOString(), members: { first_name: "Sam", last_name: "Doe" }, church_locations: { name: "Nursery" } }],
    checkin_guardian_alerts: [], notification_outbox: [], notification_delivery_attempts: [],
    visitor_device_installations: ["a1", "a2", "outsider"].map(account_id => ({ id: account_id, account_id, provider: "apns", provider_token: account_id, is_enabled: true, invalidated_at: null })),
  };
  const calls: { name: string; args: Row }[] = [];
  const client = { from(table: string) {
    const filters: ((row: Row) => boolean)[] = [];
    const run = () => ({ data: (tables[table] ?? []).filter(row => filters.every(f => f(row))), error: null });
    const builder = {
      select: () => builder, order: () => builder, limit: () => builder, range: () => builder,
      eq: (key: string, value: unknown) => (filters.push(row => row[key] === value), builder),
      is: (key: string, value: unknown) => (filters.push(row => (row[key] ?? null) === value), builder),
      in: (key: string, values: unknown[]) => (filters.push(row => values.includes(row[key])), builder),
      maybeSingle: async () => ({ data: run().data[0] ?? null, error: null }),
      insert: async (row: Row) => { tables[table].push(row); return { data: row, error: null }; },
      then: (resolve: (result: unknown) => unknown) => resolve(run()),
    };
    return builder;
  }, async rpc(name: string, args: Row) {
    calls.push({ name, args });
    return { data: name === "claim_notification_jobs" ? tables.notification_outbox : true, error: null };
  } };
  return { tables, calls, client: client as never };
}

function alertJob(overrides: Row = {}): Row {
  return { id: "job", church_id: "church", subject_type: "checkin_session", subject_id: "session", kind: "checkin_guardian_alert", target_account_ids: ["a1", "a2"], topic: "checkin", title: "Kids Check in", body: "Please come", deep_link: "faithform://church/grace/check-in", collapse_key: "session", correlation_id: "c", subject_version: 1, attempts: 1, ...overrides };
}

test("every verified guardian receives access; revoked links and non-guardians do not", async () => {
  const db = database();
  assert.deepEqual(await guardianAccountIds("church", "family", db.client), ["a1", "a2"]);
  db.tables.visitor_people_links[1].is_active = false;
  assert.deepEqual(await guardianAccountIds("church", "family", db.client), ["a1"]);
  assert.deepEqual(await guardianAccountIds("other-church", "family", db.client), []);
});

test("both guardians see the same household code and only current dependent children", async () => {
  const db = database();
  const first = await kidsCheckIn("u1", "grace", db.client);
  const second = await kidsCheckIn("u2", "grace", db.client);
  assert.equal(first.households[0].pickupCode, "123456");
  assert.deepEqual(first, second);
  assert.equal(first.households[0].children[0].name, "Sam Doe");
  db.tables.household_members = db.tables.household_members.filter(row => row.relationship !== "dependent");
  assert.deepEqual((await kidsCheckIn("u1", "grace", db.client)).households[0].children, []);
  assert.deepEqual(await kidsCheckIn("u3", "grace", db.client), { households: [] });
});

test("blocked or inactive account cannot fetch household credentials", async () => {
  const db = database();
  db.tables.visitor_church_relationships[0].state = "blocked";
  await assert.rejects(kidsCheckIn("u1", "grace", db.client), /Church not found/);
  db.tables.visitor_accounts[1].status = "deleted";
  await assert.rejects(kidsCheckIn("u2", "grace", db.client), /not active/);
});

test("availability push names every guardian and never contains the pickup credential", async () => {
  const db = database();
  assert.equal(await notifyHouseholdCode("church", "family", db.client), true);
  assert.deepEqual(db.tables.notification_outbox.map(row => row.target_account_ids), [["a1"], ["a2"]]);
  assert.equal(JSON.stringify(db.tables.notification_outbox).includes("123456"), false);
});

test("alert enqueue calls one atomic RPC and refuses checked-out children", async () => {
  const db = database();
  assert.deepEqual(await queueGuardianAlert("church", "session", "staff", db.client), { queued: true, guardianCount: 2 });
  assert.equal(db.calls[0].name, "queue_checkin_guardian_alert");
  assert.deepEqual(db.calls[0].args.p_account_ids, ["a1", "a2"]);
  db.tables.checkin_sessions[0].status = "checked_out";
  assert.deepEqual(await queueGuardianAlert("church", "session", "staff", db.client), { queued: false, guardianCount: 0 });
  assert.equal(db.calls.length, 1);
});

test("delivery rechecks custody and never expands a private alert to church followers", async () => {
  const db = database();
  db.tables.notification_outbox.push(alertJob());
  db.tables.household_members = db.tables.household_members.filter(row => row.member_id !== "g2");
  const sent: string[] = [];
  await runNotificationWorker({ client: db.client, adapters: { apns: { provider: "apns", isConfigured: () => true, send: async token => { sent.push(token); return { outcome: "sent" }; } } } });
  assert.deepEqual(sent, ["a1"]);
  db.tables.notification_outbox = [alertJob({ target_account_ids: [] })];
  sent.length = 0;
  await runNotificationWorker({ client: db.client, adapters: { apns: { provider: "apns", isConfigured: () => true, send: async token => { sent.push(token); return { outcome: "sent" }; } } } });
  assert.deepEqual(sent, []);
});

test("pickup cancels a pending child alert; moved dependents receive no delivery", async () => {
  const db = database();
  db.tables.notification_outbox.push(alertJob());
  db.tables.checkin_sessions[0].status = "checked_out";
  const result = await runNotificationWorker({ client: db.client });
  assert.equal(result.cancelled, 1);
  db.tables.checkin_sessions[0].status = "checked_in";
  db.tables.household_members = db.tables.household_members.filter(row => row.relationship !== "dependent");
  const sent: string[] = [];
  await runNotificationWorker({ client: db.client, adapters: { apns: { provider: "apns", isConfigured: () => true, send: async token => { sent.push(token); return { outcome: "sent" }; } } } });
  assert.deepEqual(sent, []);
});

test("disabled Kids Check in exposes no household code and resolves no push audience", async () => {
  const db = database();
  db.tables.church_features.push({ church_id: "church", feature_key: "checkin", enabled: false });
  assert.deepEqual(await kidsCheckIn("u1", "grace", db.client), { households: [] });
  assert.deepEqual(await guardianAccountIds("church", "family", db.client), []);
});
