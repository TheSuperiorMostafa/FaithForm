import "../support/stub-server-only";

import assert from "node:assert/strict";
import test from "node:test";

import { answerSmsBody, cleanAlertEmails, cleanAlertPhones } from "@/lib/service-plans/alerts";
import { attendanceFor } from "@/lib/service-plans/queries";
import { shareViewOptions } from "@/lib/service-plans/share";
import { sharedPreset, type Plan, type PlanFile, type PlanItem } from "@/lib/service-plans/types";
import { buildPlanView } from "@/lib/service-plans/view";

const JANE = "11111111-1111-4111-8111-111111111111";
const SAM = "22222222-2222-4222-8222-222222222222";
const LEE = "33333333-3333-4333-8333-333333333333";

function item(id: string, itemType: PlanItem["itemType"], title: string, extra: Partial<PlanItem> = {}): PlanItem {
  return {
    id,
    position: id,
    itemType,
    title,
    lengthSeconds: itemType === "header" ? 0 : 300,
    description: null,
    mediaUrl: null,
    song: null,
    leaders: [],
    updatedAt: "2026-11-20T00:00:00Z",
    updatedBy: null,
    ...extra,
  };
}

function file(id: string, itemId: string, source: PlanFile["source"]): PlanFile {
  return { id, itemId, source, name: `${id}.pdf`, url: null, isFile: true, detail: null };
}

function plan(): Plan {
  return {
    id: "plan-1",
    serviceTypeId: "type-1",
    serviceTypeName: "Sunday Morning",
    date: "2026-11-23",
    title: null,
    series: null,
    isTemplate: false,
    shareVersion: 1,
    lastSharedVersion: null,
    targetSeconds: null,
    times: [{ id: "t1", kind: "service", label: "Service", startsAt: "2026-11-23T15:00:00Z" }],
    items: [
      item("w", "header", "Worship"),
      item("s1", "song", "Great Is Thy Faithfulness", {
        leaders: [{ personId: JANE, teamPositionId: null, name: "Jane Smith", positionLabel: null, photoUrl: null }],
      }),
      item("a1", "item", "Announcements"),
    ],
    notes: [],
    team: [],
    files: [file("f1", "s1", "song"), file("f2", "s1", "item"), file("f3", "a1", "item")],
    updatedAt: "2026-11-20T00:00:00Z",
  };
}

test("shared links never show the Team view: old team links read as the full plan with their categories", () => {
  assert.equal(sharedPreset("team"), "full");
  assert.equal(sharedPreset("person"), "person");
  const options = shareViewOptions({ preset: "team", categories: ["tech"], person_id: JANE });
  assert.equal(options.preset, "full");
  assert.deepEqual(options.categories, ["tech"]);
});

test("files show on their own rows, not in Order only, and only on rows a Person view includes", () => {
  const full = buildPlanView(plan(), shareViewOptions({ preset: "full", categories: [], person_id: null }));
  const byId = new Map(full.rows.map((r) => [r.id, r.files.map((f) => f.id)]));
  assert.deepEqual(byId.get("s1"), ["f1", "f2"]);
  assert.deepEqual(byId.get("a1"), ["f3"]);
  assert.deepEqual(byId.get("w"), []);

  const order = buildPlanView(plan(), shareViewOptions({ preset: "order", categories: [], person_id: null }));
  assert.ok(order.rows.every((r) => r.files.length === 0));

  const person = buildPlanView(plan(), shareViewOptions({ preset: "person", categories: [], person_id: JANE }));
  assert.deepEqual(
    person.rows.flatMap((r) => r.files.map((f) => f.id)),
    ["f1", "f2"],
  );
});

test("a person's own answer wins; otherwise their team rows decide; recipients default to not confirmed yet", () => {
  const names: Record<string, string> = { [JANE]: "Jane Smith", [SAM]: "Sam Lee", [LEE]: "Lee Park" };
  const result = attendanceFor(
    [
      { personId: JANE, status: "unconfirmed" },
      { personId: SAM, status: "confirmed" },
      { personId: SAM, status: "declined" },
    ],
    [{ person_id: JANE, status: "confirmed", share_id: "share-1", responded_at: "2026-11-21T10:00:00Z" }],
    [JANE, LEE],
    (id) => names[id],
  );
  assert.deepEqual(
    result.map((a) => [a.personName, a.status, a.onTeam, a.respondedAt]),
    [
      ["Jane Smith", "confirmed", true, "2026-11-21T10:00:00Z"],
      ["Sam Lee", "declined", true, null],
      ["Lee Park", "unconfirmed", false, null],
    ],
  );
});

test("answers set by staff (no share) show the status but no 'answered' time", () => {
  const [entry] = attendanceFor([], [{ person_id: LEE, status: "declined", share_id: null, responded_at: "2026-11-21T10:00:00Z" }], [], () => "Lee Park");
  assert.equal(entry.status, "declined");
  assert.equal(entry.respondedAt, null);
});

test("alert emails are cleaned, de-duplicated and capped", () => {
  assert.deepEqual(cleanAlertEmails(["Pastor@Church.org", " pastor@church.org ", "", "tech@church.org"]), [
    "pastor@church.org",
    "tech@church.org",
  ]);
  assert.deepEqual(cleanAlertEmails("a@b.org\nc@d.org; e@f.org"), ["a@b.org", "c@d.org", "e@f.org"]);
  assert.throws(() => cleanAlertEmails(["not an email"]), /isn’t an email address/);
  assert.throws(() => cleanAlertEmails(Array.from({ length: 11 }, (_, i) => `p${i}@church.org`)), /up to 10/);
});

test("alert phones become E.164 and reject what can't be texted", () => {
  assert.deepEqual(cleanAlertPhones(["502-555-0100", "(502) 555 0100", "+44 20 7946 0958"]), ["+15025550100", "+442079460958"]);
  assert.throws(() => cleanAlertPhones(["555-0100"]), /isn’t a mobile number/);
});

test("the alert text says who, what and when, and notes a changed answer", () => {
  const base = { churchName: "Grace Church", personName: "Jane Smith", serviceTypeName: "Sunday Morning", when: "Sunday, November 23" };
  assert.equal(
    answerSmsBody({ ...base, status: "confirmed", previous: null }),
    "Grace Church: Jane Smith will be there for Sunday Morning, Sunday, November 23.",
  );
  assert.match(answerSmsBody({ ...base, status: "declined", previous: "confirmed" }), /can’t make it \(changed their answer\)/);
});
