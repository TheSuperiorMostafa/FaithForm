import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  draftHasWork,
  draftKey,
  parseDraft,
} from "@/components/attendance/attendance-draft";
import { serviceStatus } from "@/components/attendance/service-status";
import {
  describeFollowUpFailure,
  followUpFailureReason,
} from "@/lib/attendance/follow-up-errors";
import {
  describeTemplateAudience,
  groupFollowUpMessages,
  personalizeFollowUpMessage,
  validateFollowUpOverride,
} from "@/lib/attendance/follow-up-message";
import { describeNameCount, parseHeadcount } from "@/lib/attendance/headcount";
import { MAX_SUNDAYS, parseWeeksParam, recentSundays } from "@/lib/attendance/sundays";
import { isMainBoardOccurrence, type ServiceOccurrence } from "@/lib/attendance/v2/occurrences";
import { TEXTING_NOT_CONNECTED } from "@/lib/attendance/send-follow-up-texts";
import { DEFAULT_FOLLOW_UP_TEMPLATES } from "@/lib/sms/follow-up-messages";

const read = (path: string) => readFileSync(path, "utf8");

// ---------------------------------------------------------------------------
// "Just a number"
// ---------------------------------------------------------------------------

test("a headcount is a whole number between 1 and 100,000", () => {
  assert.deepEqual(parseHeadcount("142"), { ok: true, count: 142 });
  assert.deepEqual(parseHeadcount(" 1,204 "), { ok: true, count: 1204 });
  assert.deepEqual(parseHeadcount(87), { ok: true, count: 87 });
  for (const bad of ["", "0", "-3", "12.5", "about 40", "100001"]) {
    assert.equal(parseHeadcount(bad).ok, false, bad);
  }
  assert.equal(describeNameCount(142, 38), "142 here, 38 not here");
});

test("a headcount is saved with no names and never overwrites a Sunday saved by name", () => {
  const actions = read("app/dashboard/attendance/(record)/[date]/actions.ts");
  const headcount = actions.slice(actions.indexOf("async function saveHeadcount"), actions.indexOf("function tally"));
  // Scoped to this church, like every other write here.
  assert.match(headcount, /\.eq\("church_id", churchId\)/);
  assert.match(headcount, /total_present: count/);
  assert.match(headcount, /This Sunday was counted by name/);
  assert.doesNotMatch(headcount, /attendance_entries"\)\.(insert|upsert|delete)/);
  // The same feature guard as saving names.
  const submit = actions.slice(actions.indexOf("export async function submitAttendance"));
  assert.ok(submit.indexOf("resolveChurchContext()") < submit.indexOf("saveHeadcount("));
  assert.match(submit, /Save either a number or names, not both/);
});

test("every reader treats a Sunday's total as a floor, so a headcount shows everywhere", () => {
  const migration = read("supabase/migrations/0083_app_members_in_people_and_one_attendance.sql");
  assert.match(migration, /greatest\(coalesce\(d\.present, 0\), coalesce\(s\.total_present, 0\)\)/);
  assert.match(read("lib/queries/dashboard.ts"), /getPresenceByDate\(/);
  assert.match(read("app/api/reports/attendance/[month]/route.ts"), /getPresenceByDate\(/);
  // Follow-up says there are no names rather than "everyone was here".
  assert.match(read("app/dashboard/attendance/follow-up/follow-up-board.tsx"), /counted as one number/);
});

// ---------------------------------------------------------------------------
// Counting by name
// ---------------------------------------------------------------------------

test("saving by name is never blocked by people left unmarked, and is confirmed first", () => {
  const wizard = read("app/dashboard/attendance/(record)/[date]/attendance-wizard.tsx");
  assert.doesNotMatch(wizard, /disabled=\{counts\.unmarked > 0/);
  assert.match(wizard, /Anyone not marked counts as not here/);
  assert.match(wizard, /status: \(m\.status === "present" \? "present" : "absent"\)/);
  assert.match(wizard, /confirmAction\(\{[\s\S]*?confirmLabel: "Save attendance"/);
  assert.match(wizard, /describeNameCount\(present, absent\)/);
  // Nothing raw reaches the page from a failed save.
  assert.doesNotMatch(wizard, /\.message\)/);
});

test("the draft survives leaving the page and is cleared once saved", () => {
  const wizard = read("app/dashboard/attendance/(record)/[date]/attendance-wizard.tsx");
  assert.match(wizard, /readDraft\(storageKey\)/);
  assert.match(wizard, /writeDraft\(storageKey, draft\)/);
  assert.equal((wizard.match(/clearDraft\(storageKey\);\n\s+setSaved/g) ?? []).length, 2);

  assert.equal(draftKey("2026-09-20"), "faithform:attendance-draft:2026-09-20");
  assert.notEqual(draftKey("2026-09-20", true), draftKey("2026-09-20"));

  const now = Date.now();
  const good = JSON.stringify({
    version: 1,
    mode: "names",
    statuses: { a: "present", b: "absent", c: "maybe" },
    headcount: "",
    notes: "",
    savedAt: now,
  });
  assert.deepEqual(parseDraft(good, now)?.statuses, { a: "present", b: "absent" });
  assert.equal(parseDraft("not json", now), null);
  assert.equal(parseDraft(JSON.stringify({ version: 2 }), now), null);
  // A three-week-old draft is stale.
  assert.equal(parseDraft(good, now + 1000 * 60 * 60 * 24 * 30), null);

  assert.equal(draftHasWork({ statuses: {}, headcount: " ", notes: "" }), false);
  assert.equal(draftHasWork({ statuses: {}, headcount: "40", notes: "" }), true);
});

test("the draft module is safe without storage and imports nothing", () => {
  const source = read("components/attendance/attendance-draft.ts");
  assert.doesNotMatch(source, /^import /m);
  for (const call of ["getItem", "setItem", "removeItem"]) {
    const index = source.indexOf(`.${call}(`);
    assert.ok(index > 0, call);
    assert.ok(source.lastIndexOf("try {", index) > source.lastIndexOf("}\n\nexport", index), `${call} is not wrapped`);
  }
});

// ---------------------------------------------------------------------------
// More Sundays, plain tabs
// ---------------------------------------------------------------------------

test("earlier Sundays come eight at a time, up to a year", () => {
  assert.equal(parseWeeksParam(undefined), 8);
  assert.equal(parseWeeksParam("nonsense"), 8);
  assert.equal(parseWeeksParam("16"), 16);
  assert.equal(parseWeeksParam("17"), 24);
  assert.equal(parseWeeksParam("999"), MAX_SUNDAYS);

  const sundays = recentSundays(new Date("2026-09-23T15:00:00Z"), "America/New_York", 16);
  assert.equal(sundays.length, 16);
  assert.equal(sundays[0], "2026-09-20");
  assert.equal(sundays[1], "2026-09-13");
  for (const date of sundays) {
    assert.equal(new Date(`${date}T12:00:00Z`).getUTCDay(), 0, date);
  }
});

test("the Sunday count page offers earlier Sundays, any date, and monthly reports", () => {
  const page = read("app/dashboard/attendance/(record)/page.tsx");
  assert.match(page, /Show earlier Sundays/);
  assert.match(page, /<SundayDatePicker/);
  assert.match(page, /access\?\.allowed\.includes\("library"\)/);
  assert.match(page, /href="\/dashboard\/library"/);
  assert.doesNotMatch(page, /max-w-(3xl|4xl|5xl|6xl)/);
});

// ---------------------------------------------------------------------------
// Follow-up
// ---------------------------------------------------------------------------

test("the pastor sees the exact text, and may reword it for one send", () => {
  assert.deepEqual(validateFollowUpOverride("  Hi [Name], we missed you!  "), {
    ok: true,
    message: "Hi [Name], we missed you!",
  });
  const missingName = validateFollowUpOverride("We missed you!");
  assert.equal(missingName.ok, false);
  assert.ok(!missingName.ok && /^Include \[Name\]/.test(missingName.error), JSON.stringify(missingName));
  assert.equal(validateFollowUpOverride("").ok, false);
  assert.equal(validateFollowUpOverride(`[Name] ${"x".repeat(500)}`).ok, false);

  assert.equal(personalizeFollowUpMessage("Hi [Name]! See you [Name].", "Maria"), "Hi Maria! See you Maria.");

  const groups = groupFollowUpMessages(
    [
      { firstName: "Maria", consecutiveAbsent: 1 },
      { firstName: "Tom", consecutiveAbsent: 1 },
      { firstName: "Ruth", consecutiveAbsent: 9 },
    ],
    [...DEFAULT_FOLLOW_UP_TEMPLATES],
  );
  assert.equal(groups.length, 2);
  assert.equal(groups[0].count, 2);
  assert.equal(groups[0].preview, DEFAULT_FOLLOW_UP_TEMPLATES[0].replaceAll("[Name]", "Maria"));
  assert.equal(groups[1].index, 4);
  assert.equal(describeTemplateAudience(0), "missed one Sunday");
  assert.equal(describeTemplateAudience(4), "missed 5 or more Sundays in a row");
});

test("the reworded message is validated on the server and sent as written", () => {
  const actions = read("app/dashboard/attendance/follow-up/actions.ts");
  assert.match(actions, /validateFollowUpOverride\(String\(input\.message\)\)/);
  assert.match(actions, /\{ messageTemplate \}/);
  // Guards unchanged, raw database text gone.
  assert.match(actions, /featureActionError\("attendance_follow_up"\)/);
  assert.doesNotMatch(actions, /error: entriesError\.message|error: markError\.message/);

  const sender = read("lib/attendance/send-follow-up-texts.ts");
  assert.match(sender, /options\.messageTemplate\s*\?\s*personalizeFollowUpMessage\(options\.messageTemplate, member\.firstName\)/);
});

test("sending texts asks first, naming how many", () => {
  const board = read("app/dashboard/attendance/follow-up/follow-up-board.tsx");
  assert.match(board, /title: `Text \$\{people\(count\)\} now\?`/);
  assert.match(board, /confirmLabel: `Send \$\{texts\(count\)\}`/);
  assert.match(board, /destructive: true/);
});

test("a texting failure is shown as a plain reason, never the raw response", () => {
  assert.equal(followUpFailureReason(null), null);
  assert.equal(followUpFailureReason(TEXTING_NOT_CONNECTED), "not_connected");
  assert.equal(followUpFailureReason("No phone number on file"), "no_phone");
  assert.equal(
    followUpFailureReason('{"code":21610,"message":"Attempt to send to unsubscribed recipient"}'),
    "opted_out",
  );
  assert.equal(followUpFailureReason('{"code":21211,"message":"Invalid \'To\' Phone Number"}'), "bad_number");
  assert.equal(followUpFailureReason("Invalid phone number on file"), "bad_number");
  assert.equal(followUpFailureReason('{"code":21614,"message":"not a mobile number"}'), "cannot_receive");
  assert.equal(followUpFailureReason("<html>502 Bad Gateway</html>"), "unknown");
  assert.doesNotMatch(describeFollowUpFailure("<html>502</html>") ?? "", /html|502/);

  for (const path of [
    "app/dashboard/attendance/follow-up/follow-up-board.tsx",
    "app/dashboard/attendance/follow-up/log/follow-up-log.tsx",
    "app/dashboard/attendance/(record)/[date]/attendance-summary.tsx",
  ]) {
    const source = read(path);
    assert.doesNotMatch(source, /\{(candidate|entry)\.error\}/, path);
    assert.doesNotMatch(source, /label: entry\.follow_up_error/, path);
    assert.match(source, /describeFollowUpFailure\(/, path);
  }
});

// ---------------------------------------------------------------------------
// Services
// ---------------------------------------------------------------------------

test("a service's status is one of four plain words", () => {
  const base = {
    checkinOpensAtUtc: "2026-09-20T13:30:00Z",
    checkinClosesAtUtc: "2026-09-20T16:00:00Z",
  };
  const at = (iso: string) => Date.parse(iso);
  assert.deepEqual(serviceStatus({ ...base, status: "scheduled" }, at("2026-09-20T10:00:00Z")).label, "Upcoming");
  assert.deepEqual(serviceStatus({ ...base, status: "active" }, at("2026-09-20T14:00:00Z")).label, "Check-in open");
  assert.deepEqual(serviceStatus({ ...base, status: "scheduled" }, at("2026-09-20T18:00:00Z")).label, "Done");
  assert.deepEqual(serviceStatus({ ...base, status: "completed" }, at("2026-09-20T14:00:00Z")).label, "Done");
  assert.deepEqual(serviceStatus({ ...base, status: "cancelled" }, at("2026-09-20T14:00:00Z")).label, "Cancelled");
});

test("weekday services from the schedule are on Services, beneath Sunday worship", () => {
  const occurrence = (overrides: Partial<ServiceOccurrence>): ServiceOccurrence => ({
    id: "o",
    churchId: "c",
    campusId: null,
    campusName: null,
    label: "Sunday Worship",
    localServiceDate: "2026-09-20",
    timezone: "America/New_York",
    startsAtUtc: "2026-09-20T14:00:00Z",
    endsAtUtc: "2026-09-20T15:30:00Z",
    checkinOpensAtUtc: "2026-09-20T13:30:00Z",
    checkinClosesAtUtc: "2026-09-20T16:00:00Z",
    status: "scheduled",
    generationSource: "schedule",
    policyVersion: 1,
    calendarEventId: null,
    ...overrides,
  });
  assert.equal(isMainBoardOccurrence(occurrence({})), true);
  assert.equal(isMainBoardOccurrence(occurrence({ calendarEventId: "e" , label: "Youth night" })), true);
  assert.equal(isMainBoardOccurrence(occurrence({ label: "Bible Study", localServiceDate: "2026-09-23" })), false);

  const board = read("components/attendance/service-occurrences-board.tsx");
  assert.match(board, /Other services on your schedule/);
  assert.match(read("app/dashboard/attendance/services/page.tsx"), /other=\{board\.other\}/);
});

test("a board that fails to load says so, instead of looking empty", () => {
  const actions = read("app/dashboard/attendance/services/actions.ts");
  const board = actions.slice(actions.indexOf("export async function getServicesBoard"), actions.indexOf("export async function getOccurrenceRoster"));
  assert.match(board, /return \{ \.\.\.empty, failed: true \}/);
  const page = read("app/dashboard/attendance/services/page.tsx");
  assert.match(page, /board\.failed \?/);
  assert.match(page, /<RetryErrorState/);
  assert.doesNotMatch(read("components/attendance/service-occurrences-board.tsx"), /No attendance events yet/);
});

test("marking everyone and cancelling a service are confirmed with their consequences", () => {
  const board = read("components/attendance/service-occurrences-board.tsx");
  assert.match(board, /confirmLabel: `Mark \$\{people\(unmarked\.length\)\} here`/);
  assert.match(board, /confirmLabel: "Cancel service"/);
  assert.match(board, /can't be un-cancelled/);
  assert.doesNotMatch(board, /Refresh from schedule/);
  assert.doesNotMatch(board, /window\.confirm/);
  // The roster is brought into view when opened on a narrow screen.
  assert.match(board, /panelRef\.current\?\.scrollIntoView/);
  // No tiny text for anything a person reads to decide.
  assert.doesNotMatch(board, /text-\[1[01]px\]|text-xs/);
});

test("services actions never show a bare error code", () => {
  const actions = read("app/dashboard/attendance/services/actions.ts");
  assert.doesNotMatch(actions, /return toVisitorResult\(error\)/);
  assert.match(actions, /Only a church admin can do that\./);
});

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

test("setup starts with service times, and the map only appears with phone check-in on", () => {
  const setup = read("components/attendance/checkin-setup.tsx");
  const services = setup.indexOf('id="setup-services"');
  const phone = setup.indexOf('id="setup-phone"');
  const location = setup.indexOf('id="setup-location"');
  assert.ok(services > 0 && services < phone && phone < location, "order");
  assert.match(setup, /Let people check in on their phone when they arrive/);
  assert.match(setup.slice(phone), /\{phoneOn \? \(/);

  const editor = read("components/attendance/campus-location-editor.tsx");
  const advanced = editor.indexOf("<AdvancedSection");
  assert.ok(advanced > 0 && advanced < editor.indexOf('type="range"'), "radius is not under Advanced");
  assert.ok(advanced < editor.indexOf("campus-lat-"), "coordinates are not under Advanced");
});

test("setup targets are at least 44px and labels are readable", () => {
  const schedule = read("components/attendance/service-schedule-editor.tsx");
  assert.match(schedule, /"flex size-11 items-center justify-center rounded-full/);
  assert.doesNotMatch(schedule, /text-xs/);
  const step = read("components/attendance/setup-step.tsx");
  assert.match(step, /flex min-h-11 flex-col items-center justify-center rounded-lg/);
  assert.doesNotMatch(step, /text-\[10px\]|text-xs/);
});

// ---------------------------------------------------------------------------
// Every route has a matching skeleton, with no page-level max width
// ---------------------------------------------------------------------------

test("every attendance route has a loading skeleton at the shell's width", () => {
  for (const path of [
    "app/dashboard/attendance/loading.tsx",
    "app/dashboard/attendance/(record)/[date]/loading.tsx",
    "app/dashboard/attendance/follow-up/loading.tsx",
    "app/dashboard/attendance/follow-up/log/loading.tsx",
    "app/dashboard/attendance/services/loading.tsx",
    "app/dashboard/attendance/setup/loading.tsx",
  ]) {
    const source = read(path);
    assert.match(source, /<SkeletonContainer className="flex w-full flex-col gap-8"/, path);
    assert.doesNotMatch(source, /max-w-(3xl|4xl|5xl|6xl)/, path);
  }
  assert.doesNotMatch(read("app/dashboard/attendance/layout.tsx"), /max-w-3xl/);
});
