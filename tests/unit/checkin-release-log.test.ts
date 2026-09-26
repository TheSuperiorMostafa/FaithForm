import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  formatReleaseTime,
  noCodeReleaseSummary,
  staffLabel,
  UNKNOWN_STAFF_LABEL,
} from "@/lib/checkin/release-log";

const queries = readFileSync("lib/queries/checkin.ts", "utf8");
const page = readFileSync("app/dashboard/checkin/stats/page.tsx", "utf8");
const loading = readFileSync("app/dashboard/checkin/stats/loading.tsx", "utf8");
const log = readFileSync("components/checkin/no-code-release-log.tsx", "utf8");

function queryBody(name: string): string {
  const start = queries.indexOf(`export async function ${name}(`);
  assert.ok(start >= 0, `${name} exists`);
  const next = queries.indexOf("\nexport ", start + 10);
  return queries.slice(start, next === -1 ? undefined : next);
}

test("the team member is named, then emailed, never shown as an id", () => {
  assert.equal(staffLabel({ displayName: " Sarah Lee ", email: "sarah@church.org" }), "Sarah Lee");
  assert.equal(staffLabel({ displayName: "  ", email: "sarah@church.org" }), "sarah@church.org");
  assert.equal(staffLabel({ displayName: null, email: null }), UNKNOWN_STAFF_LABEL);
  assert.equal(staffLabel(null), UNKNOWN_STAFF_LABEL);
});

test("release times are on the church's clock", () => {
  const iso = "2026-09-20T15:42:00Z"; // Sunday
  assert.match(formatReleaseTime(iso, "America/New_York"), /Sun, Sep 20.* at 11:42\sAM/);
  assert.match(formatReleaseTime(iso, "America/Los_Angeles"), /Sun, Sep 20.* at 8:42\sAM/);
  // A bad zone name falls back rather than breaking the page.
  assert.ok(formatReleaseTime(iso, "Not/AZone").length > 0);
  assert.equal(formatReleaseTime("not a date", "UTC"), "");
});

test("the count line says how many, in plain words", () => {
  assert.equal(noCodeReleaseSummary(0, 8), "None in the last 8 weeks.");
  assert.equal(
    noCodeReleaseSummary(1, 4),
    "1 child released without a pickup code in the last 4 weeks.",
  );
  assert.equal(
    noCodeReleaseSummary(3, 13),
    "3 children released without a pickup code in the last 13 weeks.",
  );
});

test("the log reads only this church's releases without a code, newest first", () => {
  const body = queryBody("listNoCodeReleases");
  assert.match(body, /\.eq\("church_id", churchId\)/);
  assert.match(body, /\.eq\("checkout_method", "override"\)/);
  assert.match(body, /\.eq\("status", "checked_out"\)/);
  assert.match(body, /\.gte\("local_service_date", options\.sinceServiceDate\)/);
  assert.match(body, /\.order\("checked_out_at", \{ ascending: false \}\)/);
  assert.match(body, /checkout_override_reason/);
  // Hinted embeds: a session points at members twice.
  assert.match(body, /members!member_id/);
  assert.match(body, /members!checkout_released_to_member_id/);
});

test("team member names are looked up per person, never by paging every login", () => {
  assert.doesNotMatch(queries, /listUsers\(|listAuthUsers/);
  assert.match(queries, /getAuthUsersByIds\(unique\)/);
});

test("the log covers the same weeks as the numbers and sits under them", () => {
  assert.match(page, /pageFeatureBlocked\("checkin"\)/);
  assert.match(page, /recentServiceWeeks\(endWeekStart, weeks\)\[0\]/);
  assert.match(page, /listNoCodeReleases\(auth\.churchId, \{ sinceServiceDate \}/);
  assert.ok(page.indexOf("<LocationStatsTable") < page.indexOf("<NoCodeReleaseLog"));
  assert.match(page, /timeZone=\{auth\.churchTimezone\}/);
});

test("the log uses the shared list, empty and error states", () => {
  assert.match(log, /<List /);
  assert.match(log, /<ListRow/);
  assert.match(log, /<EmptyState/);
  assert.match(log, /<ErrorState/);
  assert.doesNotMatch(log, /error\.message/);
});

test("the loading skeleton mirrors the log with a real heading", () => {
  assert.match(loading, /NO_CODE_LOG_TITLE/);
  assert.match(loading, /NO_CODE_LOG_DESCRIPTION/);
  assert.match(loading, /SkeletonContainer/);
});
