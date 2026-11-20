import assert from "node:assert/strict";
import test from "node:test";

import { queueGuardianAlert } from "@/lib/checkin/guardian-service";
import { buildApnsPayload, buildFcmPayload, type PushAdapter, type PushMessage } from "@/lib/faithform/push/adapters";
import { deliverNotificationNow } from "@/lib/faithform/push/outbox";

/**
 * A guardian alert used to wait in the outbox for the next cron pass (every two
 * minutes), so parents saw it in the open app before any push arrived. It is
 * now sent in the same request, with the outbox kept as the retry path.
 */

type Row = Record<string, unknown>;

function database() {
  const tables: Record<string, Row[]> = {
    churches: [{ id: "church", slug: "grace", timezone: "America/New_York" }],
    church_features: [],
    visitor_accounts: [{ id: "a1", status: "active" }, { id: "outsider", status: "active" }],
    visitor_church_relationships: ["a1", "outsider"].map(account_id => ({ church_id: "church", account_id, state: "joined" })),
    visitor_people_links: [{ account_id: "a1", member_id: "g1", church_id: "church", is_active: true }],
    household_members: [
      { id: "hm1", household_id: "family", church_id: "church", member_id: "g1", relationship: "guardian" },
      { id: "hm3", household_id: "family", church_id: "church", member_id: "kid", relationship: "dependent" },
    ],
    checkin_sessions: [{ id: "session", church_id: "church", household_id: "family", member_id: "kid", status: "checked_in" }],
    notification_outbox: [],
    notification_delivery_attempts: [],
    visitor_device_installations: ["a1", "outsider"].map(account_id => ({ id: `install-${account_id}`, account_id, provider: "apns", provider_token: `token-${account_id}`, apns_environment: "production", is_enabled: true, invalidated_at: null })),
  };
  const calls: { name: string; args: Row }[] = [];
  const client = {
    from(table: string) {
      const filters: ((row: Row) => boolean)[] = [];
      let patch: Row | null = null;
      const run = () => {
        const matched = (tables[table] ?? []).filter(row => filters.every(keep => keep(row)));
        if (patch) for (const row of matched) Object.assign(row, patch);
        return { data: matched.map(row => ({ ...row })), error: null };
      };
      const builder = {
        select: () => builder, order: () => builder, limit: () => builder, range: () => builder,
        eq: (key: string, value: unknown) => (filters.push(row => row[key] === value), builder),
        is: (key: string, value: unknown) => (filters.push(row => (row[key] ?? null) === value), builder),
        in: (key: string, values: unknown[]) => (filters.push(row => values.includes(row[key])), builder),
        update: (values: Row) => ((patch = values), builder),
        maybeSingle: async () => ({ data: run().data[0] ?? null, error: null }),
        insert: async (row: Row) => { tables[table].push(row); return { data: row, error: null }; },
        then: (resolve: (result: unknown) => unknown) => resolve(run()),
      };
      return builder;
    },
    async rpc(name: string, args: Row) {
      calls.push({ name, args });
      if (name === "queue_checkin_guardian_alert") {
        tables.notification_outbox.push({
          id: "job", church_id: args.p_church_id, kind: "checkin_guardian_alert", subject_type: "checkin_session", subject_id: args.p_session_id,
          target_visibility: "members", target_account_ids: args.p_account_ids, topic: "checkin",
          title: "Please come to Kids Check in", body: "Your child needs a guardian. Open Kids Check in for the room details.",
          deep_link: args.p_deep_link, collapse_key: `checkin-alert-${args.p_session_id}`, dedupe_key: args.p_dedupe_key,
          correlation_id: "c", subject_version: 0, status: "pending", attempts: 0, max_attempts: 5, next_attempt_at: new Date(0).toISOString(),
        });
        return { data: true, error: null };
      }
      if (name === "complete_notification_job") {
        const job = tables.notification_outbox.find(row => row.id === args.p_id && row.lease_token === args.p_lease_token);
        if (job) Object.assign(job, { status: args.p_outcome === "sent" ? "sent" : args.p_outcome === "cancelled" ? "cancelled" : "pending", lease_token: null });
        return { data: Boolean(job), error: null };
      }
      return { data: null, error: null };
    },
  };
  return { tables, calls, rpc: client.rpc.bind(client), client: client as never };
}

function apns(outcome: "sent" | "retryable" = "sent") {
  const sent: { token: string; message: PushMessage }[] = [];
  const adapter: PushAdapter = { provider: "apns", isConfigured: () => true, send: async (token, message) => { sent.push({ token, message }); return { outcome }; } };
  return { adapter, sent };
}

test("a guardian alert is pushed in the same request, only to the verified guardian", async () => {
  const db = database();
  const { adapter, sent } = apns();
  assert.deepEqual(await queueGuardianAlert("church", "session", "staff", db.client, { adapters: { apns: adapter } }), { queued: true, guardianCount: 1 });
  assert.deepEqual(sent.map(row => row.token), ["token-a1"]);
  assert.equal(sent[0].message.urgent, true);
  assert.equal(sent[0].message.topic, "checkin");
  assert.equal(db.tables.notification_outbox[0].status, "sent");
  // No child name or room in the lock-screen text.
  assert.equal(/Sam|Nursery/.test(`${sent[0].message.title} ${sent[0].message.body}`), false);
});

test("a provider failure leaves the alert in the outbox for the worker to retry", async () => {
  const db = database();
  const { adapter } = apns("retryable");
  assert.equal((await queueGuardianAlert("church", "session", "staff", db.client, { adapters: { apns: adapter } })).queued, true);
  assert.equal(db.tables.notification_outbox[0].status, "pending");
  assert.ok(db.calls.some(call => call.name === "complete_notification_job" && call.args.p_outcome === "retryable"));
});

test("an alert already claimed by the worker is not sent a second time", async () => {
  const db = database();
  const { adapter, sent } = apns();
  await db.rpc("queue_checkin_guardian_alert", { p_church_id: "church", p_session_id: "session", p_account_ids: ["a1"], p_deep_link: "faithform://church/grace/check-in", p_dedupe_key: "k" });
  Object.assign(db.tables.notification_outbox[0], { status: "claimed", lease_token: "worker", attempts: 1 });
  const result = await deliverNotificationNow("job", { client: db.client, adapters: { apns: adapter } });
  assert.equal(result.claimed, 0);
  assert.deepEqual(sent, []);
});

test("an immediate send still cancels when the child was already picked up", async () => {
  const db = database();
  const { adapter, sent } = apns();
  await db.rpc("queue_checkin_guardian_alert", { p_church_id: "church", p_session_id: "session", p_account_ids: ["a1"], p_deep_link: "faithform://church/grace/check-in", p_dedupe_key: "k" });
  db.tables.checkin_sessions[0].status = "checked_out";
  const result = await deliverNotificationNow("job", { client: db.client, adapters: { apns: adapter } });
  assert.equal(result.cancelled, 1);
  assert.deepEqual(sent, []);
});

test("urgent alerts are time-sensitive on iOS and max priority on Android; others are unchanged", () => {
  const base = { title: "T", body: "B", deepLink: "faithform://church/grace/check-in", collapseKey: "k", correlationId: "c", topic: "checkin" as const };
  const urgentApns = buildApnsPayload({ ...base, urgent: true }) as { aps: Record<string, unknown> };
  assert.equal(urgentApns.aps["interruption-level"], "time-sensitive");
  assert.equal(urgentApns.aps.sound, "default");
  assert.equal("interruption-level" in (buildApnsPayload(base) as { aps: Record<string, unknown> }).aps, false);
  const urgentFcm = buildFcmPayload("t", { ...base, urgent: true }) as { message: { notification: unknown; android: { priority: string; notification: Record<string, unknown> } } };
  assert.ok(urgentFcm.message.notification, "a visible notification block, not data-only");
  assert.equal(urgentFcm.message.android.priority, "HIGH");
  assert.equal(urgentFcm.message.android.notification.channel_id, "faithform_checkin");
  assert.equal(urgentFcm.message.android.notification.notification_priority, "PRIORITY_MAX");
  const plainFcm = buildFcmPayload("t", base) as { message: { android: { notification: Record<string, unknown> } } };
  assert.equal("notification_priority" in plainFcm.message.android.notification, false);
});
