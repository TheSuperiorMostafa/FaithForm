import assert from "node:assert/strict";
import test from "node:test";
import JSZip from "jszip";
import { eventRecurrenceRule } from "@/lib/announcements/recurrence";
import { buildEmailDocument } from "@/lib/announcements/email-document";
import { buildEventIcs } from "@/lib/integrations/apple-calendar";
import { expandIcsEvents, parseIcsEvents } from "@/lib/integrations/ics";
import { normalizeAnnouncementEmailTemplate, validateAnnouncementEmailTemplate } from "@/lib/email/announcement-template";

test("multiple email recipients survive normalization and reject header injection", () => {
  assert.equal(normalizeAnnouncementEmailTemplate({ to: " one@example.com; two@example.com " }).to, "one@example.com, two@example.com");
  assert.equal(validateAnnouncementEmailTemplate("News [Week]", "[Events]", "one@example.com, two@example.com").ok, true);
  for (const to of ["one@example.com, invalid", "one@example.com\r\nBcc:other@example.com", "one@example.com,"]) {
    assert.equal(validateAnnouncementEmailTemplate("News [Week]", "[Events]", to).ok, false);
  }
});

test("repeats are bounded, and malformed or backwards dates are rejected", () => {
  const start = "2026-11-06T14:00:00Z";
  assert.equal(eventRecurrenceRule("none", "", start), null);
  assert.equal(eventRecurrenceRule("weekly", "2027-01-01", start), "RRULE:FREQ=WEEKLY;UNTIL=20270101T235959Z");
  for (const [repeat, until] of [["hourly", "2027-01-01"], ["weekly", "2026-02-30"], ["weekly", "2026-11-05"], ["daily", "2040-01-01"]]) {
    assert.throws(() => eventRecurrenceRule(repeat, until, start));
  }
});

test("the last repeat date covers the entire day in the church timezone", () => {
  assert.equal(eventRecurrenceRule("weekly", "2026-11-06", "2026-11-06T23:30:00Z", "America/Los_Angeles"), "RRULE:FREQ=WEEKLY;UNTIL=20261107T075959Z");
});

test("weekly iCloud events retain their church's clock time across daylight saving", () => {
  const ics = buildEventIcs({ uid: "repeat@faithform.io", title: "Service", startAt: "2026-10-25T13:00:00Z", endAt: "2026-10-25T14:00:00Z", timeZone: "America/New_York", recurrence: ["RRULE:FREQ=WEEKLY;UNTIL=20261109T235959Z"] });
  assert.match(ics, /DTSTART;TZID=America\/New_York:20261025T090000/);
  const events = expandIcsEvents(parseIcsEvents(ics), "2026-10-24T00:00:00Z", "2026-11-10T00:00:00Z");
  assert.deepEqual(events.map((event) => event.startAt), ["2026-10-25T13:00:00.000Z", "2026-11-01T14:00:00.000Z", "2026-11-08T14:00:00.000Z"]);
});

test("the email attachment contains the subject and the complete Unicode message", async () => {
  const attachment = await buildEmailDocument("Weekly events — Nov 6", "Hello church,\n\nService & lunch <everyone>\nAll details and https://example.com/signup\nThank you! 🙏");
  assert.equal(attachment.fileName, "weekly-events.docx");
  const zip = await JSZip.loadAsync(attachment.content);
  const document = await zip.file("word/document.xml")!.async("string");
  assert.match(document, /Weekly events — Nov 6/);
  assert.match(document, /Service &amp; lunch &lt;everyone&gt;/);
  assert.match(document, /https:\/\/example.com\/signup/);
  assert.match(document, /Thank you! 🙏/);
  assert.ok(zip.file("[Content_Types].xml"));
  assert.ok(zip.file("_rels/.rels"));
});
