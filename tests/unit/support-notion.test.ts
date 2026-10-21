import assert from "node:assert/strict";
import test from "node:test";
import { isNotionSupportConfigured, syncNotionTicket } from "@/lib/support/notion";

const ticketId = "11111111-1111-4111-8111-111111111111";
const pageId = "22222222-2222-4222-8222-222222222222";
const sourceId = "33333333-3333-4333-8333-333333333333";
const ticket = { id: ticketId, churchName: "Example Church", subject: "Fix the calendar", body: "Dates are incorrect.\nPlease help.", priority: "normal" };

function configured(t: { after: (fn: () => void) => void }) {
  const previous = { key: process.env.NOTION_API_KEY, source: process.env.NOTION_SUPPORT_DATA_SOURCE_ID };
  process.env.NOTION_API_KEY = "test-private-key";
  process.env.NOTION_SUPPORT_DATA_SOURCE_ID = sourceId;
  t.after(() => {
    for (const [key, value] of Object.entries({ NOTION_API_KEY: previous.key, NOTION_SUPPORT_DATA_SOURCE_ID: previous.source })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
}

function fake(responses: Array<unknown | Error | Response>) {
  const calls: Array<{ url: string; body: Record<string, unknown> | undefined; init: RequestInit | undefined }> = [];
  const requestFetch: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), body: init?.body ? JSON.parse(String(init.body)) : undefined, init });
    const result = responses.shift();
    assert.notEqual(result, undefined, "unexpected extra Notion request");
    if (result instanceof Error) throw result;
    return result instanceof Response ? result : Response.json(result);
  };
  return { calls, options: { fetch: requestFetch, paceMs: 0 } };
}

test("creates the requested field mapping and places the original body in page comments", async (t) => {
  configured(t);
  const { calls, options } = fake([{ results: [] }, { id: pageId }, { results: [], has_more: false }, { id: "comment" }]);
  await syncNotionTicket(ticket, options);
  assert.deepEqual(calls[0].body, { filter: { property: "FaithForm Ticket ID", rich_text: { equals: ticketId } }, page_size: 2 });
  assert.deepEqual(calls[1].body?.parent, { type: "data_source_id", data_source_id: sourceId });
  const props = calls[1].body?.properties as Record<string, unknown>;
  assert.deepEqual(props["Church Name"], { title: [{ type: "text", text: { content: ticket.churchName } }] });
  assert.deepEqual(props.Priority, { select: { name: "Normal" } });
  assert.deepEqual(props["Assigned Team Member"], { multi_select: [{ name: "Emory" }] });
  assert.deepEqual(props["Build Status"], { select: { name: "To Build" } });
  assert.deepEqual(props["Bugs / Fixes Requested"], { rich_text: [{ type: "text", text: { content: ticket.subject } }] });
  assert.deepEqual(calls[3].body, { parent: { page_id: pageId }, rich_text: [{ type: "text", text: { content: ticket.body } }] });
  for (const call of calls) {
    assert.equal(call.init?.cache, "no-store");
    assert.ok(call.init?.signal);
    assert.equal(new Headers(call.init?.headers).get("Notion-Version"), "2025-09-03");
  }
});

test("retries reuse an existing page and delivered comment without resetting the team's fields", async (t) => {
  configured(t);
  const { calls, options } = fake([{ results: [{ id: pageId }] }, { results: [{ id: "comment", rich_text: [{ plain_text: ticket.body }] }], has_more: false }]);
  await syncNotionTicket(ticket, options);
  assert.equal(calls.length, 2);
  assert.equal(calls.filter((call) => call.url.endsWith("/pages")).length, 0);
});

test("an uncertain comment write is recovered on retry without duplicating the page or comment", async (t) => {
  configured(t);
  const first = fake([{ results: [{ id: pageId }] }, { results: [], has_more: false }, new Error("network test-private-key and message")]);
  await assert.rejects(syncNotionTicket(ticket, first.options), { message: "notion_request_failed" });
  const second = fake([{ results: [{ id: pageId }] }, { results: [{ id: "written-before-timeout", rich_text: [{ text: { content: ticket.body } }] }] }]);
  await syncNotionTicket(ticket, second.options);
  assert.equal(second.calls.length, 2);
});

test("uncertain page creation retries discover the original page", async (t) => {
  configured(t);
  const first = fake([{ results: [] }, new Error("socket closed")]);
  await assert.rejects(syncNotionTicket(ticket, first.options), { message: "notion_request_failed" });
  const second = fake([{ results: [{ id: pageId }] }, { results: [] }, { id: "comment" }]);
  await syncNotionTicket(ticket, second.options);
  assert.equal(second.calls.filter((call) => call.url.endsWith("/pages")).length, 0);
});

test("all four support priorities map to the existing Notion options", async (t) => {
  configured(t);
  for (const [priority, label] of [["low", "Low"], ["normal", "Normal"], ["high", "High"], ["urgent", "Urgent"]]) {
    const f = fake([{ results: [] }, { id: pageId }]);
    await syncNotionTicket({ ...ticket, priority, body: null }, f.options);
    assert.deepEqual((f.calls[1].body?.properties as Record<string, unknown>).Priority, { select: { name: label } });
  }
});

test("paginated comments and long Unicode messages preserve every character", async (t) => {
  configured(t);
  const body = "A".repeat(1999) + "🙏" + "B".repeat(16_000);
  const f = fake([{ results: [{ id: pageId }] }, { results: [], has_more: true, next_cursor: "next" }, { results: [], has_more: false }, { id: "first" }, { id: "second" }]);
  await syncNotionTicket({ ...ticket, body }, f.options);
  assert.match(f.calls[2].url, /start_cursor=next/);
  const texts = f.calls.slice(3).flatMap((call) => (call.body?.rich_text as Array<{ text: { content: string } }>).map((part) => part.text.content));
  assert.equal(texts.join(""), body);
  assert.ok(texts.every((text) => text.length <= 2000 && !/[\uD800-\uDBFF]$/.test(text) && !/^[\uDC00-\uDFFF]/.test(text)));
});

test("partial long-message delivery only sends missing comment chunks", async (t) => {
  configured(t);
  const body = "A".repeat(16_000) + "remaining";
  const f = fake([{ results: [{ id: pageId }] }, { results: [{ id: "first", rich_text: [{ plain_text: "A".repeat(16_000) }] }] }, { id: "second" }]);
  await syncNotionTicket({ ...ticket, body }, f.options);
  assert.deepEqual(f.calls[2].body?.rich_text, [{ type: "text", text: { content: "remaining" } }]);
});

test("provider errors expose only a status code, never the response content", async (t) => {
  configured(t);
  for (const status of [400, 403, 429, 503]) {
    const f = fake([Response.json({ message: "private ticket body and test-private-key" }, { status })]);
    await assert.rejects(syncNotionTicket(ticket, f.options), { message: `notion_http_${status}` });
    assert.equal(f.calls.length, 1);
  }
});

test("invalid configuration, priorities and duplicate IDs fail before another write", async (t) => {
  configured(t);
  const duplicate = fake([{ results: [{ id: pageId }, { id: pageId }] }]);
  await assert.rejects(syncNotionTicket(ticket, duplicate.options), { message: "notion_duplicate_ticket_id" });
  assert.equal(duplicate.calls.length, 1);
  const f = fake([]);
  await assert.rejects(syncNotionTicket({ ...ticket, priority: "invented" }, f.options), { message: "notion_invalid_priority" });
  process.env.NOTION_SUPPORT_DATA_SOURCE_ID = "invalid";
  await assert.rejects(syncNotionTicket(ticket, f.options), { message: "notion_invalid_data_source" });
  delete process.env.NOTION_API_KEY;
  assert.equal(isNotionSupportConfigured(), false);
  await assert.rejects(syncNotionTicket(ticket, f.options), { message: "notion_not_configured" });
  assert.equal(f.calls.length, 0);
});
