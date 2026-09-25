import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  buildRosterSearchIndex,
  checkInButtonLabel,
  childCount,
  classifyPickupInput,
  defaultRoomFor,
  defaultSelection,
  formatServiceDate,
  joinNames,
  occupancyLabel,
  parseNewFamily,
  pickupPersonLabel,
  releaseButtonLabel,
  searchFamilies,
  undoCheckinCutoff,
  undoCheckinRefusal,
  UNDO_CHECKIN_WINDOW_MS,
  type DeskChild,
} from "@/lib/checkin/desk";
import type { CheckinChild } from "@/lib/checkin/roster-search";
import type { CheckinSessionRow } from "@/types/checkin";

const actions = readFileSync("app/dashboard/checkin/actions.ts", "utf8");
const desk = readFileSync("components/checkin/checkin-desk.tsx", "utf8");
const console_ = readFileSync("components/checkin/checkout-console.tsx", "utf8");
const rooms = readFileSync("components/checkin/locations-manager.tsx", "utf8");
const layout = readFileSync("app/dashboard/checkin/layout.tsx", "utf8");
const page = readFileSync("app/dashboard/checkin/page.tsx", "utf8");

/** The body of one exported action, up to the next export. */
function actionBody(name: string): string {
  const start = actions.indexOf(`export async function ${name}(`);
  assert.ok(start >= 0, `${name} exists`);
  const next = actions.indexOf("\nexport ", start + 10);
  return actions.slice(start, next === -1 ? undefined : next);
}

// ---------------------------------------------------------------------------
// Wording
// ---------------------------------------------------------------------------

test("button labels count children the way people say it", () => {
  assert.equal(childCount(1), "1 child");
  assert.equal(childCount(2), "2 children");
  assert.equal(checkInButtonLabel(2), "Check in 2 children");
  assert.equal(checkInButtonLabel(1), "Check in 1 child");
  assert.equal(checkInButtonLabel(0), "Tick who is here");
  assert.equal(releaseButtonLabel(2), "Release 2 children");
  assert.equal(joinNames(["Tim", "Anna", "Joe"]), "Tim, Anna and Joe");
  assert.equal(joinNames(["Tim"]), "Tim");
  assert.equal(occupancyLabel(8, 12), "8 checked in / room for 12");
  assert.equal(occupancyLabel(3, null), "3 checked in");
});

test("service dates are shown as words, never as raw ISO dates", () => {
  assert.equal(formatServiceDate("2026-09-25", "en-US"), "Friday, September 25");
  assert.equal(formatServiceDate("not a date"), "not a date");
  assert.doesNotMatch(desk, /Showing \{serviceDate\}/);
});

test("a pickup button names the adult and how they are related", () => {
  assert.equal(pickupPersonLabel("Sarah Doe", "Mother", "Parent or guardian"), "Sarah Doe (mother)");
  assert.equal(
    pickupPersonLabel("John Doe", null, "Parent or guardian"),
    "John Doe (parent or guardian)",
  );
});

// ---------------------------------------------------------------------------
// One box for a scan or a typed code
// ---------------------------------------------------------------------------

test("six digits are a code, a long token is a scan, anything else waits", () => {
  assert.deepEqual(classifyPickupInput("418302"), { kind: "code", value: "418302" });
  assert.deepEqual(classifyPickupInput(" 418 302 "), { kind: "code", value: "418302" });
  assert.deepEqual(classifyPickupInput("418-302"), { kind: "code", value: "418302" });
  assert.equal(classifyPickupInput("41830"), null);
  assert.equal(classifyPickupInput("4183021"), null);
  assert.equal(classifyPickupInput(""), null);
  assert.equal(classifyPickupInput("abc"), null);
  const token = "v2.k1.eyJhbGciOiJIUzI1NiJ9.signature";
  assert.deepEqual(classifyPickupInput(token), { kind: "qr", value: token });
});

// ---------------------------------------------------------------------------
// Family cards
// ---------------------------------------------------------------------------

const H1 = "house-1";
const H2 = "house-2";

function child(
  id: string,
  firstName: string,
  lastName: string,
  householdId: string,
  extra: Partial<CheckinChild & { medicalNotes: string | null }> = {},
): CheckinChild & { medicalNotes?: string | null } {
  return {
    id,
    firstName,
    lastName,
    householdId,
    householdName: householdId === H1 ? "The Doe Family" : "Smith family",
    guardianNames: householdId === H1 ? ["Sarah Doe"] : ["Mark Smith"],
    defaultLocationId: null,
    ...extra,
  };
}

const children = [
  child("tim", "Tim", "Doe", H1, { defaultLocationId: "nursery", medicalNotes: "Peanut allergy" }),
  child("anna", "Anna", "Doe", H1),
  child("joe", "Joe", "Smith", H2),
];

function session(overrides: Partial<CheckinSessionRow>): CheckinSessionRow {
  return {
    id: "s1",
    memberId: "tim",
    firstName: "Tim",
    lastName: "Doe",
    householdId: H1,
    householdName: "The Doe Family",
    locationId: "nursery",
    locationName: "Nursery",
    status: "checked_in",
    localServiceDate: "2026-09-25",
    preCheckedInAt: null,
    checkedInAt: "2026-09-25T14:00:00Z",
    checkedOutAt: null,
    checkinMethod: "staff",
    checkoutMethod: null,
    checkoutOverrideReason: null,
    medicalNotes: null,
    ...overrides,
  };
}

test("a parent's name brings the whole family, every child on one card", () => {
  const index = buildRosterSearchIndex(children);
  const { families } = searchFamilies(index, children, "sarah", []);
  assert.equal(families.length, 1);
  assert.equal(families[0].householdId, H1);
  assert.deepEqual(
    families[0].children.map((row) => row.firstName),
    ["Anna", "Tim"],
  );
  assert.equal(families[0].children[1].medicalNotes, "Peanut allergy");
});

test("one child's name still brings their brothers and sisters", () => {
  const index = buildRosterSearchIndex(children);
  const { families } = searchFamilies(index, children, "tim", []);
  assert.equal(families[0].children.length, 2);
});

test("each child on a card says whether they are here, on the way, or new", () => {
  const index = buildRosterSearchIndex(children);
  const { families } = searchFamilies(index, children, "doe", [
    session({ id: "s-tim", memberId: "tim", status: "checked_in" }),
    session({ id: "s-anna", memberId: "anna", status: "pre_checked_in", locationId: "preschool" }),
  ]);
  const [anna, tim] = families[0].children;
  assert.equal(tim.state.kind, "checked_in");
  assert.equal(anna.state.kind, "on_the_way");
  // Everyone not already in a room is ticked for the volunteer.
  assert.deepEqual(defaultSelection(families[0]), ["anna"]);
  // Someone on the way keeps the room their parent chose.
  assert.equal(defaultRoomFor(anna, ["nursery", "preschool"]), "preschool");
});

test("a child's usual room is pre-chosen, and never a closed one", () => {
  const ready: DeskChild = { ...children[0], state: { kind: "ready" } };
  assert.equal(defaultRoomFor(ready, ["nursery", "preschool"]), "nursery");
  assert.equal(defaultRoomFor(ready, ["preschool"]), "preschool", "the only open room");
  assert.equal(defaultRoomFor(ready, ["preschool", "k"]), "", "otherwise the volunteer chooses");
});

// ---------------------------------------------------------------------------
// Undo a check-in
// ---------------------------------------------------------------------------

const NOW = new Date("2026-09-25T15:00:00Z");
const ME = { churchId: "church-1", userId: "user-1", now: NOW };
const fresh = {
  church_id: "church-1",
  status: "checked_in",
  checked_in_at: new Date(NOW.getTime() - 60_000).toISOString(),
  checked_in_by: "user-1",
  checked_out_at: null,
};

test("a check-in made a minute ago by the same person can be undone", () => {
  assert.equal(undoCheckinRefusal(fresh, ME), null);
});

test("undo only works inside the ten-minute window", () => {
  assert.equal(UNDO_CHECKIN_WINDOW_MS, 10 * 60 * 1000);
  const old = {
    ...fresh,
    checked_in_at: new Date(NOW.getTime() - UNDO_CHECKIN_WINDOW_MS - 1000).toISOString(),
  };
  assert.equal(undoCheckinRefusal(old, ME), "too_old");
  assert.equal(undoCheckinCutoff(NOW), new Date(NOW.getTime() - UNDO_CHECKIN_WINDOW_MS).toISOString());
});

test("undo only touches a child who is still checked in and never released", () => {
  assert.equal(undoCheckinRefusal({ ...fresh, status: "checked_out", checked_out_at: NOW.toISOString() }, ME), "released");
  assert.equal(undoCheckinRefusal({ ...fresh, checked_out_at: NOW.toISOString() }, ME), "released");
  assert.equal(undoCheckinRefusal({ ...fresh, status: "pre_checked_in" }, ME), "not_checked_in");
  assert.equal(undoCheckinRefusal({ ...fresh, status: "cancelled" }, ME), "not_checked_in");
});

test("undo never reaches another church or another volunteer's check-in", () => {
  assert.equal(undoCheckinRefusal({ ...fresh, church_id: "church-2" }, ME), "other_church");
  assert.equal(undoCheckinRefusal({ ...fresh, checked_in_by: "user-2" }, ME), "someone_else");
});

test("the undo action keeps the station guard and repeats every rule in the update", () => {
  const body = actionBody("undoCheckin");
  assert.match(body, /const context = await requireStation\(\);/);
  assert.match(body, /undoCheckinRefusal\(/);
  assert.match(body, /\.update\(\{ status: "cancelled" \}\)/);
  assert.match(body, /\.eq\("church_id", context\.auth\.churchId\)\s*\n\s*\.eq\("status", "checked_in"\)/);
  assert.match(body, /\.is\("checked_out_at", null\)/);
  assert.match(body, /\.eq\("checked_in_by", context\.auth\.userId\)/);
  assert.match(body, /\.gte\("checked_in_at", undoCheckinCutoff\(now\)\)/);
  // Marked cancelled, never deleted.
  assert.doesNotMatch(body, /\.delete\(\)/);
});

// ---------------------------------------------------------------------------
// Checking in a family
// ---------------------------------------------------------------------------

test("checking in a family goes through the single-child rules, child by child", () => {
  const body = actionBody("checkInChildren");
  assert.match(body, /const context = await requireStation\(\);/);
  assert.match(body, /await checkInOne\(context,/);
  assert.match(body, /weeklyCodeFor\(context, householdId\)/);
  // The single-child path and the family path share one body.
  assert.match(actionBody("checkInMember"), /await checkInOne\(context,/);
  assert.match(actions, /membership\.relationship !== "dependent"/);
  assert.match(actions, /That child was just checked in from another station/);
});

test("the pickup code comes from the existing weekly-code path, not a new one", () => {
  assert.match(actions, /const code = await issueWeeklyCode\(/);
  assert.match(actionBody("getHouseholdCredentials"), /weeklyCodeFor\(context, householdId\)/);
});

// ---------------------------------------------------------------------------
// A new family at the desk
// ---------------------------------------------------------------------------

test("a new family needs a parent's name and at least one child with a room", () => {
  const base = {
    guardianFirstName: "Sarah",
    guardianLastName: "Doe",
    children: [{ firstName: "Tim", locationId: "nursery" }],
  };
  const ok = parseNewFamily(base);
  assert.equal(ok.ok, true);
  if (ok.ok) {
    assert.equal(ok.data.familyName, "Doe family");
    assert.equal(ok.data.children[0].lastName, "Doe", "children take the parent's last name");
  }

  assert.deepEqual(parseNewFamily({ ...base, guardianFirstName: " " }), {
    ok: false,
    error: "Add the parent's first name.",
  });
  assert.deepEqual(parseNewFamily({ ...base, children: [] }), {
    ok: false,
    error: "Add at least one child.",
  });
  assert.deepEqual(
    parseNewFamily({ ...base, children: [{ firstName: "Tim", locationId: "" }] }),
    { ok: false, error: "Choose a room for Tim." },
  );
  // Blank extra child rows are ignored rather than refused.
  const blank = parseNewFamily({
    ...base,
    children: [{ firstName: "Tim", locationId: "n" }, { firstName: "", locationId: "" }],
  });
  assert.equal(blank.ok && blank.data.children.length, 1);
});

test("only church admins can add a new family, exactly as in People", () => {
  const body = actionBody("createFamilyAndCheckIn");
  assert.match(body, /const context = await requireAdmin\(\);/);
  assert.match(actions, /if \(!context\.auth\.isAdmin\) \{\s*\n\s*return fail\("Only church admins can change this\."\);/);
  assert.match(page, /canAddFamily=\{auth\.isAdmin\}/);
  assert.match(desk, /\{canAddFamily && \(/);
});

test("a new family is never left half-made", () => {
  const body = actionBody("createFamilyAndCheckIn");
  // Every failure while creating rows cleans up before returning.
  const failures = body.match(/await cleanUp\(\);\s*\n\s*return fail\(COULD_NOT_ADD\);/g) ?? [];
  assert.ok(failures.length >= 4, `expected cleanup on every create step, found ${failures.length}`);
  // Clean-up is scoped to this church and only runs before the family is complete.
  assert.match(body, /\.in\("id", createdMemberIds\)\s*\n\s*\.eq\("church_id", station\.auth\.churchId\)/);
  assert.match(body, /familyComplete = true;/);
  assert.match(body, /if \(familyComplete\) \{/);
  // Parent is a parent or guardian, children are children.
  assert.match(body, /relationship: "guardian"/);
  assert.match(body, /relationship: "dependent"/);
  // Rooms and phone numbers are checked before anything is written.
  assert.match(body, /validateMemberInput\(/);
  assert.match(body, /One of those rooms is closed or was removed/);
});

// ---------------------------------------------------------------------------
// Pick up
// ---------------------------------------------------------------------------

test("pick up never pre-chooses who the children go home with", () => {
  assert.doesNotMatch(console_, /Not recorded/);
  assert.doesNotMatch(console_, /setReleasedTo\(\w+\.guardians\[0\]/);
  assert.match(console_, /Released to \{person\.text\}/);
});

test("someone not on the family's list needs the written, flagged reason", () => {
  assert.match(console_, /function chooseUnlisted\(\) \{[\s\S]{0,300}setOverrideMode\(true\)/);
  assert.match(console_, /method: overrideMode \? "override" : lookup\.method/);
});

test("pick up speaks plainly", () => {
  for (const jargon of [/Credential valid/, /Needs an override/, /Override…/, /text-xs/]) {
    assert.doesNotMatch(console_, jargon);
  }
  assert.match(console_, /Code is correct/);
  assert.match(console_, /Release without a code/);
});

test("a release has no undo, so its record is never erased", () => {
  assert.doesNotMatch(actions, /export async function undoCheckout/);
  assert.doesNotMatch(actions, /status: "checked_in",\s*\n\s*checked_out_at: null/);
});

// ---------------------------------------------------------------------------
// Rooms and the section
// ---------------------------------------------------------------------------

test("deleting a room checks its history first and asks before deleting", () => {
  assert.match(rooms, /await checkLocationDeletion\(location\.id\)/);
  assert.match(rooms, /confirmLabel: "Delete room",\s*\n\s*destructive: true/);
  assert.match(rooms, /"Close room"/);
  assert.doesNotMatch(rooms, /Switch off|Cap\.|>Order</);
  assert.match(actionBody("reorderLocations"), /const context = await requireAdmin\(\);/);
});

test("Kids Check-in has its own header and links, and no Attendance tabs", () => {
  assert.match(layout, /<PageHeader/);
  assert.doesNotMatch(layout, /attendanceSectionTabs/);
  assert.doesNotMatch(layout, /max-w-/);
  for (const label of ["Check in", "Pick up", "Rooms", "Reports"]) {
    assert.match(layout, new RegExp(`label: "${label}"`));
  }
});

test("every check-in route has its own loading skeleton with a plain root", () => {
  for (const route of ["", "/checkout", "/locations", "/stats"]) {
    const loading = readFileSync(`app/dashboard/checkin${route}/loading.tsx`, "utf8");
    assert.match(loading, /<SkeletonContainer className="flex w-full flex-col/);
    assert.doesNotMatch(loading, /max-w-(3xl|5xl|6xl)/);
  }
});

test("user-facing check-in messages say family, not household", () => {
  const messages = actions.match(/fail\("[^"]*"\)/g) ?? [];
  for (const message of messages) {
    assert.doesNotMatch(message, /household/i, message);
  }
});
