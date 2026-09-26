import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  churchMayResetPassword,
  PROVISIONED_BY_CHURCH_KEY,
} from "@/lib/auth/team-password-reset";

/**
 * Inviting an email that already had a login linked it to the inviting church
 * without its owner's say, and "Make new password" then replaced that login's
 * password and showed it to the church admin. Anyone can become a church admin
 * by setting up a church, so any app user's account — or a platform admin's —
 * could be taken over. A church may now reset only a login its own invite made.
 */

const CHURCH = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

const base = {
  churchId: CHURCH,
  isPlatformAdmin: false,
  hasAppAccount: false,
  appMetadata: {},
  accountCreatedAt: "2026-09-01T10:00:00Z",
  linkedAt: "2026-09-01T10:00:02Z",
};

test("a login this church's invite created can be reset", () => {
  assert.equal(churchMayResetPassword({ ...base, appMetadata: { [PROVISIONED_BY_CHURCH_KEY]: CHURCH } }), true);
  // Made before the marker existed: created in the same moment as the link.
  assert.equal(churchMayResetPassword(base), true);
});

test("someone's own login that a church linked cannot be reset", () => {
  assert.equal(
    churchMayResetPassword({ ...base, accountCreatedAt: "2025-01-01T00:00:00Z" }),
    false,
    "a login that existed long before the link is the person's own",
  );
  assert.equal(
    churchMayResetPassword({ ...base, appMetadata: { [PROVISIONED_BY_CHURCH_KEY]: OTHER } }),
    false,
    "another church's invite made it",
  );
});

test("app accounts and platform administrators are never reset by a church", () => {
  assert.equal(churchMayResetPassword({ ...base, hasAppAccount: true }), false);
  assert.equal(churchMayResetPassword({ ...base, isPlatformAdmin: true }), false);
  assert.equal(
    churchMayResetPassword({
      ...base,
      isPlatformAdmin: true,
      appMetadata: { [PROVISIONED_BY_CHURCH_KEY]: CHURCH },
    }),
    false,
  );
});

test("the timing rule covers only logins made before the record existed", () => {
  assert.equal(
    churchMayResetPassword({ ...base, accountCreatedAt: "2026-11-01T10:00:00Z", linkedAt: "2026-11-01T10:05:00Z" }),
    false,
    "a login made after the cutoff without the record is someone's own",
  );
  assert.equal(
    churchMayResetPassword({
      ...base,
      accountCreatedAt: "2026-11-01T10:00:00Z",
      linkedAt: "2026-11-01T10:00:01Z",
      appMetadata: { [PROVISIONED_BY_CHURCH_KEY]: CHURCH },
    }),
    true,
  );
});

test("missing or unreadable dates refuse", () => {
  assert.equal(churchMayResetPassword({ ...base, accountCreatedAt: null }), false);
  assert.equal(churchMayResetPassword({ ...base, linkedAt: "not a date" }), false);
});

test("the team actions apply the rule and never link a platform administrator", () => {
  const actions = readFileSync("app/dashboard/settings/team-actions.ts", "utf8");
  const reset = actions.slice(actions.indexOf("export async function resetTeamMemberPassword"));
  assert.ok(
    reset.indexOf("churchMayResetPassword(") < reset.indexOf("updateUserById("),
    "the rule must be checked before the password is changed",
  );
  assert.match(reset, /from\("visitor_accounts"\)/);
  assert.match(reset, /if \(platformAdminError\)/, "a failed platform-admin lookup must refuse");
  assert.match(actions, /app_metadata: \{ \[PROVISIONED_BY_CHURCH_KEY\]: churchId \}/);

  const invite = actions.slice(
    actions.indexOf("export async function inviteTeamMember"),
    actions.indexOf("export async function resetTeamMemberPassword"),
  );
  assert.match(invite, /isBootstrapSuperAdminEmail\(email\)/);
  assert.match(invite, /isPlatformAdminUserId\(authUser\.id\)/);
});

test("a fund publication cannot be pointed at another church", () => {
  const source = readFileSync("app/dashboard/giving/faithform-actions.ts", "utf8");
  assert.doesNotMatch(source, /\{\s*churchId,\s*\.\.\.input\s*\}/);
  const call = source.slice(source.indexOf("publishFundToFaithForm({"));
  assert.match(call.slice(0, call.indexOf("});")), /churchId,\s*$/m);
});
