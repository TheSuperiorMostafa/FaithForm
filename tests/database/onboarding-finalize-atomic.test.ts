import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";

import { asUser, authUser, one, suiteOptions, withChurch, type Client } from "./groups-fixtures";

async function finish(client: Client, token: string, userId: string, email: string) {
  return one<{ outcome: string }>(client,
    `select public.complete_church_onboarding($1, $2, $3) as outcome`,
    [token, userId, email]);
}

test("onboarding finalization either saves all three records or none", suiteOptions, async () => {
  await withChurch(async (client, church) => {
    const userId = await authUser(client);
    const { email } = await one<{ email: string }>(client, `select email from auth.users where id = $1`, [userId]);
    const token = randomBytes(32).toString("hex");
    const invite = await one<{ id: string }>(client,
      `insert into public.church_invites (church_id, email, admin_first_name, admin_last_name, token)
       values ($1, $2, 'QA', 'Admin', $3) returning id`, [church.id, email, token]);

    assert.equal((await finish(client, token, userId, "different@example.test")).outcome, "email_mismatch");
    assert.equal((await finish(client, "x".repeat(64), userId, email)).outcome, "invalid");
    await client.query(`update public.church_invites set expires_at = now() - interval '1 minute' where id = $1`, [invite.id]);
    assert.equal((await finish(client, token, userId, email)).outcome, "expired");
    await client.query(`update public.church_invites set expires_at = now() + interval '1 day' where id = $1`, [invite.id]);
    await asUser(client, userId, async () => {
      await assert.rejects(finish(client, token, userId, email), (error: unknown) => (error as { code?: string }).code === "42501");
    });

    await client.query("begin");
    try {
      await client.query(`create function pg_temp.fail_invite_acceptance() returns trigger language plpgsql as
        'begin raise exception ''injected invite failure''; end'`);
      await client.query(`create trigger fail_invite_acceptance before update on public.church_invites
        for each row execute function pg_temp.fail_invite_acceptance()`);
      await assert.rejects(finish(client, token, userId, email), /injected invite failure/);
    } finally {
      await client.query("rollback");
    }

    const afterFailure = await one<{ admins: string; completed: Date | null; accepted: Date | null }>(client,
      `select (select count(*)::text from public.church_users where church_id = $1) as admins,
              c.onboarding_completed_at as completed, i.accepted_at as accepted
         from public.churches c join public.church_invites i on i.church_id = c.id
        where c.id = $1 and i.id = $2`, [church.id, invite.id]);
    assert.equal(afterFailure.admins, "0");
    assert.equal(afterFailure.completed, null);
    assert.equal(afterFailure.accepted, null);

    await client.query("begin");
    try {
      await client.query("set local role service_role");
      assert.equal((await finish(client, token, userId, email)).outcome, "completed");
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    }
    const saved = await one<{ role: string; step: string; completed: Date | null; accepted: Date | null }>(client,
      `select u.role, u.onboarding_step as step,
              c.onboarding_completed_at as completed, i.accepted_at as accepted
         from public.churches c
         join public.church_invites i on i.church_id = c.id
         join public.church_users u on u.church_id = c.id
        where c.id = $1 and i.id = $2 and u.user_id = $3`, [church.id, invite.id, userId]);
    assert.equal(saved.role, "admin");
    assert.equal(saved.step, "completed");
    assert.ok(saved.completed);
    assert.ok(saved.accepted);
    assert.equal((await finish(client, token, userId, email)).outcome, "already_accepted");
  });
});
