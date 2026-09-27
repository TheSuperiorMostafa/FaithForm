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
const resend = actions.slice(actions.indexOf("export async function resendInvite"));

test("the emailed church invite verifies the address before trusted account creation", () => {
  assert.ok(account.indexOf("fetchInviteByToken(token)") < account.indexOf("admin.auth.admin.createUser"));
  assert.ok(account.indexOf("data.email.toLowerCase() !== inviteResult.invite.email.toLowerCase()") < account.indexOf("admin.auth.admin.createUser"));
  assert.match(account, /email_confirm: true/);
  assert.doesNotMatch(account, /auth\.signUp\(/);
  assert.match(account, /auth\.signInWithPassword\(/);
});

test("the final step uses one transactional command after signed-in invite validation", () => {
  assert.ok(finish.indexOf("fetchInviteByToken(token)") < finish.indexOf("admin.rpc("));
  assert.ok(finish.indexOf("assertInviteEmail") < finish.indexOf("admin.rpc("));
  assert.match(finish, /admin\.rpc\("complete_church_onboarding"/);
  assert.doesNotMatch(finish, /\.from\("church_users"\)|\.from\("churches"\)|\.from\("church_invites"\)/);
});

test("resending does not revoke a working invitation before delivery succeeds", () => {
  assert.match(resend, /inviteNeedsRefresh\(existingInvite\.expiresAt\)/);
  assert.ok(resend.indexOf("await sendInviteEmail(") < resend.indexOf('.from("church_invites")\n    .delete()'));
  assert.match(resend, /\.neq\("id", inviteId\)/);
});
