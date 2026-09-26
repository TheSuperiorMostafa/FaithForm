import assert from "node:assert/strict";
import test from "node:test";

import type { DeliveryResult, PushAdapter } from "@/lib/faithform/push/adapters";
import { runNotificationWorker } from "@/lib/faithform/push/outbox";

/**
 * The worker sent to every device one after another and, on any retry, sent to
 * every device again. One device's 503 re-notified the whole church, and a
 * church big enough to outrun the 60-second function got the first few hundred
 * phones the same push up to five times while the rest never got it. A retry
 * now reaches only the devices that have not had it.
 */

type Row = Record<string, unknown>;

const CHURCH = "11111111-1111-4111-8111-111111111111";

function fakeDb(deviceCount: number) {
  const tables: Record<string, Row[]> = {
    notification_outbox: [
      {
        id: "job-1",
        church_id: CHURCH,
        subject_type: "stream_event",
        subject_id: "event-1",
        subject_version: 1,
        topic: "live",
        kind: "live",
        target_visibility: "public",
        target_account_ids: null,
        title: "We're live",
        body: "Join us",
        deep_link: null,
        collapse_key: "live",
        correlation_id: "c-1",
        status: "pending",
        attempts: 0,
        max_attempts: 5,
      },
    ],
    stream_events: [{ id: "event-1", church_id: CHURCH, status: "live", mobile_visibility: "public" }],
    visitor_church_relationships: [],
    visitor_notification_preferences: [],
    visitor_device_installations: [],
    notification_delivery_attempts: [],
  };
  for (let index = 0; index < deviceCount; index += 1) {
    tables.visitor_church_relationships.push({ account_id: `acct-${index}`, church_id: CHURCH, state: "following" });
    tables.visitor_device_installations.push({
      id: `install-${index}`,
      account_id: `acct-${index}`,
      provider: "apns",
      provider_token: `token-${index}`,
      apns_environment: "production",
      is_enabled: true,
      invalidated_at: null,
    });
  }

  const from = (table: string) => {
    const filters: ((row: Row) => boolean)[] = [];
    let window: [number, number] | null = null;
    let patch: Row | null = null;
    const run = () => {
      const matched = (tables[table] ?? []).filter((row) => filters.every((keep) => keep(row)));
      if (patch) {
        for (const row of matched) Object.assign(row, patch);
        return { data: matched, error: null };
      }
      // Like the hosted API: never more than 1,000 rows in one response.
      const [start, end] = window ?? [0, matched.length - 1];
      return { data: matched.slice(start, Math.min(end + 1, start + 1000)), error: null };
    };
    const builder = {
      select: () => builder,
      eq: (column: string, value: unknown) => (filters.push((row) => row[column] === value), builder),
      in: (column: string, values: unknown[]) => (filters.push((row) => values.includes(row[column])), builder),
      is: (column: string, value: unknown) => (filters.push((row) => (row[column] ?? null) === value), builder),
      order: () => builder,
      limit: () => builder,
      range: (start: number, end: number) => ((window = [start, end]), builder),
      maybeSingle: async () => ({ data: run().data[0] ?? null, error: null }),
      insert: async (row: Row) => {
        tables[table].push(row);
        return { error: null };
      },
      update: (values: Row) => ((patch = values), builder),
      then: (resolve: (value: unknown) => unknown) => resolve(run()),
    };
    return builder;
  };

  const rpc = async (fn: string, params: Row) => {
    const job = tables.notification_outbox[0];
    if (fn === "claim_notification_jobs") {
      if (job.status !== "pending" || Number(job.attempts) >= Number(job.max_attempts)) {
        return { data: [], error: null };
      }
      job.status = "claimed";
      job.lease_token = params.p_lease_token;
      job.attempts = Number(job.attempts) + 1;
      return { data: [{ ...job }], error: null };
    }
    if (fn === "complete_notification_job") {
      job.status =
        params.p_outcome === "sent"
          ? "sent"
          : Number(job.attempts) >= Number(job.max_attempts)
            ? "failed"
            : "pending";
      job.lease_token = null;
      return { data: true, error: null };
    }
    return { data: null, error: null };
  };

  return { client: { from, rpc } as never, tables };
}

function adapter(outcomeFor: (token: string, call: number) => DeliveryResult["outcome"]) {
  const sends = new Map<string, number>();
  const apns: PushAdapter = {
    provider: "apns",
    isConfigured: () => true,
    send: async (token) => {
      const call = (sends.get(token) ?? 0) + 1;
      sends.set(token, call);
      return { outcome: outcomeFor(token, call) };
    },
  };
  return { apns, sends };
}

test("one device's retryable failure does not re-notify everyone else", async () => {
  const { client, tables } = fakeDb(3);
  const { apns, sends } = adapter((token, call) => (token === "token-1" && call === 1 ? "retryable" : "sent"));

  const first = await runNotificationWorker({ client, adapters: { apns } });
  assert.equal(first.retried, 1);
  const second = await runNotificationWorker({ client, adapters: { apns } });
  assert.equal(second.sent, 1);

  assert.equal(sends.get("token-0"), 1);
  assert.equal(sends.get("token-2"), 1);
  assert.equal(sends.get("token-1"), 2, "only the device that failed is tried again");
  assert.equal(tables.notification_outbox[0].status, "sent");
});

test("a broadcast too big for one run resumes where it stopped, sending each device once", async () => {
  const { client, tables } = fakeDb(20);
  let clock = 0;
  const { apns, sends } = adapter(() => {
    clock += 10_000;
    return "sent";
  });

  let runs = 0;
  while (tables.notification_outbox[0].status !== "sent" && runs < 10) {
    await runNotificationWorker({ client, adapters: { apns }, budgetMs: 40_000, now: () => clock });
    runs += 1;
  }

  assert.equal(tables.notification_outbox[0].status, "sent");
  assert.ok(runs > 1, "the budget split the work across runs");
  assert.equal(sends.size, 20);
  assert.ok([...sends.values()].every((count) => count === 1), "no device got the same push twice");
});

test("a broadcast needing more passes than the job's attempts still finishes", async () => {
  // Each pass reaches 8 devices; 60 devices take 8 passes, more than the five
  // attempts a job has. Running out of time is progress, not a failed attempt.
  const { client, tables } = fakeDb(60);
  let clock = 0;
  const { apns, sends } = adapter(() => {
    clock += 10_000;
    return "sent";
  });

  let runs = 0;
  while (!["sent", "failed"].includes(String(tables.notification_outbox[0].status)) && runs < 20) {
    await runNotificationWorker({ client, adapters: { apns }, budgetMs: 40_000, now: () => clock });
    runs += 1;
  }

  assert.equal(tables.notification_outbox[0].status, "sent");
  assert.ok(runs > 5);
  assert.equal(sends.size, 60);
  assert.ok([...sends.values()].every((count) => count === 1));
});

test("more than 1,000 devices already reached are all remembered on a retry", async () => {
  const { client, tables } = fakeDb(1200);
  for (let index = 0; index < 1100; index += 1) {
    tables.notification_delivery_attempts.push({
      outbox_id: "job-1",
      installation_id: `install-${index}`,
      outcome: "sent",
    });
  }
  const { apns, sends } = adapter(() => "sent");
  await runNotificationWorker({ client, adapters: { apns } });
  assert.equal(sends.size, 100, "only the 100 devices never reached are sent to");
});
