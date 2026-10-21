import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  deliverSupportTicketToNotion,
  retryPendingSupportNotionTickets,
  type NotionDeliveryDependencies,
} from "../../lib/support/notion-delivery";

const ticket = { id: "ticket-1", church_id: "church-1", subject: "Help", body: "Details", priority: "high" };
const claim = { ticket_id: ticket.id, lease_token: "lease-1", attempts: 1 };

function fixture(options: {
  claimError?: boolean;
  noClaim?: boolean;
  noChurch?: boolean;
  completionError?: boolean;
  syncError?: boolean;
  disabled?: boolean;
} = {}) {
  const updates: { values: Record<string, unknown>; filters: Record<string, unknown> }[] = [];
  const synced: unknown[] = [];
  const rpcCalls: unknown[] = [];
  const claims: unknown[] = [claim];
  const client = {
    async rpc(name: string, args: unknown) {
      rpcCalls.push({ name, args });
      return { data: options.noClaim ? [] : [claims.shift()].filter(Boolean), error: options.claimError ? {} : null };
    },
    from(table: string) {
      const filters: Record<string, unknown> = {};
      let values: Record<string, unknown> | undefined;
      const query = {
        select() { return query; },
        eq(key: string, value: unknown) { filters[key] = value; return query; },
        update(value: Record<string, unknown>) { values = value; return query; },
        async maybeSingle() {
          if (table === "support_tickets") return { data: ticket, error: null };
          if (table === "churches") return { data: options.noChurch ? null : { name: "Grace Church" }, error: null };
          updates.push({ values: values!, filters });
          return { data: options.completionError ? null : { ticket_id: ticket.id }, error: options.completionError ? {} : null };
        },
      };
      return query;
    },
  } as unknown as SupabaseClient;
  const deps: NotionDeliveryDependencies = {
    configured: () => !options.disabled,
    now: () => Date.parse("2026-10-21T04:00:00Z"),
    async sync(value) { synced.push(value); if (options.syncError) throw new Error("provider echoed private body"); },
  };
  return { client, deps, updates, synced, rpcCalls, claims };
}

test("successful delivery uses stored ticket and church fields, then completes only its lease", async () => {
  const f = fixture();
  assert.equal(await deliverSupportTicketToNotion(ticket.id, f.client, f.deps), "sent");
  assert.deepEqual(f.synced, [{ id: ticket.id, churchName: "Grace Church", subject: "Help", body: "Details", priority: "high" }]);
  assert.deepEqual(f.rpcCalls, [{ name: "claim_support_notion_ticket", args: { p_ticket_id: ticket.id } }]);
  assert.deepEqual(f.updates[0].filters, { ticket_id: ticket.id, lease_token: "lease-1" });
  assert.equal(f.updates[0].values.delivered_at, "2026-10-21T04:00:00.000Z");
  assert.equal(f.updates[0].values.lease_token, null);
});

test("provider failure remains retryable and stores only a safe error code", async (t) => {
  t.mock.method(console, "warn", () => {});
  const f = fixture({ syncError: true });
  assert.equal(await deliverSupportTicketToNotion(ticket.id, f.client, f.deps), "deferred");
  assert.equal(f.updates[0].values.delivered_at, null);
  assert.equal(f.updates[0].values.available_at, "2026-10-21T04:01:00.000Z");
  assert.equal(f.updates[0].values.last_error_code, "delivery_failed");
  assert.doesNotMatch(JSON.stringify(f.updates), /private|provider/);
});

test("unavailable schema and claims never turn a saved ticket into an exception", async () => {
  const failed = fixture({ claimError: true });
  assert.equal(await deliverSupportTicketToNotion(ticket.id, failed.client, failed.deps), "deferred");
  assert.deepEqual(failed.synced, []);
  const claimedElsewhere = fixture({ noClaim: true });
  assert.equal(await deliverSupportTicketToNotion(ticket.id, claimedElsewhere.client, claimedElsewhere.deps), "skipped");
  assert.deepEqual(claimedElsewhere.synced, []);
});

test("disabled integration never claims or reads tickets", async () => {
  const f = fixture({ disabled: true });
  assert.equal(await deliverSupportTicketToNotion(ticket.id, f.client, f.deps), "disabled");
  assert.deepEqual(await retryPendingSupportNotionTickets(f.client, f.deps), { configured: false, sent: 0, deferred: 0, failed: false });
  assert.deepEqual(f.rpcCalls, []);
});

test("missing church does not send a misleading church name", async (t) => {
  t.mock.method(console, "warn", () => {});
  const f = fixture({ noChurch: true });
  assert.equal(await deliverSupportTicketToNotion(ticket.id, f.client, f.deps), "deferred");
  assert.deepEqual(f.synced, []);
});

test("completion write failure remains recoverable instead of reporting sent", async () => {
  const f = fixture({ completionError: true });
  assert.equal(await deliverSupportTicketToNotion(ticket.id, f.client, f.deps), "deferred");
  assert.equal(f.synced.length, 1);
});

test("retry moves past failed tickets to other pending work", async (t) => {
  t.mock.method(console, "warn", () => {});
  const f = fixture();
  f.claims.push({ ...claim, ticket_id: "ticket-2", lease_token: "lease-2" });
  let calls = 0;
  f.deps.sync = async () => { calls += 1; if (calls === 1) throw new Error("unavailable"); };
  assert.deepEqual(await retryPendingSupportNotionTickets(f.client, f.deps), { configured: true, sent: 1, deferred: 1, failed: false });
  assert.equal(calls, 2);
  assert.deepEqual(f.updates.map((u) => u.filters.lease_token), ["lease-1", "lease-2"]);
});

test("retry is bounded and reports claim failure", async () => {
  const f = fixture({ claimError: true });
  assert.deepEqual(await retryPendingSupportNotionTickets(f.client, f.deps), { configured: true, sent: 0, deferred: 0, failed: true });
  assert.equal(f.rpcCalls.length, 1);
});

test("retry route rejects absent, incorrect, and unconfigured cron credentials", async () => {
  const { GET } = await import("../../app/api/support/notion/retry/route");
  const saved = process.env.CRON_SECRET;
  try {
    process.env.CRON_SECRET = "synthetic-cron-secret";
    for (const authorization of [undefined, "Bearer wrong-secret"]) {
      const response = await GET(new Request("https://example.test/api/support/notion/retry", {
        headers: authorization ? { authorization } : {},
      }));
      assert.equal(response.status, 401);
      assert.deepEqual(await response.json(), { error: "Unauthorized" });
    }
    delete process.env.CRON_SECRET;
    const response = await GET(new Request("https://example.test/api/support/notion/retry", {
      headers: { authorization: "Bearer synthetic-cron-secret" },
    }));
    assert.equal(response.status, 401);
  } finally {
    if (saved === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = saved;
  }
});
