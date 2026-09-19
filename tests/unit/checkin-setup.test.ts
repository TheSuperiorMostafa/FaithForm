import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { readinessProblem } from "@/lib/attendance/v2/geofence-config";
import { appReportFor } from "@/lib/attendance/v2/phone-check";
import {
  ARRIVAL_CHOICES,
  SERVICE_TEMPLATES,
  addClockMinutes,
  checkinWindow,
  clockMinutes,
  formatClock,
  minutesPhrase,
  nearestChoice,
  suggestServiceName,
  withCurrentChoice,
} from "@/lib/attendance/v2/setup-view";

/**
 * Check-in setup: the rules behind "is automatic check-in live?", "what will
 * my phone say?", and the times and names the setup screens show.
 */

// ---------------------------------------------------------------------------
// Why a church is not live
// ---------------------------------------------------------------------------

test("a church that has not switched it on is told so, before anything about a location", () => {
  // The case behind "Your church has not added a location" for a church that
  // simply had not set automatic check-in up.
  assert.equal(
    readinessProblem({ switchedOn: false, featureEnabled: true, regionCount: 0 }),
    "geofence_disabled",
  );
  assert.equal(
    readinessProblem({ switchedOn: true, featureEnabled: false, regionCount: 2 }),
    "geofence_disabled",
  );
  assert.equal(
    readinessProblem({ switchedOn: true, featureEnabled: true, regionCount: 0 }),
    "no_campus_configured",
  );
  assert.equal(readinessProblem({ switchedOn: true, featureEnabled: true, regionCount: 1 }), null);
});

// ---------------------------------------------------------------------------
// What the app on a phone reports
// ---------------------------------------------------------------------------

test("one church that works is enough for the app", () => {
  assert.deepEqual(
    appReportFor(
      [
        { churchId: "a", name: "A Test Church", verdict: "no_campus_configured" },
        { churchId: "g", name: "Grace", verdict: "ready" },
      ],
      "g",
    ),
    { kind: "watching", churchNames: ["Grace"] },
  );
});

test("when every church refuses, the app reports the first by address — even another church's reason", () => {
  const report = appReportFor(
    [
      { churchId: "a", name: "A Test Church", verdict: "no_campus_configured" },
      { churchId: "g", name: "Grace", verdict: "no_people_link" },
    ],
    "g",
  );
  assert.deepEqual(report, {
    kind: "refused",
    churchName: "A Test Church",
    reason: "no_campus_configured",
    isThisChurch: false,
  });

  assert.equal(
    appReportFor([{ churchId: "g", name: "Grace", verdict: "geofence_disabled" }], "g")?.kind,
    "refused",
  );
  assert.equal(appReportFor([], "g"), null);
});

// ---------------------------------------------------------------------------
// Times
// ---------------------------------------------------------------------------

test("clock times round-trip and read the way a church writes them", () => {
  assert.equal(clockMinutes("09:30"), 570);
  assert.equal(clockMinutes("24:00"), null);
  assert.equal(clockMinutes(""), null);
  assert.equal(formatClock("09:00"), "9 AM");
  assert.equal(formatClock("19:05"), "7:05 PM");
  assert.equal(formatClock("00:00"), "12 AM");
  assert.equal(formatClock("12:30"), "12:30 PM");
  assert.equal(addClockMinutes("23:30", 90), "01:00");
});

test("a check-in window reads as clock times around the service", () => {
  assert.deepEqual(
    checkinWindow({ startTime: "10:00", endTime: "11:30", opensMinutesBefore: 30, closesMinutesAfter: 30 }),
    { opens: "09:30", starts: "10:00", ends: "11:30", closes: "12:00" },
  );
  // No end time: the service is taken to last ninety minutes.
  assert.equal(
    checkinWindow({ startTime: "19:00", endTime: null, opensMinutesBefore: 15, closesMinutesAfter: 0 }).ends,
    "20:30",
  );
  // A late service runs past midnight rather than ending before it starts.
  assert.equal(
    checkinWindow({ startTime: "23:00", endTime: "00:30", opensMinutesBefore: 0, closesMinutesAfter: 60 }).closes,
    "01:30",
  );
});

test("a new service names itself from when it is", () => {
  assert.equal(suggestServiceName(0, "10:00"), "Sunday Worship");
  assert.equal(suggestServiceName(0, "18:00"), "Sunday Evening Service");
  assert.equal(suggestServiceName(3, "19:00"), "Wednesday Night");
  assert.equal(suggestServiceName(6, "17:00"), "Saturday Evening Service");
  assert.equal(suggestServiceName(4, "09:00"), "Thursday Service");
});

test("every template is a schedule the server will accept", () => {
  for (const template of SERVICE_TEMPLATES) {
    assert.ok(template.rows.length > 0, template.id);
    for (const row of template.rows) {
      const start = clockMinutes(row.startTime);
      const end = clockMinutes(row.endTime);
      assert.ok(start !== null && end !== null && end > start, `${template.id}: ${row.label}`);
      assert.ok(row.dayOfWeek >= 0 && row.dayOfWeek <= 6);
      assert.ok(row.label.trim().length > 0);
    }
  }
});

test("a saved value that is not one of the choices is still offered", () => {
  assert.deepEqual(withCurrentChoice([0, 15, 30], 20), [0, 15, 20, 30]);
  assert.deepEqual(withCurrentChoice([0, 15, 30], 15), [0, 15, 30]);
  assert.equal(nearestChoice([50, 100, 150], 120), 100);
  assert.equal(minutesPhrase(60), "1 hr");
  assert.equal(minutesPhrase(45), "45 min");
  // A wait of under half a minute is refused by the server when one is required.
  for (const choice of ARRIVAL_CHOICES) {
    assert.ok(choice.seconds === 0 || choice.seconds >= 30, choice.label);
  }
});

// ---------------------------------------------------------------------------
// What the screens may do
// ---------------------------------------------------------------------------

const read = (path: string) => readFileSync(path, "utf8");

test("the phone check is only ever about the signed-in person", () => {
  const actions = read("app/dashboard/attendance/setup/actions.ts");
  const getSetup = actions.slice(
    actions.indexOf("export async function getCheckinSetup"),
    actions.indexOf("export async function saveCheckinPolicy"),
  );
  // The user id comes from the session context, never a payload.
  assert.match(getSetup, /const \{ churchId, userId \} = await requireSetupViewer\(\);/);
  assert.match(getSetup, /checkMyPhone\(\{ userId, churchId, client: admin \}\)/);

  const phone = read("lib/attendance/v2/phone-check.ts");
  assert.match(phone, /getVisitorAccount\(input\.userId\)/);
  // Its own relationships, link and claim — by account id, nothing broader.
  for (const table of ["visitor_church_relationships", "visitor_people_links", "visitor_people_claims"]) {
    const query = phone.slice(phone.indexOf(`.from("${table}")`), phone.indexOf(`.from("${table}")`) + 300);
    assert.match(query, /\.eq\("account_id", account\.id\)/, table);
  }
});

test("the dashboard and the phones judge a church with the same function", () => {
  const config = read("lib/attendance/v2/geofence-config.ts");
  const build = config.slice(config.indexOf("export async function buildGeofenceConfiguration"));
  assert.match(build, /await readChurchAutomaticReadiness\(churchId, \{ client: admin, now \}\)/);
  assert.match(read("app/dashboard/attendance/setup/actions.ts"), /readChurchAutomaticReadiness\(churchId/);
  assert.match(read("app/dashboard/app/page.tsx"), /readChurchAutomaticReadiness\(auth\.churchId\)/);
});

test("the admin's own location is read only when they ask for it", () => {
  const editor = read("components/attendance/campus-location-editor.tsx");
  const effect = editor.slice(editor.indexOf("useEffect("), editor.indexOf("}, []);"));
  assert.doesNotMatch(effect, /geolocation/, "location read on opening the editor");
  assert.match(editor, /const locateMe = \(\) => \{/);
  assert.match(editor, /onClick=\{locateMe\}/);
});
