import assert from "node:assert/strict";
import test from "node:test";

import type { SupabaseClient } from "@supabase/supabase-js";

import { getChurchSupportTickets } from "../../lib/queries/support";
import { getCommentsForTickets, getTicketComments } from "../../lib/support/comments";

type Response = {
  data: Record<string, unknown>[] | null;
  error: { message: string } | null;
  count?: number | null;
};

function clientWithResponses(responses: Record<string, Response[]>) {
  const calls: Array<{ table: string; limit: number }> = [];
  const selects: Array<{ table: string; columns: string }> = [];
  const client = {
    from: (table: string) => {
      const builder = {
        select: (columns: string) => { selects.push({ table, columns }); return builder; },
        eq: () => builder,
        in: () => builder,
        gt: () => builder,
        order: () => builder,
        limit: (limit: number) => {
          calls.push({ table, limit });
          const next = responses[table]?.shift();
          assert.ok(next, `unexpected ${table} query`);
          return Promise.resolve(next);
        },
      };
      return builder;
    },
  } as unknown as SupabaseClient;
  return { client, calls, selects };
}

function comment(index: number, ticketId = "ticket-a") {
  return {
    id: String(index).padStart(5, "0"),
    ticket_id: ticketId,
    author_role: "church",
    author_name: "QA Church",
    body: `QA reply ${index}`,
    created_at: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(),
  };
}

test("support ticket threads include replies beyond the first 1,000 rows", async () => {
  const rows = Array.from({ length: 1001 }, (_, index) => comment(index));
  const db = clientWithResponses({
    support_ticket_comments: [
      { data: rows.slice(0, 500), error: null, count: 1001 },
      { data: rows.slice(500, 1000), error: null },
      { data: rows.slice(1000), error: null },
    ],
  });

  const thread = await getTicketComments(db.client, "ticket-a");
  assert.equal(thread.length, 1001);
  assert.equal(thread[0]?.body, "QA reply 0");
  assert.equal(thread.at(-1)?.body, "QA reply 1000");
  assert.deepEqual(db.calls, Array.from({ length: 3 }, () => ({
    table: "support_ticket_comments", limit: 500,
  })));
});

test("church thread reads omit private email delivery fields", async () => {
  const church = clientWithResponses({
    support_ticket_comments: [{ data: [comment(0)], error: null, count: 1 }],
  });
  const threads = await getCommentsForTickets(church.client, ["ticket-a"]);
  assert.equal(threads.get("ticket-a")?.[0]?.notificationEmailStatus, null);
  assert.ok(!church.selects[0]?.columns.includes("notification_email_status"));

  const admin = clientWithResponses({
    support_ticket_comments: [{ data: [comment(0)], error: null, count: 1 }],
  });
  await getTicketComments(admin.client, "ticket-a");
  assert.ok(admin.selects[0]?.columns.includes("notification_email_status"));
});

test("a church sees all tickets beyond the first page", async () => {
  const rows = Array.from({ length: 1001 }, (_, index) => ({
    id: String(index).padStart(5, "0"),
    subject: `QA request ${index}`,
    body: null,
    status: "open",
    priority: "normal",
    created_at: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(),
  }));
  const db = clientWithResponses({
    support_tickets: [
      { data: rows.slice(0, 500), error: null, count: 1001 },
      { data: rows.slice(500, 1000), error: null },
      { data: rows.slice(1000), error: null },
    ],
    support_ticket_comments: Array.from({ length: 11 }, () => ({
      data: [], error: null, count: 0,
    })),
  });

  const tickets = await getChurchSupportTickets("church-a", db.client);
  assert.equal(tickets.length, 1001);
  assert.equal(tickets[0]?.subject, "QA request 1000");
  assert.equal(tickets.at(-1)?.subject, "QA request 0");
  assert.equal(db.calls.filter((call) => call.table === "support_ticket_comments").length, 11);
});

test("failed support reads do not show an empty ticket list or conversation", async () => {
  const failure = { data: null, error: { message: "connection lost" } };
  const tickets = clientWithResponses({ support_tickets: [failure] });
  await assert.rejects(getChurchSupportTickets("church-a", tickets.client), /support tickets read failed/);

  const comments = clientWithResponses({ support_ticket_comments: [failure] });
  await assert.rejects(getTicketComments(comments.client, "ticket-a"), /support comments read failed/);

  const partial = clientWithResponses({
    support_ticket_comments: [
      { data: [comment(0)], error: null, count: 2 },
      { data: [], error: null },
    ],
  });
  await assert.rejects(getCommentsForTickets(partial.client, ["ticket-a"]), /support comments incomplete/);
});
