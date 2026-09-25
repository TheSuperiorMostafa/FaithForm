import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  attentionSummary,
  contactLinks,
  countPeople,
  familyStatus,
  familySummary,
  filterPeople,
  formatFriendlyDate,
  formatWeekOf,
  personContext,
  personStatus,
  suggestedFamilyName,
} from "@/components/people/people-format";

const read = (path: string) => readFileSync(path, "utf8");

const person = (
  id: string,
  first: string,
  last: string,
  extra: Partial<{ phone: string | null; email: string | null; is_active: boolean }> = {},
) => ({
  id,
  first_name: first,
  last_name: last,
  phone: null,
  email: null,
  is_active: true,
  ...extra,
});

// ---------------------------------------------------------------------------
// Contacting a person
// ---------------------------------------------------------------------------

test("Call, Text and Email exist only when the detail behind them does", () => {
  assert.deepEqual(contactLinks({ phone: "+15025551234", email: "ann@example.org" }), {
    call: "tel:+15025551234",
    text: "sms:+15025551234",
    email: "mailto:ann@example.org",
  });
  // Formatting characters never reach the dialer.
  assert.equal(contactLinks({ phone: "(502) 555-1234" }).call, "tel:5025551234");
  assert.deepEqual(contactLinks({ phone: null, email: null }), {
    call: null,
    text: null,
    email: null,
  });
  // Not a real number or address: no button.
  assert.equal(contactLinks({ phone: "12" }).call, null);
  assert.equal(contactLinks({ email: "not an email" }).email, null);
  assert.equal(contactLinks({ email: "a@b.co?cc=x@y.z" }).email, null);
});

test("the person panel offers Call, Text and Email", () => {
  const actions = read("components/people/contact-actions.tsx");
  assert.match(actions, /Call\n/);
  assert.match(actions, /Text\n/);
  assert.match(actions, /Email\n/);
  const panel = read("components/people/member-form-panel.tsx");
  assert.match(panel, /<ContactActions/);
});

// ---------------------------------------------------------------------------
// The list
// ---------------------------------------------------------------------------

test("a row says the phone or 'No phone yet', and never promises a text", () => {
  assert.equal(personContext({ phone: "+15025551234", email: null }), "502-555-1234");
  assert.equal(personContext({ phone: null, email: "a@b.co" }), "No phone yet");
  assert.deepEqual(personStatus({ is_active: false }, true), { tone: "neutral", label: "Inactive" });
  assert.deepEqual(personStatus({ is_active: true }, true), { tone: "ready", label: "On the app" });
  assert.equal(personStatus({ is_active: true }, false), null);
  assert.doesNotMatch(read("components/people/people-manager.tsx"), /Text ready/);
});

test("search finds people by name, any phone format, or email; filters and counts agree", () => {
  const members = [
    person("1", "Ann", "Zed", { phone: "+15025551234" }),
    person("2", "Ben", "Adams", { email: "ben@church.org" }),
    person("3", "Cal", "Moss", { is_active: false }),
  ];
  const onApp = (id: string) => id === "1";
  const base = { search: "", filter: "all" as const, sortBy: "last-name" as const, isOnApp: onApp };

  assert.deepEqual(filterPeople(members, base).map((m) => m.id), ["2", "1"]);
  assert.deepEqual(filterPeople(members, { ...base, sortBy: "first-name" }).map((m) => m.id), ["1", "2"]);
  assert.deepEqual(filterPeople(members, { ...base, search: "(502) 555" }).map((m) => m.id), ["1"]);
  assert.deepEqual(filterPeople(members, { ...base, search: "church.org" }).map((m) => m.id), ["2"]);
  assert.deepEqual(filterPeople(members, { ...base, filter: "inactive" }).map((m) => m.id), ["3"]);
  assert.deepEqual(filterPeople(members, { ...base, filter: "missing-phone" }).map((m) => m.id), ["2"]);
  assert.deepEqual(countPeople(members, onApp), {
    all: 2,
    "on-app": 1,
    "missing-phone": 1,
    inactive: 1,
  });
});

test("the three app lists fold into one plain summary", () => {
  assert.equal(
    attentionSummary({ joinRequests: 2, claims: 1, notInPeople: 0 }),
    "2 people asked to join · 1 person to confirm",
  );
  assert.equal(attentionSummary({ joinRequests: 0, claims: 0, notInPeople: 3 }), "3 from the app to add");
});

test("Home's add link opens the add form once", () => {
  const manager = read("components/people/people-manager.tsx");
  assert.match(manager, /searchParams\.get\("add"\) === "1"/);
  assert.match(manager, /next\.delete\("add"\)/);
  assert.match(manager, /router\.replace\(/);
});

test("adding a person offers the next steps", () => {
  const panel = read("components/people/member-form-panel.tsx");
  assert.match(panel, /`\$\{name\} added\.`/);
  assert.match(panel, /Add to a family/);
  assert.match(panel, /Add to a group/);
  assert.match(panel, /Add another/);
  assert.match(panel, /Phone \(optional\)/);
  // Buttons name what they save.
  assert.match(panel, /"Save details"/);
  assert.match(read("components/people/member-care-panel.tsx"), /"Save care notes"/);
});

// ---------------------------------------------------------------------------
// Dates and families
// ---------------------------------------------------------------------------

test("dates read as words, never as ISO strings", () => {
  assert.equal(formatWeekOf("2026-09-20"), "For the week of Sunday, September 20");
  assert.equal(formatFriendlyDate("2026-09-13"), "Sep 13, 2026");
  assert.equal(formatFriendlyDate("not a date"), null);
  assert.doesNotMatch(read("components/people/household-detail.tsx"), /week of \{credentials\.weekStart\}/);
});

test("families are described in plain words", () => {
  assert.equal(
    familySummary({ memberCount: 3, guardianCount: 2, dependentCount: 1 }),
    "3 people · 2 parents or guardians · 1 child",
  );
  assert.equal(familySummary({ memberCount: 0, guardianCount: 0, dependentCount: 0 }), "No one added yet");
  assert.deepEqual(familyStatus({ memberCount: 1, guardianCount: 0, dependentCount: 1 }), {
    tone: "attention",
    label: "No parent or guardian",
  });
  assert.equal(suggestedFamilyName("Lopez", "Maria"), "The Lopez family");
  assert.equal(suggestedFamilyName("", "Maria"), "The Maria family");

  for (const path of [
    "components/people/household-detail.tsx",
    "components/people/households-directory.tsx",
    "components/people/member-care-panel.tsx",
  ]) {
    const source = read(path);
    assert.doesNotMatch(source, /pickup credential|staff override|Primary contact/, path);
  }
});

// ---------------------------------------------------------------------------
// Forgiveness
// ---------------------------------------------------------------------------

test("destructive family and document actions ask first, with the consequence", () => {
  const detail = read("components/people/household-detail.tsx");
  assert.match(detail, /Every parent's current code and QR stop working right away/);
  assert.match(detail, /confirmLabel: "Replace pickup code"/);
  assert.match(detail, /confirmLabel: "Remove pickup permission"/);
  assert.match(detail, /confirmLabel: "Remove from family"/);
  assert.match(detail, /typeToConfirm: familyName/);
  // The rotate and revoke calls sit behind a confirm.
  assert.ok(detail.indexOf("confirmAction") < detail.indexOf("rotateCredentials(formData)"));

  const care = read("components/people/member-care-panel.tsx");
  assert.match(care, /confirmLabel: "Delete document"/);
  assert.match(care, /confirmLabel: "Remove from family"/);

  const panel = read("components/people/member-form-panel.tsx");
  assert.match(panel, /Their attendance history, family and documents are all kept/);

  for (const path of [
    "components/people/household-detail.tsx",
    "components/people/member-care-panel.tsx",
    "components/people/member-form-panel.tsx",
    "components/people/households-directory.tsx",
  ]) {
    const source = read(path);
    assert.doesNotMatch(source, /window\.confirm|window\.prompt/, path);
    assert.doesNotMatch(source, /size="(xs|icon-xs|icon-sm)"/, path);
  }
});

test("a new family opens straight away", () => {
  const directory = read("components/people/households-directory.tsx");
  assert.match(directory, /router\.push\(`\/dashboard\/people\/households\/\$\{result\.data\.householdId\}`\)/);
});

// ---------------------------------------------------------------------------
// Server side
// ---------------------------------------------------------------------------

test("family rename and delete keep the check-in guards and tenant scoping", () => {
  const actions = read("app/dashboard/people/household-actions.ts");
  assert.match(actions, /featureActionError\("checkin"\)/);
  assert.match(actions, /if \(!auth\.isAdmin\) return fail\(/);
  // Every write is matched on the caller's church as well as the id.
  const writes = actions.match(/\.(update|delete)\([^)]*\)[\s\S]*?;/g) ?? [];
  assert.ok(writes.length >= 2);
  for (const write of writes) {
    assert.match(write, /\.eq\("church_id", context\.auth\.churchId\)/, write);
  }
  // A family with check-ins is never deleted, and the server checks again.
  assert.match(actions, /from\("checkin_sessions"\)/);
  assert.match(actions, /if \(\(count \?\? 0\) > 0\)/);
});

test("People actions never hand raw database text to the page", () => {
  for (const path of [
    "app/dashboard/people/actions.ts",
    "app/dashboard/people/care-actions.ts",
    "app/dashboard/people/file-actions.ts",
    "app/dashboard/people/household-actions.ts",
  ]) {
    const source = read(path);
    assert.doesNotMatch(source, /error:\s*[a-zA-Z]*[eE]rror\??\.message/, path);
    assert.match(source, /toUserError\(/, path);
  }
  const claims = read("app/dashboard/people/claim-actions.ts");
  assert.match(claims, /toStaffResult\(error, /);
  assert.doesNotMatch(claims, /\n\s+return toVisitorResult\(error\);/);
});
