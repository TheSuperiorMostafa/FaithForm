import assert from "node:assert/strict";
import { test } from "node:test";

import { sendViaQuo } from "@/lib/sms/send-sms";

const sender = {
  gateway: "quo" as const,
  apiKey: "test-key",
  from: "+15550000000",
  fromNumber: "+15550000000",
  deviceSid: null,
  source: "server" as const,
};

test("sends through Quo with the raw key and returns the message id", async () => {
  let seen: { url: string; init: RequestInit } | null = null;
  const fakeFetch = (async (url: string, init: RequestInit) => {
    seen = { url, init };
    return new Response(JSON.stringify({ data: { id: "AC123", status: "queued" } }), { status: 202 });
  }) as unknown as typeof fetch;

  const result = await sendViaQuo(sender, "+15551234567", "Hello", fakeFetch);

  assert.deepEqual(result, { ok: true, messageId: "AC123", from: "+15550000000" });
  assert.equal(seen!.url, "https://api.quo.com/v1/messages");
  assert.equal((seen!.init.headers as Record<string, string>).Authorization, "test-key");
  assert.deepEqual(JSON.parse(String(seen!.init.body)), {
    from: "+15550000000",
    to: ["+15551234567"],
    content: "Hello",
  });
});

test("a refused message is reported as failed with Quo's title and code", async () => {
  const fakeFetch = (async () =>
    new Response(JSON.stringify({ code: "0206400", title: "A2P Registration Not Approved" }), {
      status: 400,
    })) as unknown as typeof fetch;
  const original = console.error;
  console.error = () => {};
  try {
    const result = await sendViaQuo(sender, "+15551234567", "Hello", fakeFetch);
    assert.equal(result.ok, false);
    assert.match(!result.ok ? result.error : "", /A2P Registration Not Approved \(0206400\)/);
  } finally {
    console.error = original;
  }
});

test("a network failure does not throw", async () => {
  const fakeFetch = (async () => {
    throw new Error("offline");
  }) as unknown as typeof fetch;
  const result = await sendViaQuo(sender, "+15551234567", "Hello", fakeFetch);
  assert.equal(result.ok, false);
});
