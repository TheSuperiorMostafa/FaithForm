import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildPhoneCallRow } from "../../lib/integrations/retell-calls";
import { isCompletedPhoneCall, isRealRetellPhoneCall, isVisiblePhoneCall } from "../../lib/integrations/retell-call-model";
import { verifyRetellWebhook } from "../../lib/integrations/retell-webhook-verify";
import { createHmac } from "node:crypto";
import { computeHoursSavedFromSources } from "../../lib/reports/hours-saved";

const call = { call_id: "phone-1", call_type: "phone_call" as const, from_number: "+15025550123", to_number: "+16155550123", start_timestamp: 1720000000000 };

test("only actual telephone calls with real-number endpoints enter the log", () => {
  assert.equal(isRealRetellPhoneCall(call), true);
  for (const patch of [{ call_type: "web_call" }, { call_type: undefined }, { from_number: "" }, { from_number: "anonymous" }, { from_number: "123" }, { to_number: undefined }]) {
    assert.equal(isRealRetellPhoneCall({ ...call, ...patch }), false);
  }
  assert.equal(isVisiblePhoneCall({ caller_number: call.from_number }), true, "legacy real calls remain visible");
  assert.equal(isVisiblePhoneCall({ caller_number: "(502) 555-0123" }), true, "formatted legacy telephone numbers remain visible");
  assert.equal(isVisiblePhoneCall({ caller_number: null }), false);
  assert.equal(isVisiblePhoneCall({ caller_number: call.from_number, provider_call_type: "web_call" }), false);
});

test("started calls reserve their row without claiming duration or completed work", () => {
  const started = buildPhoneCallRow("church-a", call, "call_started");
  assert.equal(started.call_status, "ongoing");
  assert.equal(started.called_at, new Date(call.start_timestamp).toISOString());
  assert.equal(started.duration_seconds, undefined);
  assert.equal(isCompletedPhoneCall(started), false);
  const ended = buildPhoneCallRow("church-a", { ...call, end_timestamp: call.start_timestamp + 92000 }, "call_ended");
  assert.equal(ended.duration_seconds, 92);
  assert.equal(ended.call_status, "ended");
  assert.equal(isCompletedPhoneCall(ended), true);
  assert.equal(ended.transcript, undefined, "missing summary fields cannot erase existing analyzed content");
  assert.equal(buildPhoneCallRow("church-a", { ...call, direction: "outbound" }).caller_number, call.to_number);
});

test("time tracker excludes web, numberless, and ongoing calls, retaining completed legacy calls", () => {
  const result = computeHoursSavedFromSources({
    phoneCalls: [
      { called_at: "2026-10-20T10:00:00Z", duration_seconds: 60, call_type: "inbound", caller_number: call.from_number },
      { called_at: "2026-10-20T10:00:00Z", duration_seconds: 60, call_type: "inbound", caller_number: null },
      { called_at: "2026-10-20T10:00:00Z", duration_seconds: 60, call_type: "inbound", caller_number: call.from_number, provider_call_type: "web_call" },
      { called_at: "2026-10-20T10:00:00Z", duration_seconds: null, call_type: "inbound", caller_number: call.from_number, call_status: "ongoing" },
    ], announcements: [], attendance: [], assets: [], sermons: [], activities: [],
  }, { start: null, end: new Date("2026-10-21T00:00:00Z") });
  assert.equal(result.tasks, 1);
  assert.equal(result.minutes, 5);
});

test("webhook verification binds the original bytes to its signing key and rejects stale signatures", () => {
  const body = JSON.stringify({ event: "call_started", call });
  const stamp = Date.now();
  const sign = (time: number) => `v=${time},d=${createHmac("sha256", "key").update(`${body}${time}`).digest("hex")}`;
  assert.equal(verifyRetellWebhook(body, sign(stamp), "key"), true);
  assert.equal(verifyRetellWebhook(body + " ", sign(stamp), "key"), false);
  assert.equal(verifyRetellWebhook(body, sign(stamp), "another-key"), false);
  assert.equal(verifyRetellWebhook(body, sign(stamp - 600001), "key"), false);
});

test("late lifecycle events cannot downgrade saved analysis and webhook scoring follows persistence", () => {
  const sql = readFileSync("supabase/migrations/0137_retell_call_lifecycle.sql", "utf8");
  assert.match(sql, /OLD.call_status = 'analyzed'.*NEW.call_status IN \('ongoing', 'ended'\)/);
  assert.match(sql, /OLD.call_status = 'ended'.*NEW.call_status = 'ongoing'/);
  assert.match(sql, /BEFORE UPDATE ON public.phone_calls/);
  const route = readFileSync("app/api/webhooks/retell/route.ts", "utf8");
  assert.ok(route.indexOf("verifyRetellWebhook(rawBody") < route.indexOf("upsertPhoneCallFromRetell(body.call"));
  assert.match(route, /event: body.event, score: false/);
  assert.match(route, /after\(async/);
});
