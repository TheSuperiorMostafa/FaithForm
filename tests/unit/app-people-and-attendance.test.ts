import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  checkedInOtherwise,
  describePresence,
  getDaysPresentByMember,
  getPresenceByDate,
  getPresenceOnDate,
  isSundayIsoDate,
} from "@/lib/attendance/presence";
import { attendanceSectionTabs } from "@/lib/attendance/section-tabs";
import { filterNavByFeatures, isNavItemActive, navItems } from "@/components/dashboard/nav-items";
import { getAttendanceTrend } from "@/lib/queries/dashboard";
import { getMembersForChurch } from "@/lib/queries/members";
import {
  escapeLikePattern,
  personNameKey,
  splitPersonName,
  tidyPersonName,
} from "@/lib/people/names";

/**
 * The dashboard half of migration 0083: joining puts someone in People, and a
 * check-in is attendance. The database half runs against Postgres in
 * tests/database/app-people-and-attendance.test.ts.
 */

// ---------------------------------------------------------------------------
// Names mean what the database means by them
// ---------------------------------------------------------------------------

test("a name is the same name however it was typed or split", () => {
  assert.equal(tidyPersonName("  Mary   Ann  Smith "), "Mary Ann Smith");
  assert.equal(tidyPersonName("   "), null);
  assert.equal(personNameKey("Mary", "Ann Smith"), personNameKey("mary ann", "SMITH"));
  assert.equal(personNameKey("Cher", ""), "cher");
  assert.equal(personNameKey("", ""), null);
});

test("the last word is the last name, as split_person_name does it", () => {
  assert.deepEqual(splitPersonName("Mary Ann   Smith"), { firstName: "Mary Ann", lastName: "Smith" });
  assert.deepEqual(splitPersonName("Cher"), { firstName: "Cher", lastName: "" });
  assert.deepEqual(splitPersonName("  "), { firstName: "", lastName: "" });
});

test("a name can never widen a LIKE search", () => {
  assert.equal(escapeLikePattern("100%_a\\b"), "100\\%\\_a\\\\b");
});

// ---------------------------------------------------------------------------
// One answer to "who came"
// ---------------------------------------------------------------------------

function rpcClient(
  answers: Record<string, { data?: unknown; error?: { message: string } }>,
  calls: { name: string; args: Record<string, unknown> }[] = [],
): SupabaseClient {
  return {
    rpc: async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      const answer = answers[name] ?? { error: { message: `function ${name} does not exist` } };
      return { data: answer.data ?? null, error: answer.error ?? null };
    },
  } as unknown as SupabaseClient;
}

test("per-day totals come from the database, one row a day", async () => {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const supabase = rpcClient(
    {
      attendance_presence_by_date: {
        data: [
          { service_date: "2026-09-13", present: 3, absent: 1, checked_in: 2, automatic: 1, has_sheet: true },
        ],
      },
    },
    calls,
  );
  const days = await getPresenceByDate(supabase, "church-1", "2026-09-01", "2026-09-30");
  assert.deepEqual(days?.get("2026-09-13"), {
    present: 3,
    absent: 1,
    checkedIn: 2,
    automatic: 1,
    hasSheet: true,
  });
  assert.deepEqual(calls[0], {
    name: "attendance_presence_by_date",
    args: { p_church_id: "church-1", p_from: "2026-09-01", p_to: "2026-09-30" },
  });
});

test("without migration 0083 every reader says so with null, never a zero", async () => {
  const supabase = rpcClient({});
  const warn = console.warn;
  console.warn = () => {};
  try {
    assert.equal(await getPresenceByDate(supabase, "c", "2026-09-01", "2026-09-30"), null);
    assert.equal(await getPresenceOnDate(supabase, "c", "2026-09-13"), null);
    assert.equal(await getDaysPresentByMember(supabase, "c"), null);
  } finally {
    console.warn = warn;
  }
});

test("one person's ways of being recorded are gathered, once each", async () => {
  const supabase = rpcClient({
    attendance_presence: {
      data: [
        { member_id: "ann", service_date: "2026-09-13", method: "weekly" },
        { member_id: "ann", service_date: "2026-09-13", method: "automatic" },
        { member_id: "ann", service_date: "2026-09-13", method: "automatic" },
        { member_id: "ben", service_date: "2026-09-13", method: "room" },
        // A deleted person's sheet entry has no member to show.
        { member_id: null, service_date: "2026-09-13", method: "weekly" },
        // An unknown method is not trusted into the page.
        { member_id: "cal", service_date: "2026-09-13", method: "telepathy" },
      ],
    },
  });
  const presence = await getPresenceOnDate(supabase, "c", "2026-09-13");
  assert.deepEqual(Object.fromEntries(presence ?? []), {
    ann: ["weekly", "automatic"],
    ben: ["room"],
  });
  assert.deepEqual(checkedInOtherwise(presence?.get("ann")), ["automatic"]);
  assert.deepEqual(checkedInOtherwise(presence?.get("nobody")), []);
});

test("staff are told how someone was recorded, in words, in a stable order", () => {
  assert.equal(describePresence(["room", "automatic"]), "Checked in automatically · Room check-in");
  assert.equal(describePresence(["scanned"]), "Scanned the code");
  assert.equal(describePresence(["kiosk", "marked"]), "Kiosk · Marked on Services");
});

test("a Sunday is a Sunday in any timezone", () => {
  assert.equal(isSundayIsoDate("2026-09-13"), true);
  assert.equal(isSundayIsoDate("2026-09-16"), false);
  assert.equal(isSundayIsoDate("not-a-date"), false);
});

test("People counts days at church across every method when it can", async () => {
  const withoutSource = {
    id: "ann",
    first_name: "Ann",
    last_name: "Lee",
    phone: null,
    email: null,
    photo_url: null,
    is_active: true,
    attendance_entries: [{ count: 1 }],
  };
  const selects: string[] = [];
  const supabase = {
    from: () => {
      let columns = "";
      const query = {
        select: (value: string) => {
          columns = value;
          selects.push(value);
          return query;
        },
        eq: () => query,
        order: () => query,
        then: (resolve: (value: unknown) => void) =>
          resolve(
            // A database without migration 0083 has no `source` column.
            columns.includes("source")
              ? { data: null, error: { message: "column members.source does not exist" } }
              : { data: [withoutSource], error: null },
          ),
      };
      return query;
    },
    rpc: async () => ({
      data: [{ member_id: "ann", days_present: 4, last_present: "2026-09-13" }],
      error: null,
    }),
  } as unknown as SupabaseClient;

  const [ann] = await getMembersForChurch(supabase, "c", { includeAttendanceTotals: true });
  // The directory still loads without the new column…
  assert.equal(selects.length, 2);
  assert.equal(ann.source, "dashboard");
  // …and the count is every method's, not the weekly sheet's alone.
  assert.equal(ann.attendance_count, 4);
  assert.equal(ann.last_attended, "2026-09-13");

  // The check-in desk does not pay for totals it never shows.
  const desk = await getMembersForChurch(supabase, "c");
  assert.equal(desk[0].attendance_count, 1);
});

// ---------------------------------------------------------------------------
// One Attendance section
// ---------------------------------------------------------------------------

test("Attendance is one set of tabs, each shown to whoever holds its grant", () => {
  const labels = (allowed: Parameters<typeof attendanceSectionTabs>[0]) =>
    attendanceSectionTabs(allowed).map((tab) => tab.label);

  assert.deepEqual(labels(["attendance", "attendance_follow_up", "checkin"]), [
    "Weekly",
    "Follow-up",
    "Events",
    "Automatic Attendance",
    "Kids check-in",
  ]);
  assert.deepEqual(labels(["checkin"]), ["Kids check-in"]);
  assert.deepEqual(labels(["attendance_follow_up"]), ["Follow-up"]);
  assert.deepEqual(labels(["people"]), []);
});

test("the sidebar has one Attendance row, and it covers kids check-in", () => {
  assert.equal(navItems.filter((item) => item.href === "/dashboard/checkin").length, 0);

  const everything = filterNavByFeatures(navItems, ["attendance", "checkin"]);
  const attendance = everything.find((item) => item.label === "Attendance");
  assert.equal(attendance?.href, "/dashboard/attendance");
  assert.equal(isNavItemActive("/dashboard/checkin/stats", attendance!), true);
  assert.equal(isNavItemActive("/dashboard/attendance/services", attendance!), true);
  assert.equal(isNavItemActive("/dashboard/people", attendance!), false);

  // Someone who holds only the room desk still finds it, one click away.
  const deskOnly = filterNavByFeatures(navItems, ["checkin"]);
  assert.equal(deskOnly.find((item) => item.label === "Attendance")?.href, "/dashboard/checkin");

  // And someone with neither grant does not see the row at all.
  assert.equal(
    filterNavByFeatures(navItems, ["people"]).some((item) => item.label === "Attendance"),
    false,
  );
});

test("Home stays exact while every other row owns its nested routes", () => {
  const home = navItems.find((item) => item.href === "/dashboard")!;
  assert.equal(isNavItemActive("/dashboard", home), true);
  assert.equal(isNavItemActive("/dashboard/people", home), false);
});

// ---------------------------------------------------------------------------
// The pages read the one answer
// ---------------------------------------------------------------------------

const read = (path: string) => readFileSync(path, "utf8");

test("the weekly pages, follow-up, the chart and the report count check-ins", () => {
  assert.match(read("app/dashboard/attendance/(record)/page.tsx"), /getPresenceByDate\(/);
  assert.match(read("app/dashboard/attendance/(record)/[date]/page.tsx"), /getPresenceOnDate\(/);
  assert.match(read("lib/queries/dashboard.ts"), /getPresenceByDate\(/);
  assert.match(read("app/api/reports/attendance/[month]/route.ts"), /getPresenceByDate\(/);

  // Nobody checked in gets a "we missed you" text — on the page, or by replaying the action.
  assert.match(read("app/dashboard/attendance/follow-up/page.tsx"), /cameAnyway\(entry\.member\.id\)/);
  assert.match(
    read("app/dashboard/attendance/follow-up/actions.ts"),
    /checkedInOtherwise\(presence\?\.get\(entry\.member_id\)\)\.length > 0/,
  );
});

test("the weekly sheet starts with everyone already checked in marked present", () => {
  const wizard = read("app/dashboard/attendance/(record)/[date]/attendance-wizard.tsx");
  assert.match(wizard, /isCheckedIn\(memberId\) \? "present" : "unmarked"/);
  // A check-in cannot be un-counted from the sheet.
  assert.match(wizard, /function setMemberStatus\(memberId: string, status: MemberStatus\) \{\s+if \(isCheckedIn\(memberId\)\) return;/);
});

test("People shows who is on the app only where the church offers the app", () => {
  const page = read("app/dashboard/people/page.tsx");
  assert.match(page, /access\?\.flags\.member_app/);
  assert.match(page, /showAppStatus\s*\?\s*listAppConnections\(supabase, auth\.churchId\)/);
  assert.match(page, /<PeopleClaimsPanel/);
  assert.match(page, /<AppMembersNotInPeoplePanel/);
});


test("dashboard attendance includes a Saturday automatic check-in without a weekly sheet", async () => {
  const client = rpcClient({
    attendance_presence_by_date: { data: [
      { service_date: "2026-09-19", present: 1, absent: 0, checked_in: 1, automatic: 1, has_sheet: false },
      { service_date: "2026-09-13", present: 3, absent: 0, checked_in: 0, automatic: 0, has_sheet: true },
      { service_date: "2026-09-16", present: 0, absent: 0, checked_in: 0, automatic: 0, has_sheet: false },
    ] },
  });
  const trend = await getAttendanceTrend(client, "church-1");
  assert.deepEqual(trend.points.map(p => [p.serviceDate, p.present]), [
    ["2026-09-13", 3], ["2026-09-19", 1],
  ]);
  assert.equal(trend.lastPresent, 1);
  assert.equal(trend.lastServiceDate, "2026-09-19");
  assert.equal(trend.points[1].weekLabel, "Sep 19");
});
