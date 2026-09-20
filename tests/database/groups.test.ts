import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";

import {
  appAccount,
  asUser,
  connect,
  group,
  join,
  one,
  person,
  refused,
  staffUser,
  suiteOptions,
  withChurch,
  type Client,
} from "./groups-fixtures";

/**
 * Migration 0091 against the whole migration chain.
 *
 * Every rule a client could try to break is exercised here as the database
 * sees it: row level security as a signed-in staff member of another church,
 * each enrollment path, the last seat taken by two connections at once, and a
 * gathering's attendance through the one attendance command.
 */

const hash = (token: string) => createHash("sha256").update(token, "utf8").digest("hex");

async function invitation(
  client: Client,
  churchId: string,
  groupId: string,
  input: { expiresInDays?: number; maxUses?: number; revoked?: boolean } = {},
): Promise<string> {
  const token = randomUUID() + randomUUID();
  await client.query(
    `insert into public.group_invitations (church_id, group_id, token_hash, max_uses, expires_at, revoked_at)
     values ($1, $2, $3, $4, now() + make_interval(days => $5), $6)`,
    [
      churchId,
      groupId,
      hash(token),
      input.maxUses ?? 5,
      input.expiresInDays ?? 7,
      input.revoked ? new Date().toISOString() : null,
    ],
  );
  return token;
}

async function membership(client: Client, groupId: string, accountId: string) {
  return one<{ id: string; status: string; group_role: string; member_id: string | null } | undefined>(
    client,
    `select id, status, group_role, member_id from public.group_memberships where group_id = $1 and account_id = $2`,
    [groupId, accountId],
  );
}

async function counts(client: Client, groupId: string) {
  return one<{ member_count: number; leader_count: number; pending_request_count: number }>(
    client,
    `select member_count, leader_count, pending_request_count from public.groups where id = $1`,
    [groupId],
  );
}

// ---------------------------------------------------------------------------
// Tenant isolation
// ---------------------------------------------------------------------------

test("staff read only their own church's groups, and only with the Groups feature", suiteOptions, async () => {
  await withChurch(async (client, churchA) => {
    await withChurch(async (_other, churchB) => {
      const adminA = await staffUser(client, churchA.id);
      const viewerWithGrant = await staffUser(client, churchA.id, { role: "viewer", features: ["groups"] });
      const viewerWithout = await staffUser(client, churchA.id, { role: "viewer", features: ["people"] });
      const groupA = await group(client, churchA.id, { name: "Alpha" });
      const groupB = await group(client, churchB.id, { name: "Bravo" });
      const { accountId } = await appAccount(client, churchB.id);
      await join(client, groupB, accountId);

      await asUser(client, adminA, async () => {
        const { rows } = await client.query(`select id from public.groups`);
        assert.deepEqual(rows.map((r) => r.id), [groupA], "an admin sees their church's groups only");

        const direct = await client.query(`select id from public.groups where id = $1`, [groupB]);
        assert.equal(direct.rowCount, 0, "another church's group id resolves to nothing");

        const members = await client.query(
          `select id from public.group_memberships where group_id = $1`,
          [groupB],
        );
        assert.equal(members.rowCount, 0, "another church's memberships are invisible");
      });

      await asUser(client, viewerWithGrant, async () => {
        const { rows } = await client.query(`select id from public.groups`);
        assert.deepEqual(rows.map((r) => r.id), [groupA], "a granted viewer reads Groups");
      });

      await asUser(client, viewerWithout, async () => {
        const { rowCount } = await client.query(`select id from public.groups`);
        assert.equal(rowCount, 0, "a viewer without the grant reads nothing");
      });

      // The feature switched off for the whole church: nobody reads it.
      await client.query(
        `insert into public.church_features (church_id, feature_key, enabled) values ($1, 'groups', false)`,
        [churchA.id],
      );
      await asUser(client, adminA, async () => {
        const { rowCount } = await client.query(`select id from public.groups`);
        assert.equal(rowCount, 0, "a church without the feature exposes nothing, admins included");
      });
    });
  });
});

test("no browser role can write a group, read an invitation, or call a command", suiteOptions, async () => {
  await withChurch(async (client, church) => {
    const admin = await staffUser(client, church.id);
    const groupId = await group(client, church.id);
    const { accountId } = await appAccount(client, church.id);
    await invitation(client, church.id, groupId);

    for (const userId of [admin, null]) {
      await asUser(client, userId, async () => {
        assert.ok(
          await refused(client, `insert into public.groups (church_id, name) values ($1, 'Injected')`, [church.id]),
          "insert refused",
        );
        assert.ok(
          await refused(client, `update public.groups set name = 'Renamed' where id = $1`, [groupId]),
          "update refused",
        );
        assert.ok(await refused(client, `delete from public.groups where id = $1`, [groupId]), "delete refused");
        assert.ok(
          await refused(
            client,
            `insert into public.group_memberships (church_id, group_id, account_id, origin, source)
             values ($1, $2, $3, 'account', 'self')`,
            [church.id, groupId, accountId],
          ),
          "a membership cannot be written directly",
        );
        assert.ok(
          await refused(
            client,
            `update public.group_memberships set group_role = 'manager' where group_id = $1`,
            [groupId],
          ),
          "nobody elevates a role by writing the table",
        );
        assert.ok(await refused(client, `select * from public.group_invitations`), "invitations are unreadable");
        assert.ok(
          await refused(client, `select * from public.group_join($1, $2)`, [groupId, accountId]),
          "the join command is server-only",
        );
        assert.ok(
          await refused(
            client,
            `select * from public.group_decide_request($1, $2, $3, 'approve', $4, 'staff')`,
            [randomUUID(), church.id, groupId, admin],
          ),
          "approval is server-only",
        );
      });
    }
  });
});

// ---------------------------------------------------------------------------
// Enrollment
// ---------------------------------------------------------------------------

test("an open group joins at once, and joining again is not a second membership", suiteOptions, async () => {
  await withChurch(async (client, church) => {
    const groupId = await group(client, church.id, { enrollment: "open" });
    const { accountId } = await appAccount(client, church.id, { name: "Ruth Naomi" });

    const first = await join(client, groupId, accountId);
    assert.equal(first.outcome, "joined");
    const again = await join(client, groupId, accountId);
    assert.equal(again.outcome, "already_member");
    assert.equal(again.membership_id, first.membership_id);

    assert.equal((await counts(client, groupId)).member_count, 1);

    // Joining made them one of the church's people (0083's rule, for groups).
    const row = await membership(client, groupId, accountId);
    assert.ok(row?.member_id, "the membership is anchored to a People record");
    const created = await one<{ source: string; first_name: string }>(
      client,
      `select source, first_name from public.members where id = $1`,
      [row!.member_id],
    );
    assert.equal(created.source, "app");
    assert.equal(created.first_name, "Ruth");
  });
});

test("approval-required: request, idempotent re-request, approve, and the count moves", suiteOptions, async () => {
  await withChurch(async (client, church) => {
    const staff = await staffUser(client, church.id);
    const groupId = await group(client, church.id, { enrollment: "approval_required" });
    const { accountId } = await appAccount(client, church.id);

    const requested = await join(client, groupId, accountId);
    assert.equal(requested.outcome, "requested");
    assert.equal((await counts(client, groupId)).pending_request_count, 1);

    const again = await join(client, groupId, accountId);
    assert.equal(again.outcome, "already_requested");
    assert.equal(again.request_id, requested.request_id);

    // A request id from another church resolves to nothing.
    const foreign = await one<{ outcome: string }>(
      client,
      `select * from public.group_decide_request($1, $2, $3, 'approve', $4, 'staff')`,
      [requested.request_id, randomUUID(), groupId, staff],
    );
    assert.equal(foreign.outcome, "not_found");

    const approved = await one<{ outcome: string; membership_id: string }>(
      client,
      `select * from public.group_decide_request($1, $2, $3, 'approve', $4, 'staff')`,
      [requested.request_id, church.id, groupId, staff],
    );
    assert.equal(approved.outcome, "approved");
    assert.equal((await membership(client, groupId, accountId))?.status, "active");

    const c = await counts(client, groupId);
    assert.equal(c.member_count, 1);
    assert.equal(c.pending_request_count, 0);

    const twice = await one<{ outcome: string }>(
      client,
      `select * from public.group_decide_request($1, $2, $3, 'approve', $4, 'staff')`,
      [requested.request_id, church.id, groupId, staff],
    );
    assert.equal(twice.outcome, "already_decided", "a second approval does nothing");
  });
});

test("declining leaves no membership; cancelling a request is the person's own", suiteOptions, async () => {
  await withChurch(async (client, church) => {
    const staff = await staffUser(client, church.id);
    const groupId = await group(client, church.id, { enrollment: "approval_required" });
    const a = await appAccount(client, church.id);
    const b = await appAccount(client, church.id);

    const requestA = await join(client, groupId, a.accountId);
    const declined = await one<{ outcome: string }>(
      client,
      `select * from public.group_decide_request($1, $2, $3, 'decline', $4, 'staff')`,
      [requestA.request_id, church.id, groupId, staff],
    );
    assert.equal(declined.outcome, "declined");
    assert.equal(await membership(client, groupId, a.accountId), undefined);

    await join(client, groupId, b.accountId);
    const left = await one<{ group_leave: string }>(
      client,
      `select public.group_leave($1, $2)`,
      [groupId, b.accountId],
    );
    assert.equal(left.group_leave, "request_cancelled");
    assert.equal((await counts(client, groupId)).pending_request_count, 0);
  });
});

test("invitation-only, closed and private groups hold their doors", suiteOptions, async () => {
  await withChurch(async (client, church) => {
    const inviteOnly = await group(client, church.id, { enrollment: "invitation_only" });
    const closed = await group(client, church.id, { enrollment: "closed" });
    const priv = await group(client, church.id, { visibility: "private", enrollment: "open" });
    const other = await group(client, church.id, { enrollment: "invitation_only" });
    const { accountId } = await appAccount(client, church.id);

    assert.equal((await join(client, inviteOnly, accountId)).outcome, "invitation_required");
    assert.equal((await join(client, closed, accountId)).outcome, "closed");
    assert.equal((await join(client, priv, accountId)).outcome, "not_found", "a private group does not exist to outsiders");

    const token = await invitation(client, church.id, inviteOnly, { maxUses: 1 });
    const wrongGroup = await join(client, other, accountId, hash(token));
    assert.equal(wrongGroup.outcome, "invitation_invalid", "a link for one group opens no other");

    const accepted = await one<{ outcome: string; group_id: string }>(
      client,
      `select * from public.group_accept_invitation($1, $2)`,
      [hash(token), accountId],
    );
    assert.equal(accepted.outcome, "joined");
    assert.equal(accepted.group_id, inviteOnly);

    const second = await appAccount(client, church.id);
    const exhausted = await one<{ outcome: string }>(
      client,
      `select * from public.group_accept_invitation($1, $2)`,
      [hash(token), second.accountId],
    );
    assert.equal(exhausted.outcome, "invitation_invalid", "a single-use link is spent");

    const expired = await invitation(client, church.id, priv, { expiresInDays: -1 });
    assert.equal(
      (await join(client, priv, second.accountId, hash(expired))).outcome,
      "invitation_invalid",
    );
    const revoked = await invitation(client, church.id, priv, { revoked: true });
    assert.equal(
      (await join(client, priv, second.accountId, hash(revoked))).outcome,
      "invitation_invalid",
    );
    const valid = await invitation(client, church.id, priv);
    assert.equal((await join(client, priv, second.accountId, hash(valid))).outcome, "joined");
  });
});

test("an archived group, another church's person, and a blocked person are all not found", suiteOptions, async () => {
  await withChurch(async (client, church) => {
    await withChurch(async (_c, otherChurch) => {
      const archived = await group(client, church.id, { status: "archived" });
      const open = await group(client, church.id);
      const outsider = await appAccount(client, otherChurch.id);
      const blocked = await appAccount(client, church.id, { state: "blocked" });
      const inactive = await appAccount(client, church.id, { status: "deactivated" });

      const member = await appAccount(client, church.id);
      assert.equal((await join(client, archived, member.accountId)).outcome, "not_found");
      assert.equal((await join(client, open, outsider.accountId)).outcome, "not_found", "cross-tenant join refused");
      assert.equal((await join(client, open, blocked.accountId)).outcome, "not_found");
      assert.equal((await join(client, open, inactive.accountId)).outcome, "not_found");
    });
  });
});

test("capacity holds at join, at approval, and under two connections racing for the last seat", suiteOptions, async () => {
  await withChurch(async (client, church) => {
    const staff = await staffUser(client, church.id);
    const groupId = await group(client, church.id, { capacity: 2 });
    const first = await appAccount(client, church.id);
    await join(client, groupId, first.accountId);

    const racers = [await appAccount(client, church.id), await appAccount(client, church.id)];
    const [left, right] = [await connect(), await connect()];
    try {
      await left.query("begin");
      await right.query("begin");
      const leftResult = await left.query(`select * from public.group_join($1, $2)`, [groupId, racers[0].accountId]);
      // The second connection blocks on the group lock until the first commits.
      const rightPromise = right.query(`select * from public.group_join($1, $2)`, [groupId, racers[1].accountId]);
      await left.query("commit");
      const rightResult = await rightPromise;
      await right.query("commit");

      const outcomes = [leftResult.rows[0].outcome, rightResult.rows[0].outcome].sort();
      assert.deepEqual(outcomes, ["full", "joined"], "exactly one racer takes the last seat");
    } finally {
      await left.end();
      await right.end();
    }
    assert.equal((await counts(client, groupId)).member_count, 2);

    // Approval respects the limit too, unless staff deliberately override it.
    await client.query(`update public.groups set enrollment = 'approval_required' where id = $1`, [groupId]);
    await client.query(`update public.groups set capacity = 3 where id = $1`, [groupId]);
    const pending = await appAccount(client, church.id);
    const request = await join(client, groupId, pending.accountId);
    await client.query(`update public.groups set capacity = 2 where id = $1`, [groupId]);
    const full = await one<{ outcome: string }>(
      client,
      `select * from public.group_decide_request($1, $2, $3, 'approve', $4, 'leader')`,
      [request.request_id, church.id, groupId, staff],
    );
    assert.equal(full.outcome, "full");
    const overridden = await one<{ outcome: string }>(
      client,
      `select * from public.group_decide_request($1, $2, $3, 'approve', $4, 'staff', true)`,
      [request.request_id, church.id, groupId, staff],
    );
    assert.equal(overridden.outcome, "approved");
  });
});

test("a ban keeps someone out until lifted, and removal is audited", suiteOptions, async () => {
  await withChurch(async (client, church) => {
    const staff = await staffUser(client, church.id);
    const groupId = await group(client, church.id);
    const { accountId } = await appAccount(client, church.id);
    const joined = await join(client, groupId, accountId);

    const outcome = await one<{ group_remove_member: string }>(
      client,
      `select public.group_remove_member($1, $2, $3, true, 'Repeated harassment', $4, 'staff')`,
      [joined.membership_id, church.id, groupId, staff],
    );
    assert.equal(outcome.group_remove_member, "banned");
    assert.equal((await join(client, groupId, accountId)).outcome, "banned");

    const foreign = await one<{ group_remove_member: string }>(
      client,
      `select public.group_remove_member($1, $2, $3, false, null, $4, 'staff')`,
      [joined.membership_id, randomUUID(), groupId, staff],
    );
    assert.equal(foreign.group_remove_member, "not_found", "a membership id from another church resolves to nothing");

    await client.query(`update public.group_bans set lifted_at = now(), lifted_by = $2 where group_id = $1`, [groupId, staff]);
    assert.equal((await join(client, groupId, accountId)).outcome, "joined");
    assert.equal((await membership(client, groupId, accountId))?.group_role, "member", "a returning member starts as a member");

    const audit = await client.query(
      `select action from public.group_audit_events where group_id = $1 order by created_at`,
      [groupId],
    );
    const actions = audit.rows.map((r) => r.action);
    for (const expected of ["joined", "member_banned"]) {
      assert.ok(actions.includes(expected), `audit records ${expected}`);
    }
  });
});

test("roles change only through the command, and the leader count follows", suiteOptions, async () => {
  await withChurch(async (client, church) => {
    const staff = await staffUser(client, church.id);
    const groupId = await group(client, church.id);
    const { accountId } = await appAccount(client, church.id);
    const joined = await join(client, groupId, accountId);

    const promoted = await one<{ group_set_role: string }>(
      client,
      `select public.group_set_role($1, $2, $3, 'leader', $4, 'staff')`,
      [joined.membership_id, church.id, groupId, staff],
    );
    assert.equal(promoted.group_set_role, "updated");
    assert.equal((await counts(client, groupId)).leader_count, 1);

    const again = await one<{ group_set_role: string }>(
      client,
      `select public.group_set_role($1, $2, $3, 'leader', $4, 'staff')`,
      [joined.membership_id, church.id, groupId, staff],
    );
    assert.equal(again.group_set_role, "unchanged");

    await assert.rejects(
      client.query(`select public.group_set_role($1, $2, $3, 'owner', $4, 'staff')`, [joined.membership_id, church.id, groupId, staff]),
      /invalid role/,
    );
  });
});

test("an id from another group of the same church acts on nothing", suiteOptions, async () => {
  await withChurch(async (client, church) => {
    const staff = await staffUser(client, church.id);
    const groupA = await group(client, church.id, { name: "Alpha" });
    const groupB = await group(client, church.id, { name: "Bravo", enrollment: "approval_required" });
    const member = await appAccount(client, church.id);
    await client.query(`update public.groups set enrollment = 'open' where id = $1`, [groupB]);
    const joinedB = await join(client, groupB, member.accountId);
    await client.query(`update public.groups set enrollment = 'approval_required' where id = $1`, [groupB]);
    const asker = await appAccount(client, church.id);
    const requestB = await join(client, groupB, asker.accountId);
    assert.ok(joinedB.membership_id && requestB.request_id);

    // A leader of Alpha names Bravo's rows through Alpha's endpoints.
    const removed = await one<{ group_remove_member: string }>(
      client,
      `select public.group_remove_member($1, $2, $3, false, null, $4, 'leader')`,
      [joinedB.membership_id, church.id, groupA, staff],
    );
    assert.equal(removed.group_remove_member, "not_found");
    const role = await one<{ group_set_role: string }>(
      client,
      `select public.group_set_role($1, $2, $3, 'manager', $4, 'leader')`,
      [joinedB.membership_id, church.id, groupA, staff],
    );
    assert.equal(role.group_set_role, "not_found");
    const decided = await one<{ outcome: string }>(
      client,
      `select * from public.group_decide_request($1, $2, $3, 'approve', $4, 'leader')`,
      [requestB.request_id, church.id, groupA, staff],
    );
    assert.equal(decided.outcome, "not_found");

    assert.equal((await membership(client, groupB, member.accountId))?.status, "active", "Bravo's member is untouched");
    assert.equal((await membership(client, groupB, member.accountId))?.group_role, "member");
    assert.equal((await counts(client, groupB)).pending_request_count, 1, "Bravo's request is untouched");
  });
});

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

test("a same-name person becomes a claim, and the link staff make later reaches the membership", suiteOptions, async () => {
  await withChurch(async (client, church) => {
    const staff = await staffUser(client, church.id);
    const existing = await person(client, church.id, "Mary", "Smith");
    const groupId = await group(client, church.id);
    const { accountId } = await appAccount(client, church.id, { name: "Mary Smith" });

    await join(client, groupId, accountId);
    const before = await membership(client, groupId, accountId);
    assert.equal(before?.member_id, null, "nobody is linked by a matching name");

    const claim = await one<{ source: string; status: string }>(
      client,
      `select source, status from public.visitor_people_claims where account_id = $1`,
      [accountId],
    );
    assert.equal(claim.status, "pending");

    // Staff confirm she is the Mary Smith already in People.
    await client.query(
      `insert into public.visitor_people_links (account_id, church_id, member_id, is_active, linked_by)
       values ($1, $2, $3, true, $4)`,
      [accountId, church.id, existing, staff],
    );
    assert.equal((await membership(client, groupId, accountId))?.member_id, existing);
  });
});

test("the same person added from People and joined from the app becomes one membership", suiteOptions, async () => {
  await withChurch(async (client, church) => {
    const staff = await staffUser(client, church.id);
    const joe = await person(client, church.id, "Joe", "Carpenter");
    const groupId = await group(client, church.id);

    const added = await one<{ outcome: string }>(
      client,
      `select * from public.group_add_member($1, $2, $3, null, 'leader', $4, 'staff')`,
      [groupId, church.id, joe, staff],
    );
    assert.equal(added.outcome, "added");

    // Joe signs up with a name nobody else has, joins in the app as someone new…
    const { accountId } = await appAccount(client, church.id, { name: "Joseph C" });
    await join(client, groupId, accountId);
    assert.equal((await counts(client, groupId)).member_count, 2, "two rows before anyone knows");

    // …and staff then link his app account to the Joe already in People.
    await client.query(
      `update public.visitor_people_links set is_active = false where account_id = $1`,
      [accountId],
    );
    await client.query(
      `insert into public.visitor_people_links (account_id, church_id, member_id, is_active, linked_by)
       values ($1, $2, $3, true, $4)`,
      [accountId, church.id, joe, staff],
    );

    const rows = await client.query(
      `select group_role, member_id, account_id from public.group_memberships where group_id = $1 and status = 'active'`,
      [groupId],
    );
    assert.equal(rows.rowCount, 1, "one person, one membership");
    assert.equal(rows.rows[0].group_role, "leader", "the stronger role survives the merge");
    assert.equal(rows.rows[0].member_id, joe);
    assert.equal(rows.rows[0].account_id, accountId);
    assert.equal((await counts(client, groupId)).member_count, 1);
  });
});

test("leaving the church ends the account's groups; staff-added people stay without the account", suiteOptions, async () => {
  await withChurch(async (client, church) => {
    const staff = await staffUser(client, church.id);
    const selfJoined = await group(client, church.id);
    const staffAdded = await group(client, church.id);
    const { accountId } = await appAccount(client, church.id, { name: "Unique Person Name" });
    await join(client, selfJoined, accountId);
    const linked = await membership(client, selfJoined, accountId);

    await client.query(
      `select * from public.group_add_member($1, $2, $3, null, 'member', $4, 'staff')`,
      [staffAdded, church.id, linked!.member_id, staff],
    );

    await client.query(
      `update public.visitor_church_relationships set state = 'left' where account_id = $1 and church_id = $2`,
      [accountId, church.id],
    );

    const ended = await one<{ status: string; ended_reason: string }>(
      client,
      `select status, ended_reason from public.group_memberships where group_id = $1 and member_id = $2`,
      [selfJoined, linked!.member_id],
    );
    assert.equal(ended.status, "removed");
    assert.equal(ended.ended_reason, "left_church");

    const kept = await one<{ status: string; account_id: string | null }>(
      client,
      `select status, account_id from public.group_memberships where group_id = $1 and member_id = $2`,
      [staffAdded, linked!.member_id],
    );
    assert.equal(kept.status, "active", "the person staff added is still in the group");
    assert.equal(kept.account_id, null, "…but no longer through the app account");
  });
});

test("deleting an app account detaches a People-anchored membership and removes an app-only one", suiteOptions, async () => {
  await withChurch(async (client, church) => {
    const groupId = await group(client, church.id);
    const anchored = await appAccount(client, church.id, { name: "Anchored Person" });
    const appOnly = await appAccount(client, church.id, { name: null });
    await join(client, groupId, anchored.accountId);
    await join(client, groupId, appOnly.accountId);
    const anchoredRow = await membership(client, groupId, anchored.accountId);
    assert.ok(anchoredRow?.member_id);
    assert.equal((await membership(client, groupId, appOnly.accountId))?.member_id, null, "no name: awaiting staff");

    await client.query(`delete from auth.users where id in ($1, $2)`, [anchored.userId, appOnly.userId]);

    const rows = await client.query(
      `select member_id, account_id from public.group_memberships where group_id = $1`,
      [groupId],
    );
    assert.equal(rows.rowCount, 1);
    assert.equal(rows.rows[0].member_id, anchoredRow!.member_id);
    assert.equal(rows.rows[0].account_id, null);
  });
});

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

test("discovery lists one church's active public groups, filtered and keyset-paged", suiteOptions, async () => {
  await withChurch(async (client, church) => {
    await withChurch(async (_c, otherChurch) => {
      const names = ["Alpha Study", "Bravo Men", "Charlie Youth", "Delta Prayer"];
      for (const name of names) await group(client, church.id, { name });
      await group(client, church.id, { name: "Echo Hidden", visibility: "unlisted" });
      await group(client, church.id, { name: "Foxtrot Private", visibility: "private" });
      await group(client, church.id, { name: "Golf Archived", status: "archived" });
      await group(client, otherChurch.id, { name: "Another Church Group" });

      const page1 = await client.query(
        `select * from public.discover_groups($1, null, null, null, null, false, null, null, 2)`,
        [church.id],
      );
      assert.deepEqual(page1.rows.map((r) => r.name), ["Alpha Study", "Bravo Men"]);
      const last = page1.rows[1];
      const page2 = await client.query(
        `select * from public.discover_groups($1, null, null, null, null, false, $2, $3, 2)`,
        [church.id, last.cursor_name, last.id],
      );
      assert.deepEqual(page2.rows.map((r) => r.name), ["Charlie Youth", "Delta Prayer"]);

      const search = await client.query(
        `select name from public.discover_groups($1, 'prayer')`,
        [church.id],
      );
      assert.deepEqual(search.rows.map((r) => r.name), ["Delta Prayer"]);

      const hidden = await client.query(
        `select name from public.discover_groups($1, 'e')`,
        [church.id],
      );
      for (const row of hidden.rows) {
        assert.ok(!/Hidden|Private|Archived|Another/.test(row.name as string), `${row.name} must not be listed`);
      }
    });
  });
});

// ---------------------------------------------------------------------------
// Gatherings and attendance
// ---------------------------------------------------------------------------

test("weekly, biweekly and monthly schedules generate gatherings once, in local time across DST", suiteOptions, async () => {
  await withChurch(async (client, church) => {
    const groupId = await group(client, church.id, { name: "Tuesday Study" });
    // Sunday 1 Nov 2026 is the US fall-back day; 7 PM local is 23:00Z before
    // and 00:00Z (next day) after.
    const weekly = await one<{ id: string }>(
      client,
      `insert into public.group_meeting_schedules
         (church_id, group_id, frequency, day_of_week, start_time, duration_minutes, timezone, starts_on)
       values ($1, $2, 'weekly', 2, '19:00', 90, 'America/New_York', '2026-10-01') returning id`,
      [church.id, groupId],
    );
    const now = "2026-10-15T12:00:00Z";
    const created = await one<{ generate_group_events: number }>(
      client,
      `select public.generate_group_events($1, $2, 28, $3)`,
      [church.id, groupId, now],
    );
    assert.equal(created.generate_group_events, 4);
    const again = await one<{ generate_group_events: number }>(
      client,
      `select public.generate_group_events($1, $2, 28, $3)`,
      [church.id, groupId, now],
    );
    assert.equal(again.generate_group_events, 0, "idempotent");

    const events = await client.query(
      `select to_char(starts_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI') as utc,
              to_char(starts_at at time zone 'America/New_York', 'Dy HH24:MI') as local
         from public.group_events where schedule_id = $1 order by starts_at`,
      [weekly.id],
    );
    assert.deepEqual(
      events.rows.map((r) => r.utc),
      ["2026-10-20T23:00", "2026-10-27T23:00", "2026-11-04T00:00", "2026-11-11T00:00"],
    );
    for (const row of events.rows) assert.equal(row.local, "Tue 19:00");

    const dates = async (frequency: string, dow: number, wom: number | null, from: string, to: string) =>
      (
        await client.query(
          `select to_char(d, 'YYYY-MM-DD') as d
             from public.group_schedule_dates($1, $2, $3, '2026-01-01', null, $4::date, $5::date) d`,
          [frequency, dow, wom, from, to],
        )
      ).rows.map((r) => r.d);

    assert.deepEqual(await dates("biweekly", 4, null, "2026-01-01", "2026-02-10"), [
      "2026-01-01", "2026-01-15", "2026-01-29",
    ]);
    // Second Sunday, and last Friday, of each month.
    assert.deepEqual(await dates("monthly", 0, 2, "2026-01-01", "2026-03-31"), [
      "2026-01-11", "2026-02-08", "2026-03-08",
    ]);
    assert.deepEqual(await dates("monthly", 5, -1, "2026-01-01", "2026-03-31"), [
      "2026-01-30", "2026-02-27", "2026-03-27",
    ]);
  });
});

test("a leader records a gathering through the one attendance command; resubmission corrects, never double counts", suiteOptions, async () => {
  await withChurch(async (client, church) => {
    const staff = await staffUser(client, church.id);
    const groupId = await group(client, church.id, { name: "Wednesday Bible Study" });
    const people = [];
    for (const name of ["Anna Prophetess", "Barnabas Levite", "Cornelius Centurion"]) {
      const account = await appAccount(client, church.id, { name });
      await join(client, groupId, account.accountId);
      people.push((await membership(client, groupId, account.accountId))!.member_id!);
    }
    const outsider = await person(client, church.id, "Not", "Amember");

    const event = await one<{ id: string }>(
      client,
      `insert into public.group_events (church_id, group_id, title, starts_at, ends_at, timezone)
       values ($1, $2, 'Wednesday Bible Study', now() - interval '2 hours', now() - interval '30 minutes', 'America/New_York')
       returning id`,
      [church.id, groupId],
    );

    const first = await one<{ outcome: string; present_count: number; absent_count: number; rejected_member_ids: string[] }>(
      client,
      `select * from public.record_group_attendance($1, $2, $3, 1, 1, 'Great discussion', $4, 'leader', 'batch-1')`,
      [event.id, church.id, [people[0], people[1], outsider], staff],
    );
    assert.equal(first.outcome, "recorded");
    assert.equal(first.present_count, 2);
    assert.equal(first.absent_count, 1);
    assert.deepEqual(first.rejected_member_ids, [outsider], "a leader cannot mark someone outside the group");

    const occurrence = await one<{ id: string; group_id: string; generation_source: string; policy_snapshot: { sources: Record<string, boolean> } }>(
      client,
      `select id, group_id, generation_source, policy_snapshot from public.service_occurrences where group_event_id = $1`,
      [event.id],
    );
    assert.equal(occurrence.group_id, groupId);
    assert.equal(occurrence.generation_source, "group");
    assert.deepEqual(occurrence.policy_snapshot.sources, {
      manual: true, admin: true, geofence: false, qr: false, kiosk: false,
    });

    const facts = await client.query(
      `select f.member_id, f.source, a.actor_type
         from public.attendance_facts f
         join public.attendance_attempts a on a.id = f.attempt_id
        where f.service_occurrence_id = $1 and f.status = 'active'`,
      [occurrence.id],
    );
    assert.equal(facts.rowCount, 2);
    for (const fact of facts.rows) {
      assert.equal(fact.source, "manual");
      assert.equal(fact.actor_type, "leader", "the audit says a group leader recorded it");
    }

    // Same list again: nothing changes.
    const retry = await one<{ present_count: number }>(
      client,
      `select * from public.record_group_attendance($1, $2, $3, 1, 1, null, $4, 'leader', 'batch-1')`,
      [event.id, church.id, [people[0], people[1]], staff],
    );
    assert.equal(retry.present_count, 2);

    // Anna was marked by mistake; Cornelius came. Then Anna turns out to have come after all.
    const corrected = await one<{ present_count: number; absent_count: number }>(
      client,
      `select * from public.record_group_attendance($1, $2, $3, 0, 0, null, $4, 'leader', 'batch-2')`,
      [event.id, church.id, [people[1], people[2]], staff],
    );
    assert.equal(corrected.present_count, 2);
    assert.equal(corrected.absent_count, 1);
    const restored = await one<{ present_count: number }>(
      client,
      `select * from public.record_group_attendance($1, $2, $3, 0, 0, null, $4, 'leader', 'batch-1')`,
      [event.id, church.id, people, staff],
    );
    assert.equal(restored.present_count, 3, "a reused key cannot hide a reversal");

    const factRows = await one<{ n: string }>(
      client,
      `select count(*) as n from public.attendance_facts where service_occurrence_id = $1`,
      [occurrence.id],
    );
    assert.equal(Number(factRows.n), 3, "one fact per person, ever — reversal and restore reuse the slot");
    const corrections = await client.query(
      `select action from public.attendance_corrections where service_occurrence_id = $1 order by created_at`,
      [occurrence.id],
    );
    assert.deepEqual(corrections.rows.map((r) => r.action), ["reverse", "restore"]);
  });
});

test("a group gathering refuses check-in sources and stays out of the manual identity", suiteOptions, async () => {
  await withChurch(async (client, church) => {
    const staff = await staffUser(client, church.id);
    const groupA = await group(client, church.id, { name: "Bible Study" });
    const groupB = await group(client, church.id, { name: "Bible Study" });
    const events: string[] = [];
    for (const groupId of [groupA, groupB]) {
      const event = await one<{ id: string }>(
        client,
        `insert into public.group_events (church_id, group_id, title, starts_at, ends_at, timezone)
         values ($1, $2, 'Bible Study', date_trunc('hour', now()), date_trunc('hour', now()) + interval '1 hour', 'UTC')
         returning id`,
        [church.id, groupId],
      );
      events.push(event.id);
    }
    // Two groups, same name, same hour: two occurrences, no collision.
    const occurrences = [];
    for (const eventId of events) {
      const row = await one<{ id: string }>(
        client,
        `select public.ensure_group_event_occurrence($1, $2, $3) as id`,
        [eventId, church.id, staff],
      );
      occurrences.push(row.id);
    }
    assert.notEqual(occurrences[0], occurrences[1]);

    const member = await person(client, church.id, "Geo", "Fence");
    const geofence = await one<{ outcome: string; reason: string }>(
      client,
      `select * from public.record_attendance($1, $2, 'geofence', 'visitor', $3)`,
      [occurrences[0], member, randomUUID()],
    );
    assert.equal(geofence.outcome, "rejected");
    assert.equal(geofence.reason, "source_disabled", "an arrival at church cannot land on a small group");
  });
});

test("attendance waits for the gathering and refuses a cancelled one", suiteOptions, async () => {
  await withChurch(async (client, church) => {
    const staff = await staffUser(client, church.id);
    const groupId = await group(client, church.id);
    const future = await one<{ id: string }>(
      client,
      `insert into public.group_events (church_id, group_id, title, starts_at, ends_at, timezone)
       values ($1, $2, 'Next month', now() + interval '30 days', now() + interval '30 days 1 hour', 'UTC') returning id`,
      [church.id, groupId],
    );
    const early = await one<{ outcome: string }>(
      client,
      `select * from public.record_group_attendance($1, $2, '{}'::uuid[], 0, 0, null, $3, 'leader', 'k')`,
      [future.id, church.id, staff],
    );
    assert.equal(early.outcome, "too_early");

    await client.query(
      `update public.group_events set status = 'cancelled', cancelled_at = now() where id = $1`,
      [future.id],
    );
    const cancelled = await one<{ outcome: string }>(
      client,
      `select * from public.record_group_attendance($1, $2, '{}'::uuid[], 0, 0, null, $3, 'leader', 'k2')`,
      [future.id, church.id, staff],
    );
    assert.equal(cancelled.outcome, "cancelled");

    const foreign = await one<{ outcome: string }>(
      client,
      `select * from public.record_group_attendance($1, $2, '{}'::uuid[], 0, 0, null, $3, 'leader', 'k3')`,
      [future.id, randomUUID(), staff],
    );
    assert.equal(foreign.outcome, "not_found", "an event id from another church resolves to nothing");
  });
});

// ---------------------------------------------------------------------------
// Analytics
// ---------------------------------------------------------------------------

test("the church summary counts what it says it counts", suiteOptions, async () => {
  await withChurch(async (client, church) => {
    const staff = await staffUser(client, church.id);
    const open = await group(client, church.id, { name: "Counted" });
    const approval = await group(client, church.id, { name: "Asking", enrollment: "approval_required" });
    await group(client, church.id, { name: "Old", status: "archived" });

    const people = [];
    for (let i = 0; i < 3; i += 1) {
      const account = await appAccount(client, church.id, { name: `Summary Person${i}` });
      await join(client, open, account.accountId);
      people.push((await membership(client, open, account.accountId))!);
    }
    const asker = await appAccount(client, church.id);
    await join(client, approval, asker.accountId);
    await client.query(`select public.group_set_role($1, $2, $3, 'leader', $4, 'staff')`, [people[0].id, church.id, open, staff]);

    const event = await one<{ id: string }>(
      client,
      `insert into public.group_events (church_id, group_id, title, starts_at, ends_at, timezone)
       values ($1, $2, 'Night', now() - interval '3 hours', now() - interval '2 hours', 'UTC') returning id`,
      [church.id, open],
    );
    await client.query(
      `select * from public.record_group_attendance($1, $2, $3, 2, 1, null, $4, 'staff', 'summary')`,
      [event.id, church.id, [people[0].member_id, people[1].member_id], staff],
    );

    const summary = await one<Record<string, unknown>>(
      client,
      `select * from public.group_church_summary($1)`,
      [church.id],
    );
    assert.equal(summary.active_groups, 2);
    assert.equal(summary.archived_groups, 1);
    assert.equal(summary.memberships, 3);
    assert.equal(summary.people_in_groups, 3);
    assert.equal(summary.leaders, 1);
    assert.equal(summary.pending_requests, 1);
    assert.equal(summary.gatherings_in_window, 1);
    assert.equal(Number(summary.average_attendance), 4, "2 members + 2 guests");
    assert.equal(Number(summary.attendance_rate), 0.667, "2 of 3 members");

    const participation = await client.query(
      `select member_id, expected, attended from public.group_member_participation($1, $2)`,
      [open, church.id],
    );
    const byMember = new Map(participation.rows.map((r) => [r.member_id, r]));
    assert.equal(byMember.get(people[0].member_id)?.attended, 1);
    assert.equal(byMember.get(people[2].member_id)?.attended, 0);
    assert.equal(byMember.get(people[2].member_id)?.expected, 1);
  });
});

test("branding storage rejects client writes and active group lookup has a covering index", suiteOptions, async () => {
  await withChurch(async (client, church) => {
    const account = await appAccount(client, church.id, { state: "joined" });
    const bucket = await one<{ public: boolean; file_size_limit: string; allowed_mime_types: string[] }>(client,
      "select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'branding-images'");
    assert.equal(bucket.public, true);
    assert.deepEqual(bucket.allowed_mime_types, ["image/jpeg", "image/png"]);
    assert.equal(await asUser(client, account.userId, () => refused(client,
      "insert into storage.objects (bucket_id, name) values ('branding-images', $1)", [`${church.id}/church/forged.jpg`]
    )), true);
    const indexes = await client.query("select indexdef from pg_indexes where schemaname = 'public' and indexname in ('group_memberships_church_account_active_idx', 'group_memberships_church_member_active_idx')");
    assert.equal(indexes.rows.length, 2);
    for (const row of indexes.rows) assert.match(String(row.indexdef), /INCLUDE \(group_id\).*status = 'active'/);
    await client.query("set enable_seqscan = off");
    const plan = await client.query("explain (format json) select group_id from public.group_memberships where church_id = $1 and account_id = $2 and status = 'active'", [church.id, account.accountId]);
    assert.match(JSON.stringify(plan.rows), /group_memberships_church_account_active_idx/);
    await client.query("reset enable_seqscan");
  });
});
