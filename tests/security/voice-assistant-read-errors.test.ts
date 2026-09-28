import assert from "node:assert/strict";
import test from "node:test";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  getPhoneCallById,
  getRecentPhoneCalls,
  getVoiceAssistantSettings,
} from "../../lib/queries/voice-assistant";

type Response = {
  data: Record<string, unknown> | Record<string, unknown>[] | null;
  error: { code: string; message: string } | null;
};

function clientWith(...responses: Response[]) {
  let reads = 0;
  const next = () => {
    reads += 1;
    const response = responses.shift();
    assert.ok(response, "unexpected extra database read");
    return Promise.resolve(response);
  };
  const builder = {
    select: () => builder,
    eq: () => builder,
    order: () => builder,
    limit: next,
    maybeSingle: next,
  };
  return {
    client: { from: () => builder } as unknown as SupabaseClient,
    get reads() { return reads; },
  };
}

test("call and settings reads fail visibly instead of showing empty defaults", async () => {
  const failure = { data: null, error: { code: "08006", message: "connection lost" } };
  const list = clientWith(failure);
  await assert.rejects(getRecentPhoneCalls("church-a", 100, list.client), /Could not load phone calls/);
  assert.equal(list.reads, 1);

  const detail = clientWith(failure);
  await assert.rejects(getPhoneCallById("church-a", "call-a", detail.client), /Could not load phone call/);
  assert.equal(detail.reads, 1);

  const settings = clientWith(failure);
  await assert.rejects(getVoiceAssistantSettings("church-a", settings.client), /Could not load settings/);
});

test("only a missing scoring column uses the legacy call query", async () => {
  const missing = { data: null, error: { code: "42703", message: "column call_classification does not exist" } };
  const row = { id: "call-a", called_at: "2026-09-27T12:00:00Z" };

  const list = clientWith(missing, { data: [row], error: null });
  const calls = await getRecentPhoneCalls("church-a", 100, list.client);
  assert.equal(list.reads, 2);
  assert.equal(calls[0]?.id, row.id);
  assert.equal(calls[0]?.call_classification, null);

  const detail = clientWith(missing, { data: row, error: null });
  assert.equal((await getPhoneCallById("church-a", "call-a", detail.client))?.id, row.id);
  assert.equal(detail.reads, 2);

  const denied = clientWith({ data: null, error: { code: "42501", message: "permission denied for call_classification" } });
  await assert.rejects(getRecentPhoneCalls("church-a", 100, denied.client), /Could not load phone calls/);
  assert.equal(denied.reads, 1);
});

test("a failed legacy retry does not turn calls into an empty list", async () => {
  const list = clientWith(
    { data: null, error: { code: "PGRST204", message: "call_classification missing from schema cache" } },
    { data: null, error: { code: "08006", message: "connection lost" } },
  );
  await assert.rejects(getRecentPhoneCalls("church-a", 100, list.client), /Could not load phone calls/);
  assert.equal(list.reads, 2);
});

test("successful empty reads remain valid empty states", async () => {
  const list = clientWith({ data: [], error: null });
  assert.deepEqual(await getRecentPhoneCalls("church-a", 100, list.client), []);
  const detail = clientWith({ data: null, error: null });
  assert.equal(await getPhoneCallById("church-a", "missing", detail.client), null);
  const settings = clientWith({ data: null, error: null });
  assert.equal(await getVoiceAssistantSettings("church-a", settings.client), null);
});
