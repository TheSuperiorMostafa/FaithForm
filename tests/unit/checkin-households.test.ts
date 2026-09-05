import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

process.env.ATTENDANCE_QR_SECRET =
  "test-checkin-signing-secret-long-enough-to-be-usable-000000";

// Static imports are safe here: the signing key ring is read on every call
// rather than cached at module load, so the secret set above is in force.
import {
  mintPickupQr,
  verifyPickupQr,
  weekExpiry,
} from "@/lib/checkin/household-credentials";
import {
  localDateInTimeZone,
  recentServiceWeeks,
  serviceWeekStart,
  serviceWeekStartForDate,
} from "@/lib/checkin/service-week";

const migration = readFileSync(
  "supabase/migrations/0071_households_and_checkin.sql",
  "utf8",
);
const actions = readFileSync("app/dashboard/checkin/actions.ts", "utf8");
const console_ = readFileSync(
  "components/checkin/checkout-console.tsx",
  "utf8",
);
const credentials = readFileSync(
  "lib/checkin/household-credentials.ts",
  "utf8",
);

const HOUSEHOLD = "11111111-2222-3333-4444-555555555555";
const CHURCH = "66666666-7777-8888-9999-aaaaaaaaaaaa";

// ---------------------------------------------------------------------------
// Which Sunday it is
// ---------------------------------------------------------------------------

test("the service week is the church's Sunday, not the server's", () => {
  // 07:00 UTC on Sunday 6 September 2026 is still Saturday evening in Hawaii.
  const sundayMorningUtc = new Date("2026-09-06T07:00:00Z");

  assert.equal(serviceWeekStart("America/New_York", sundayMorningUtc), "2026-09-06");
  assert.equal(serviceWeekStart("Pacific/Honolulu", sundayMorningUtc), "2026-08-30");
});

test("a date resolves to the Sunday behind it", () => {
  assert.equal(serviceWeekStartForDate("2026-09-06"), "2026-09-06"); // Sunday
  assert.equal(serviceWeekStartForDate("2026-09-09"), "2026-09-06"); // Wednesday
  assert.equal(serviceWeekStartForDate("2026-09-12"), "2026-09-06"); // Saturday
  assert.equal(serviceWeekStartForDate("2026-09-13"), "2026-09-13"); // next Sunday
});

test("the local date follows the church's timezone", () => {
  const lateSaturday = new Date("2026-09-06T03:00:00Z");
  assert.equal(localDateInTimeZone("America/New_York", lateSaturday), "2026-09-05");
  assert.equal(localDateInTimeZone("UTC", lateSaturday), "2026-09-06");
});

test("a stats range walks back one week at a time, oldest first", () => {
  assert.deepEqual(recentServiceWeeks("2026-09-06", 3), [
    "2026-08-23",
    "2026-08-30",
    "2026-09-06",
  ]);
});

// ---------------------------------------------------------------------------
// The QR credential
// ---------------------------------------------------------------------------

function mint(overrides: Partial<Parameters<typeof mintPickupQr>[0]> = {}) {
  return mintPickupQr({
    householdId: HOUSEHOLD,
    churchId: CHURCH,
    weekStart: "2026-09-06",
    codeRotation: 0,
    expiresAt: weekExpiry("2026-09-06"),
    ...overrides,
  });
}

test("a freshly minted QR verifies back to its household and week", () => {
  const token = mint({ expiresAt: new Date(Date.now() + 60_000) });
  assert.ok(token);

  const verified = verifyPickupQr(token);
  assert.equal(verified.ok, true);
  if (!verified.ok) return;

  assert.equal(verified.credential.householdId, HOUSEHOLD);
  assert.equal(verified.credential.churchId, CHURCH);
  assert.equal(verified.credential.weekStart, "2026-09-06");
  assert.equal(verified.codeRotation, 0);
});

test("last week's screenshot is refused by arithmetic, not by a lookup", () => {
  const token = mint({ expiresAt: new Date(Date.now() - 1000) });
  const verified = verifyPickupQr(token);

  assert.equal(verified.ok, false);
  if (verified.ok) return;
  assert.equal(verified.reason, "expired");
});

test("a rotated household issues a token that no longer matches the old one", () => {
  const before = verifyPickupQr(
    mint({ codeRotation: 0, expiresAt: new Date(Date.now() + 60_000) }),
  );
  const after = verifyPickupQr(
    mint({ codeRotation: 1, expiresAt: new Date(Date.now() + 60_000) }),
  );

  assert.equal(before.ok, true);
  assert.equal(after.ok, true);
  if (!before.ok || !after.ok) return;

  // Both still verify as signatures; the rotation counter is what the checkout
  // desk compares against the household's current one.
  assert.notEqual(before.codeRotation, after.codeRotation);
  assert.match(actions, /!== verified\.codeRotation/);
});

test("a tampered or foreign token is rejected outright", () => {
  const token = mint({ expiresAt: new Date(Date.now() + 60_000) })!;
  const tampered = `${token.slice(0, -4)}AAAA`;

  assert.equal(verifyPickupQr(tampered).ok, false);
  assert.equal(verifyPickupQr("").ok, false);
  assert.equal(verifyPickupQr(null).ok, false);
});

test("a pickup token is signed under its own capability type", () => {
  const signing = readFileSync("lib/attendance/v2/signing.ts", "utf8");
  assert.match(signing, /"household\.pickup"/);
  assert.match(credentials, /mintCapability\("household\.pickup"/);
  assert.match(credentials, /verifyCapability<QrBody>\("household\.pickup"/);
});

// ---------------------------------------------------------------------------
// Safety properties that live in the schema, not the UI
// ---------------------------------------------------------------------------

test("a person belongs to exactly one household", () => {
  assert.match(
    migration,
    /create unique index if not exists household_members_person_idx\s+on public\.household_members \(member_id\)/,
  );
});

test("a child cannot be checked in twice on the same day", () => {
  assert.match(
    migration,
    /create unique index if not exists checkin_sessions_open_idx[\s\S]*?\(member_id, local_service_date\)[\s\S]*?where status in \('pre_checked_in', 'checked_in'\)/,
  );
});

test("an override with no reason is refused by the database", () => {
  assert.match(migration, /checkin_sessions_override_needs_reason/);
  assert.match(migration, /checkout_method is distinct from 'override'/);
});

test("two households cannot share a code in the same week", () => {
  assert.match(
    migration,
    /create unique index if not exists household_checkout_codes_unique_idx[\s\S]*?\(church_id, week_start, code\)/,
  );
});

test("a room with history cannot be silently deleted", () => {
  assert.match(migration, /location_id uuid not null references public\.church_locations \(id\)\s*\n\s*on delete restrict/);
});

test("background checks are admin-only unless deliberately widened", () => {
  assert.match(migration, /visibility text not null default 'church_admin'/);
  assert.match(
    migration,
    /visibility = 'staff' or public\.is_church_admin\(church_id\)/,
  );
});

test("no church session may read the code table", () => {
  assert.match(
    migration,
    /revoke select, insert, update, delete on table public\.household_checkout_codes from public, anon, authenticated/,
  );
});

// ---------------------------------------------------------------------------
// The release path
// ---------------------------------------------------------------------------

test("a release only ever moves a session that is still open", () => {
  assert.match(
    actions,
    /\.in\("status", \["pre_checked_in", "checked_in"\]\)\s*\n\s*\.select\("id"\)/,
  );
  assert.match(actions, /Those children have already been checked out/);
});

test("every release records who did it, when, and against which credential", () => {
  assert.match(actions, /checked_out_by: context\.auth\.userId/);
  assert.match(actions, /checkout_method: input\.method/);
  assert.match(actions, /checked_out_at: new Date\(\)\.toISOString\(\)/);
});

test("an override demands a written reason before it reaches the database", () => {
  assert.match(actions, /input\.method === "override" && reason\.length < 4/);
});

test("a household found by name can only be released as an override", () => {
  // The name path is a separate action, and the console opens the reason box
  // for anything it returns — a name is not a credential.
  assert.match(actions, /export async function lookupHouseholdForOverride/);
  assert.match(actions, /method: "override" as CheckoutMethod/);
  assert.match(console_, /setOverrideMode\(true\)/);
});

test("the checkout console never offers release without a confirm step", () => {
  assert.match(console_, /Confirm release/);
  // Looking a credential up must not release anybody on its own.
  assert.doesNotMatch(
    console_,
    /runLookup[\s\S]{0,600}completeCheckout/,
  );
});
