import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  defaultStatementYear,
  parseStatementYear,
  statementYearOptions,
} from "@/lib/giving/statement-year";
import { toUserError, UserFacingError } from "@/lib/errors/user-error";
import { RELATIONSHIP_LABELS } from "@/types/checkin";

const read = (path: string) => readFileSync(path, "utf8");

// ---------------------------------------------------------------------------
// Year-end statements are for the year that just ended
// ---------------------------------------------------------------------------

test("in January–March, statements default to last year", () => {
  assert.equal(defaultStatementYear(new Date(2027, 0, 15)), 2026);
  assert.equal(defaultStatementYear(new Date(2027, 2, 31)), 2026);
});

test("from April, statements default to the year in progress", () => {
  assert.equal(defaultStatementYear(new Date(2027, 3, 1)), 2027);
  assert.equal(defaultStatementYear(new Date(2027, 11, 31)), 2027);
});

test("a requested year is honoured, a nonsense or future one is not", () => {
  const now = new Date(2027, 0, 10);
  assert.equal(parseStatementYear("2025", now), 2025);
  assert.equal(parseStatementYear("2031", now), 2026);
  assert.equal(parseStatementYear("abc", now), 2026);
  assert.equal(parseStatementYear(null, now), 2026);
  assert.deepEqual(statementYearOptions(now, 3), [2027, 2026, 2025]);
});

test("both statement routes and the page use the shared year rule", () => {
  for (const path of [
    "app/api/dashboard/giving/statements/generate/route.ts",
    "app/api/dashboard/giving/statements/[donorId]/route.ts",
    "app/dashboard/giving/statements/page.tsx",
  ]) {
    const source = read(path);
    assert.match(source, /parseStatementYear\(/, path);
    assert.doesNotMatch(source, /new Date\(\)\.getFullYear\(\)/, path);
  }
});

// ---------------------------------------------------------------------------
// Nobody becomes a guardian by default
// ---------------------------------------------------------------------------

test("adding someone to a family has no default relationship", () => {
  for (const path of [
    "components/people/member-care-panel.tsx",
    "components/people/household-detail.tsx",
  ]) {
    const source = read(path);
    assert.match(
      source,
      /name="relationship" required defaultValue="">\s*<option value="" disabled>/,
      path,
    );
  }
  assert.equal(RELATIONSHIP_LABELS.guardian, "Parent or guardian");
});

// ---------------------------------------------------------------------------
// A Sunday is never left saved with nobody on it, and can be corrected
// ---------------------------------------------------------------------------

test("attendance names failing to save removes the half-saved Sunday", () => {
  const actions = read("app/dashboard/attendance/(record)/[date]/actions.ts");
  assert.match(
    actions,
    /if \(entriesError\) \{\s+await supabase\.from\("attendance_records"\)\.delete\(\)\.eq\("id", record\.id\)/,
  );
  // Raw database text is not shown to the person.
  assert.doesNotMatch(actions, /entriesError\.message/);
  assert.doesNotMatch(actions, /recordError\?\.message/);
});

test("a saved Sunday can be edited without losing follow-up history", () => {
  const actions = read("app/dashboard/attendance/(record)/[date]/actions.ts");
  assert.match(actions, /onConflict: "record_id,member_id"/);
  // The upsert writes status only, so follow-up columns survive.
  const upsert = actions.slice(actions.indexOf(".upsert("), actions.indexOf("onConflict"));
  assert.doesNotMatch(upsert, /follow_up/);
  const summary = read("app/dashboard/attendance/(record)/[date]/attendance-summary.tsx");
  assert.match(summary, /Edit attendance/);
  assert.match(summary, /\?edit=1/);
});

// ---------------------------------------------------------------------------
// Honest onboarding summary
// ---------------------------------------------------------------------------

test("onboarding never claims a step that did not happen", () => {
  const done = read("components/onboarding/steps/step-done.tsx");
  assert.doesNotMatch(done, /\|\| true/);
});

// ---------------------------------------------------------------------------
// Errors in plain words
// ---------------------------------------------------------------------------

test("known database failures become plain sentences", () => {
  const original = console.error;
  console.error = () => undefined;
  try {
    assert.match(toUserError({ code: "23505", message: "duplicate key value" }, "x"), /already exists/);
    assert.match(toUserError({ code: "42501", message: "permission denied" }, "x"), /permission/);
    const fallback = toUserError({ message: 'relation "x" does not exist' }, "We couldn't save this person.");
    assert.match(fallback, /^We couldn't save this person\. Please try again/);
    assert.doesNotMatch(fallback, /relation/);
    assert.equal(toUserError(new UserFacingError("Pick a room."), "x"), "Pick a room.");
  } finally {
    console.error = original;
  }
});

test("no developer commands are shown to churches", () => {
  for (const path of [
    "app/dashboard/announcements/actions.ts",
    "app/dashboard/people/file-actions.ts",
    "app/dashboard/settings/actions.ts",
    "components/settings/team-members-card.tsx",
  ]) {
    // Comments may mention the command for engineers; strings may not.
    const code = read(path)
      .split("\n")
      .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
      .join("\n");
    assert.ok(!/`pnpm /.test(code), `${path} shows a pnpm command`);
  }
});

// ---------------------------------------------------------------------------
// A series week opens a sermon that belongs to the series
// ---------------------------------------------------------------------------

test("starting a sermon from a series week keeps the series and passage", () => {
  const page = read("app/dashboard/sermon-builder/new/page.tsx");
  assert.match(page, /seriesId=\{query\.series\}/);
  assert.match(page, /parsePassage\(query\.scripture\)/);
  const route = read("app/api/sermon/simple/route.ts");
  assert.match(route, /ownSeriesId\(auth\.churchId, body\.series_id\)/);
});

// ---------------------------------------------------------------------------
// Contrast
// ---------------------------------------------------------------------------

test("the primary button is navy on gold, not white on gold", () => {
  const css = read("app/globals.css");
  const light = css.slice(css.indexOf(":root"), css.indexOf(".dark"));
  assert.match(light, /--accent-foreground: #002D5F;/);
});

// ---------------------------------------------------------------------------
// Option cards grow to fit their text
// ---------------------------------------------------------------------------

test("rows of option cards use the flex choice-grid, never a stretched grid row", () => {
  const css = read("app/globals.css");
  assert.match(css, /\.choice-grid \{\s*display: flex;\s*flex-wrap: wrap;/);
  for (const path of [
    "app/dashboard/attendance/(record)/[date]/attendance-wizard.tsx",
    "components/settings/brand-colors-card.tsx",
    "components/settings/team-members-card.tsx",
    "components/announcements/announcement-composer.tsx",
    "components/live-streaming/setup/recording-settings-card.tsx",
    "components/live-streaming/setup/streaming-setup-guide.tsx",
    "components/checkin/checkout-console.tsx",
    "components/theme-toggle.tsx",
    "components/ui/action-card.tsx",
  ]) {
    const source = read(path);
    assert.match(source, /choice-grid/, path);
    assert.ok(
      !/role="radiogroup"[^>]*className="grid |className="grid [^"]*"[^>]*role="radiogroup"/.test(source),
      `${path} lays out option cards with a grid`,
    );
  }
});
