import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const settingsTabs = readFileSync("components/settings/settings-tabs.tsx", "utf8");
const invitationsCard = readFileSync(
  "components/settings/visitor-invitations-card.tsx",
  "utf8",
);
const peoplePage = readFileSync("app/dashboard/people/page.tsx", "utf8");
const joinPanel = readFileSync("components/people/join-requests-panel.tsx", "utf8");

// ---------------------------------------------------------------------------
// The pastor-facing controls actually exist on a screen
// ---------------------------------------------------------------------------
//
// The invitation and join-request server actions shipped long before anything
// rendered them; "where do I manage invitations?" had no answer. These pin the
// wiring so the actions can never go consumer-less again.

test("the Visitor app settings tab renders invitation management", () => {
  assert.match(settingsTabs, /<VisitorInvitationsCard/);
  assert.match(invitationsCard, /createVisitorInvitation/);
  assert.match(invitationsCard, /withdrawVisitorInvitation/);
});

test("the People page surfaces pending join requests for a decision", () => {
  assert.match(peoplePage, /<JoinRequestsPanel/);
  assert.match(peoplePage, /state === "pending"/);
  assert.match(joinPanel, /decideVisitorRelationship/);
  // Both doors, not just the yes.
  assert.match(joinPanel, /"approve"/);
  assert.match(joinPanel, /"reject"/);
});

test("the invitation link is shown from the creation reply and nowhere else", () => {
  // The card may only learn a URL from the action's one-time response; the
  // listing carries no token, so nothing rendered later could leak one.
  assert.match(invitationsCard, /result\.data\.url/);
  assert.doesNotMatch(invitationsCard, /token_hash|tokenHash/);
  assert.match(invitationsCard, /shown only once/);
});
