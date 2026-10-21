import assert from "node:assert/strict";
import test from "node:test";
import { emptyStaffPreferences, newlyAvailableAttendancePeriods } from "@/lib/notifications/staff-preferences";
import { dispatchStaffNotifications, queueStaffNotification } from "@/lib/notifications/staff";
import { visibleSettingsTabs } from "@/components/settings/settings-tabs-config";

type Row = Record<string, unknown>;
function database() {
  const prefs = emptyStaffPreferences();
  prefs.events.attendance_completed.email = true;
  const tables: Record<string, Row[]> = { staff_notification_preferences: [{ church_id: "church", user_id: "user", ...prefs }], church_users: [{ church_id: "church", user_id: "user", role: "admin", feature_permissions: [] }], church_features: [], staff_notification_jobs: [] };
  const writes: Row[] = [];
  const user = { email: "person@example.test", email_confirmed_at: null as string | null };
  const client = {
    from(table: string) {
      const filters: ((row: Row) => boolean)[] = [];
      let changes: Row | null = null;
      const run = () => { const rows = tables[table].filter(row => filters.every(filter => filter(row))); if (changes) for (const row of rows) Object.assign(row, changes); return { data: rows, error: null }; };
      const builder = {
        select: () => builder,
        eq: (key: string, value: unknown) => { filters.push(row => row[key] === value); return builder; },
        update: (value: Row) => { changes = value; return builder; },
        upsert: async (rows: Row[], options: Row) => { writes.push({ rows, options }); return { error: null }; },
        maybeSingle: async () => ({ data: run().data[0] ?? null, error: null }),
        then: (resolve: (value: unknown) => unknown) => resolve(run()),
      };
      return builder;
    },
    rpc: async () => ({ data: tables.staff_notification_jobs, error: null }),
    auth: { admin: { getUserById: async () => ({ data: { user }, error: null }) } },
  };
  const job = (overrides: Row = {}) => ({ id: "job", church_id: "church", user_id: "user", event: "attendance_completed", channel: "email", href: "/dashboard/attendance", created_at: new Date().toISOString(), attempts: 1, status: "sending", ...overrides });
  return { tables, writes, user, client: client as never, job };
}

test("notification choices default off and are visible to staff with relevant access", () => {
  assert.equal(Object.values(emptyStaffPreferences().events).some(event => event.email || event.phone), false);
  assert.ok(visibleSettingsTabs({ isAdmin: false, allowedFeatures: ["attendance"] }).includes("notifications"));
  assert.ok(!visibleSettingsTabs({ isAdmin: true, allowedFeatures: ["giving"] }).includes("notifications"));
});
test("report notifications follow church midnight and year/quarter boundaries", () => {
  assert.deepEqual(newlyAvailableAttendancePeriods("America/New_York", new Date("2027-01-01T04:59:00Z")), []);
  assert.deepEqual(newlyAvailableAttendancePeriods("America/New_York", new Date("2027-01-01T05:00:00Z")), ["2026-12", "2026-Q4", "2026"]);
  assert.deepEqual(newlyAvailableAttendancePeriods("UTC", new Date("2026-04-01T00:00:00Z")), ["2026-03", "2026-Q1"]);
});
test("queue creates only opted-in channels and scopes deduplication to church, user and event", async () => {
  const db = database();
  await queueStaffNotification({ churchId: "church", event: "attendance_completed", eventKey: "2026-10-18", href: "/dashboard/attendance/2026-10-18" }, db.client);
  assert.deepEqual((db.writes[0].rows as Row[]).map(row => row.channel), ["email"]);
  assert.equal((db.writes[0].rows as Row[])[0].church_id, "church");
  assert.equal((db.writes[0].options as Row).ignoreDuplicates, true);
  await queueStaffNotification({ churchId: "other", event: "attendance_completed", eventKey: "same", href: "/dashboard/attendance" }, db.client);
  assert.equal(db.writes.length, 1);
});
test("delivery skips removed staff, opted-out recipients, stale events and unverified email", async () => {
  for (const scenario of ["removed", "optout", "stale", "unverified", "feature_off", "no_grant"] as const) {
    const db = database();
    db.tables.staff_notification_jobs.push(db.job(scenario === "stale" ? { created_at: "2020-01-01" } : {}));
    if (scenario === "removed") db.tables.church_users = [];
    if (scenario === "optout") db.tables.staff_notification_preferences[0].events = emptyStaffPreferences().events;
    if (scenario === "feature_off") db.tables.church_features.push({ church_id: "church", feature_key: "attendance", enabled: false });
    if (scenario === "no_grant") db.tables.church_users[0].role = "viewer";
    assert.deepEqual(await dispatchStaffNotifications(db.client), { sent: 0, failed: 0, skipped: 1 }, scenario);
    assert.equal(db.tables.staff_notification_jobs[0].status, "skipped");
  }
});

test("email delivery uses the verified account, an idempotency key and a private dashboard link", async () => {
  const db = database();
  db.user.email_confirmed_at = new Date().toISOString();
  db.tables.staff_notification_jobs.push(db.job());
  const previousKey = process.env.RESEND_API_KEY;
  const previousFetch = globalThis.fetch;
  const requests: { url: string; init: RequestInit | undefined }[] = [];
  try {
    process.env.RESEND_API_KEY = "re_synthetic_notification_test";
    globalThis.fetch = async (url, init) => {
      requests.push({ url: String(url), init });
      return new Response(JSON.stringify({ id: "synthetic-email" }), { status: 200, headers: { "Content-Type": "application/json" } });
    };
    assert.deepEqual(await dispatchStaffNotifications(db.client), { sent: 1, failed: 0, skipped: 0 });
    assert.equal(requests.length, 1);
    assert.equal(new Headers(requests[0].init?.headers).get("Idempotency-Key"), "staff-notice-job");
    const body = JSON.parse(String(requests[0].init?.body));
    assert.equal(body.to, "person@example.test");
    assert.match(body.html, /dashboard\/attendance/);
    assert.equal(db.tables.staff_notification_jobs[0].status, "sent");
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = previousKey;
  }
});
