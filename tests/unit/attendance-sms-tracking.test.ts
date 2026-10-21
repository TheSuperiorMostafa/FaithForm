import assert from "node:assert/strict";
import { test } from "node:test";
import { getSmsMobileDelivery, parseSmsMobileDelivery, listSmsMobileDevices } from "@/lib/sms/sms-mobile-api";
import { pickFollowUpMessage, validateFollowUpTemplates } from "@/lib/sms/follow-up-messages";
import { validateFollowUpOverride } from "@/lib/attendance/follow-up-message";
import { computeHoursSavedFromSources } from "@/lib/reports/hours-saved";


test("a name is optional in saved messages and one-time edits, and is never appended", () => {
  const message = "We missed you. Hope to see you Sunday!";
  assert.deepEqual(validateFollowUpTemplates(Array(5).fill(message)), { ok: true, templates: Array(5).fill(message) });
  assert.deepEqual(validateFollowUpOverride(message), { ok: true, message });
  assert.equal(pickFollowUpMessage("Alex", 1, [message]), message);
  assert.equal(pickFollowUpMessage("Alex", 1, ["Hi [Name]! [Name], see you Sunday."]), "Hi Alex! Alex, see you Sunday.");
  assert.equal(validateFollowUpOverride("   ").ok, false);
  assert.equal(validateFollowUpOverride("x".repeat(481)).ok, false);
});

test("API acceptance and missing status remain queued until the handset confirms", () => {
  assert.equal(parseSmsMobileDelivery({ sent: "1" }), "queued");
  assert.equal(parseSmsMobileDelivery({ send_from_mobile: 0, error_api: "", send_from_mobile_erreur: "" }), "queued");
  assert.equal(parseSmsMobileDelivery({ send_from_mobile: "1" }), "sent");
  assert.equal(parseSmsMobileDelivery({ send_from_mobile: 0, send_from_mobile_erreur: "phone offline" }), "failed");
  assert.equal(parseSmsMobileDelivery({ send_from_mobile: 0, error_api: "1" }), "failed");
});

test("delivery lookup uses the server key and exact reference and selected handset", async () => {
  const originalFetch = globalThis.fetch;
  const calls: { url: string; options?: RequestInit }[] = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    return Response.json({ result: { error: "0", sms: [
      { guid_message: "other", sIdentifiantPhone: "phone-1", send_from_mobile: 1 },
      { guid_message: "reference-1", sIdentifiantPhone: "phone-2", send_from_mobile: 1 },
    ] } });
  };
  try {
    assert.equal(await getSmsMobileDelivery({ apiKey: "server-secret", messageId: "reference-1", deviceSid: "phone-1" }), null);
    assert.equal(await getSmsMobileDelivery({ apiKey: "server-secret", messageId: "reference-1", deviceSid: "phone-2" }), "sent");
    assert.equal(await getSmsMobileDelivery({ apiKey: "server-secret", messageId: "missing" }), null);
    const url = new URL(calls[0].url);
    assert.equal(url.searchParams.get("guid_message"), "reference-1");
    assert.equal(url.searchParams.get("apikey"), "server-secret");
    assert.equal(url.origin + url.pathname, "https://api.smsmobileapi.com/log/sent/sms/");
    assert.equal(calls[0].options?.method, "GET");
    assert.equal(calls[0].options?.cache, "no-store");
  } finally {
    globalThis.fetch = originalFetch;
  }
});


test("confirmed follow-up activity appears in time saved within the selected report period", () => {
  const activity = {
    automation_type: "Attendance Follow-up Text", category: "Communication",
    time_saved_minutes: 2, executed_at: "2026-10-20T12:00:00Z",
  };
  const result = computeHoursSavedFromSources({
    phoneCalls: [], announcements: [], attendance: [], assets: [], sermons: [],
    activities: [activity, { ...activity, executed_at: "2026-09-20T12:00:00Z" }],
  }, { start: new Date("2026-10-01T00:00:00Z"), end: new Date("2026-11-01T00:00:00Z") });
  assert.equal(result.minutes, 2);
  assert.equal(result.tasks, 1);
  assert.equal(result.byCategory.Communication, 2);
  assert.equal(result.automationMinutes.get("Attendance Follow-up Text"), 2);
});

test("device discovery reads current success/items and legacy responses without inventing online status", async () => {
  const originalFetch = globalThis.fetch;
  const replies = [
    { success: true, connected_now: 1, items: [{ sid: "phone-1", label: "Office", phone_number: "+15555550123", last_check: {} }] },
    { result: { error: "0", mobiles: [{ sIdentifiantPhone: "phone-2", name: "Welcome", status: "disconnected" }] } },
    { success: true, items: [] },
    { success: false, items: [] },
    {},
  ];
  globalThis.fetch = async () => Response.json(replies.shift());
  try {
    const current = await listSmsMobileDevices("server-key");
    assert.equal(current.ok, true);
    if (current.ok) {
      assert.equal(current.devices.length, 1);
      assert.equal(current.devices[0].sid, "phone-1");
      assert.equal(current.devices[0].online, null);
    }
    const legacy = await listSmsMobileDevices("server-key");
    assert.equal(legacy.ok, true);
    if (legacy.ok) assert.equal(legacy.devices[0].online, false);
    assert.deepEqual(await listSmsMobileDevices("server-key"), { ok: true, devices: [] });
    assert.equal((await listSmsMobileDevices("server-key")).ok, false);
    assert.equal((await listSmsMobileDevices("server-key")).ok, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
