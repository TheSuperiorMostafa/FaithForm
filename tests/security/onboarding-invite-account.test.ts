import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const actions = readFileSync("app/onboarding/actions.ts", "utf8");
const account = actions.slice(
  actions.indexOf("export async function createOnboardingAccount"),
  actions.indexOf("export async function updateChurchProfile"),
);
const finish = actions.slice(
  actions.indexOf("export async function completeOnboarding"),
  actions.indexOf("export async function resendInvite"),
);

test("the emailed church invite verifies the address before trusted account creation", () => {
  assert.ok(account.indexOf("fetchInviteByToken(token)") < account.indexOf("admin.auth.admin.createUser"));
  assert.ok(account.indexOf("data.email.toLowerCase() !== inviteResult.invite.email.toLowerCase()") < account.indexOf("admin.auth.admin.createUser"));
  assert.match(account, /email_confirm: true/);
  assert.doesNotMatch(account, /auth\.signUp\(/);
  assert.match(account, /auth\.signInWithPassword\(/);
});

test("the invite stays usable until an administrator and completed church exist", () => {
  const link = finish.indexOf('.from("church_users").upsert(');
  const church = finish.indexOf('.from("churches")');
  const invite = finish.indexOf('.from("church_invites")');
  assert.ok(link >= 0 && church > link && invite > church);
  assert.match(finish, /if \(linkError\)/);
  assert.match(finish, /if \(churchError \|\| !completedChurch\)/);
  assert.match(finish, /if \(inviteError \|\| !acceptedInvite\)/);
});
