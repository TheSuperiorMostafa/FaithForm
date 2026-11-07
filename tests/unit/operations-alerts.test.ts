import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";

import { operationsAlertRecipients, runOperationsMonitor, sendOperationsAlert, type OperationsAlertPayload } from "@/lib/operations/alerts";
import type { OperationsHealth } from "@/lib/operations/health";

const unhealthy: OperationsHealth = { ok: false, checkedAt: "2026-10-03T12:00:00.000Z",
  checks: [{ name: "payment_events_terminal", count: 3, ok: false },
    { name: "notifications_overdue", count: 0, ok: true }] };

function client(input: { claimed?: boolean; completion?: boolean; claimError?: boolean; claimErrorCode?: string } = {}) {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const db = { async rpc(name: string, args: Record<string, unknown>) {
    calls.push({ name, args });
    if (name === "claim_operations_alert") {
      return { data: input.claimed === false ? [] : [{ lease_token: args.p_claim_token,
        delivery_key: "delivery-fixed", alert_payload: args.p_payload }],
        error: input.claimErrorCode ? { code: input.claimErrorCode } : input.claimError ? new Error("private database error") : null };
    }
    assert.equal(name, "complete_operations_alert");
    return { data: input.completion ?? true, error: null };
  } } as unknown as SupabaseClient;
  return { db, calls };
}

test("monitor claims a redacted snapshot and sends with the durable delivery identity", async () => {
  const f = client();
  let sentPayload: OperationsAlertPayload | undefined;
  const result = await runOperationsMonitor({ health: unhealthy, client: f.db,
    sender: async ({ payload, deliveryKey }) => {
      sentPayload = payload;
      assert.equal(deliveryKey, "delivery-fixed");
      return true;
    } });
  assert.deepEqual(result, { healthy: false, failedChecks: 1, alert: "sent" });
  assert.deepEqual(sentPayload?.checks, [{ name: "payment_events_terminal", count: 3 }]);
  assert.equal(f.calls[1].args.p_sent, true);
  assert.equal(f.calls[1].args.p_claim_token, f.calls[0].args.p_claim_token);
});

test("healthy and suppressed runs never send email", async () => {
  for (const healthy of [true, false]) {
    const f = client({ claimed: false });
    const result = await runOperationsMonitor({ client: f.db,
      health: healthy ? { ok: true, checkedAt: unhealthy.checkedAt, checks: [] } : unhealthy,
      sender: async () => { assert.fail("unexpected email"); } });
    assert.equal(result.alert, healthy ? "healthy" : "suppressed");
    assert.equal(f.calls.length, 1);
    if (healthy) assert.equal(f.calls[0].args.p_fingerprint, null);
  }
});

test("email failure is completed as retryable and completion failures never claim success", async () => {
  const f = client();
  assert.equal((await runOperationsMonitor({ health: unhealthy, client: f.db,
    sender: async () => { throw new Error("private provider detail"); } })).alert, "deferred");
  assert.equal(f.calls[1].args.p_sent, false);
  await assert.rejects(runOperationsMonitor({ health: unhealthy, client: client({ completion: false }).db,
    sender: async () => true }), /operations_alert_completion_failed/);
  await assert.rejects(runOperationsMonitor({ health: unhealthy, client: client({ claimError: true }).db,
    sender: async () => { assert.fail("unclaimed alert must not send"); } }), /operations_alert_claim_failed/);
});

test("operations cron cannot send alerts before its claim migration is available", async () => {
  const f = client({ claimErrorCode: "PGRST202" });
  const result = await runOperationsMonitor({ health: unhealthy, client: f.db,
    sender: async () => { assert.fail("missing alert storage must not send"); } });
  assert.equal(result.alert, "disabled");
  assert.equal(f.calls.length, 1);
});

test("incident fingerprint ignores fluctuating counts and redacts unknown check names", async () => {
  const a = client({ claimed: false });
  const b = client({ claimed: false });
  await runOperationsMonitor({ health: unhealthy, client: a.db });
  await runOperationsMonitor({ health: { ...unhealthy,
    checks: [{ name: "payment_events_terminal", count: 99, ok: false }] }, client: b.db });
  assert.equal(a.calls[0].args.p_fingerprint, b.calls[0].args.p_fingerprint);
  const c = client({ claimed: false });
  await runOperationsMonitor({ health: { ...unhealthy,
    checks: [{ name: "private-donor@example.invalid", count: null, ok: false }] }, client: c.db });
  assert.doesNotMatch(JSON.stringify(c.calls), /private-donor/);
  assert.match(JSON.stringify(c.calls), /health_checks_unavailable/);
});

test("test alert has a separate durable key and carries no customer or queue details", async () => {
  const f = client();
  const result = await runOperationsMonitor({ test: true, health: unhealthy, client: f.db,
    now: new Date(unhealthy.checkedAt), sender: async ({ payload }) => {
      assert.deepEqual(payload, { test: true, checkedAt: unhealthy.checkedAt, checks: [] });
      return true;
    } });
  assert.equal(result.alert, "sent");
  assert.equal(f.calls[0].args.p_monitor_key, "operations-test");
  assert.equal(f.calls[0].args.p_repeat, true);
});

test("sender uses only existing configured recipients, fixed idempotency and redacted count content", async () => {
  const original = { apiKey: process.env.RESEND_API_KEY, recipients: process.env.SUPPORT_NOTIFY_EMAIL,
    from: process.env.SUPPORT_FROM_EMAIL };
  process.env.RESEND_API_KEY = "mock-operations-email-key";
  process.env.SUPPORT_NOTIFY_EMAIL = "one@example.invalid, two@example.invalid,one@example.invalid";
  process.env.SUPPORT_FROM_EMAIL = "existing-support@example.invalid";
  try {
    assert.deepEqual(operationsAlertRecipients(), ["one@example.invalid", "two@example.invalid"]);
    const sent = await sendOperationsAlert({
      deliveryKey: "persisted-key", payload: { test: false, checkedAt: unhealthy.checkedAt,
        checks: [{ name: "payment_events_terminal", count: 3 },
          { name: "customer-private@example.invalid", count: null }] },
      fetcher: async (url, init) => {
        assert.equal(url, "https://api.resend.com/emails");
        assert.equal(new Headers(init?.headers).get("Idempotency-Key"), "operations-alert/persisted-key");
        const body = JSON.parse(init!.body as string);
        assert.deepEqual(body.to, ["one@example.invalid", "two@example.invalid"]);
        assert.equal(body.from, "FaithForm Support <existing-support@example.invalid>");
        assert.match(body.text, /Payment events failed/);
        assert.match(body.text, /Check unavailable/);
        assert.doesNotMatch(init!.body as string, /customer-private/);
        assert.ok(init?.signal);
        return new Response(null, { status: 200 });
      },
    });
    assert.equal(sent, true);
    delete process.env.SUPPORT_NOTIFY_EMAIL;
    assert.deepEqual(operationsAlertRecipients(), ["support@faithform.io"]);
    delete process.env.RESEND_API_KEY;
    assert.equal(await sendOperationsAlert({ deliveryKey: "persisted-key",
      payload: { test: true, checkedAt: unhealthy.checkedAt, checks: [] },
      fetcher: async () => { assert.fail("unconfigured sender must not call provider"); } }), false);
  } finally {
    for (const [key, value] of Object.entries({ RESEND_API_KEY: original.apiKey,
      SUPPORT_NOTIFY_EMAIL: original.recipients, SUPPORT_FROM_EMAIL: original.from })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
