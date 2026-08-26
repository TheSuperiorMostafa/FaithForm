import assert from "node:assert/strict";
import test from "node:test";

import {
  decideTransition,
  grantsDashboardAccess,
  grantsPublishedContentAccess,
  RELATIONSHIP_STATES,
  type JoinPolicy,
  type RelationshipState,
} from "@/lib/faithful/relationship-state";

const visitor = { actorType: "visitor" as const };
const staff = { actorType: "staff" as const };

test("no visitor relationship state ever grants dashboard access", () => {
  for (const state of RELATIONSHIP_STATES) {
    assert.equal(grantsDashboardAccess(state), false, state);
  }
});

test("only following and joined see what a church publishes", () => {
  assert.equal(grantsPublishedContentAccess("following"), true);
  assert.equal(grantsPublishedContentAccess("joined"), true);
  assert.equal(grantsPublishedContentAccess("pending"), false);
  assert.equal(grantsPublishedContentAccess("left"), false);
  assert.equal(grantsPublishedContentAccess("blocked"), false);
});

test("following an open or approval-required church is immediate", () => {
  for (const joinPolicy of ["open", "approval_required"] as JoinPolicy[]) {
    const decision = decideTransition({
      action: "follow",
      from: null,
      joinPolicy,
      ...visitor,
    });
    assert.equal(decision.ok, true);
    assert.equal(decision.ok && decision.to, "following");
  }
});

test("an invite-only church cannot be followed or joined without an invitation", () => {
  const follow = decideTransition({
    action: "follow",
    from: null,
    joinPolicy: "invite_only",
    ...visitor,
  });
  assert.equal(follow.ok, false);

  const join = decideTransition({
    action: "request_join",
    from: null,
    joinPolicy: "invite_only",
    ...visitor,
  });
  assert.equal(join.ok, false);
  assert.equal(!join.ok && join.code, "forbidden");
});

test("join policy decides whether joining is immediate or pending", () => {
  const open = decideTransition({
    action: "request_join",
    from: "following",
    joinPolicy: "open",
    ...visitor,
  });
  assert.equal(open.ok && open.to, "joined");

  const approval = decideTransition({
    action: "request_join",
    from: "following",
    joinPolicy: "approval_required",
    ...visitor,
  });
  assert.equal(approval.ok && approval.to, "pending");
});

test("staff approve and reject only from pending", () => {
  const approve = decideTransition({
    action: "approve",
    from: "pending",
    joinPolicy: "approval_required",
    ...staff,
  });
  assert.equal(approve.ok && approve.to, "joined");

  const fromFollowing = decideTransition({
    action: "approve",
    from: "following",
    joinPolicy: "approval_required",
    ...staff,
  });
  assert.equal(fromFollowing.ok, false);
});

test("a visitor cannot perform staff actions and staff cannot act as the visitor", () => {
  const selfApprove = decideTransition({
    action: "approve",
    from: "pending",
    joinPolicy: "approval_required",
    ...visitor,
  });
  assert.equal(selfApprove.ok, false);
  assert.equal(!selfApprove.ok && selfApprove.code, "forbidden");

  const staffFollow = decideTransition({
    action: "follow",
    from: null,
    joinPolicy: "open",
    ...staff,
  });
  assert.equal(staffFollow.ok, false);
});

test("blocked is terminal for every visitor action, including replayed invitations", () => {
  const actions = ["follow", "request_join", "accept_invitation", "leave"] as const;
  for (const action of actions) {
    const decision = decideTransition({
      action,
      from: "blocked",
      joinPolicy: "open",
      hasValidInvitation: true,
      ...visitor,
    });
    assert.equal(decision.ok, false, action);
    assert.equal(!decision.ok && decision.code, "blocked", action);
  }
});

test("only staff can lift a block, and it does not restore membership", () => {
  const unblock = decideTransition({
    action: "unblock",
    from: "blocked",
    joinPolicy: "open",
    ...staff,
  });
  assert.equal(unblock.ok && unblock.to, "left");

  const visitorUnblock = decideTransition({
    action: "unblock",
    from: "blocked",
    joinPolicy: "open",
    ...visitor,
  });
  assert.equal(visitorUnblock.ok, false);
});

test("accepting an invitation requires a verified invitation", () => {
  const without = decideTransition({
    action: "accept_invitation",
    from: null,
    joinPolicy: "invite_only",
    ...visitor,
  });
  assert.equal(without.ok, false);

  const with_ = decideTransition({
    action: "accept_invitation",
    from: null,
    joinPolicy: "invite_only",
    hasValidInvitation: true,
    ...visitor,
  });
  assert.equal(with_.ok && with_.to, "joined");
});

test("repeating a command that already produced the current state is idempotent", () => {
  const follow = decideTransition({
    action: "follow",
    from: "following",
    joinPolicy: "open",
    ...visitor,
  });
  assert.equal(follow.ok, true);
  assert.equal(follow.ok && follow.idempotent, true);

  const block = decideTransition({
    action: "block",
    from: "blocked",
    joinPolicy: "open",
    ...staff,
  });
  assert.equal(block.ok && block.idempotent, true);
});

test("someone who left can follow again but is not silently re-joined", () => {
  const refollow = decideTransition({
    action: "follow",
    from: "left",
    joinPolicy: "open",
    ...visitor,
  });
  assert.equal(refollow.ok && refollow.to, "following");
  assert.equal(refollow.ok && refollow.idempotent, false);
});

test("staff may revoke an active membership and the visitor may leave", () => {
  const revoke = decideTransition({
    action: "revoke",
    from: "joined",
    joinPolicy: "open",
    ...staff,
  });
  assert.equal(revoke.ok && revoke.to, "left");

  const leave = decideTransition({
    action: "leave",
    from: "joined",
    joinPolicy: "open",
    ...visitor,
  });
  assert.equal(leave.ok && leave.to, "left");
});

test("every state is reachable and no transition produces an unknown state", () => {
  const produced = new Set<RelationshipState>();
  const froms: (RelationshipState | null)[] = [null, ...RELATIONSHIP_STATES];

  for (const from of froms) {
    for (const action of [
      "follow",
      "unfollow",
      "request_join",
      "accept_invitation",
      "approve",
      "reject",
      "leave",
      "block",
      "unblock",
      "revoke",
    ] as const) {
      for (const actorType of ["visitor", "staff", "system"] as const) {
        for (const joinPolicy of [
          "open",
          "approval_required",
          "invite_only",
        ] as JoinPolicy[]) {
          const decision = decideTransition({
            action,
            from,
            actorType,
            joinPolicy,
            hasValidInvitation: true,
          });
          if (decision.ok) {
            assert.ok(
              RELATIONSHIP_STATES.includes(decision.to),
              `unknown state ${decision.to}`,
            );
            produced.add(decision.to);
          }
        }
      }
    }
  }

  for (const state of RELATIONSHIP_STATES) {
    assert.ok(produced.has(state), `unreachable state ${state}`);
  }
});
