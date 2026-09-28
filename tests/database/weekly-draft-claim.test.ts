import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { connect, one, suiteOptions, withChurch, type Client } from "./groups-fixtures";

async function asServiceRole<T>(client: Client, work: () => Promise<T>): Promise<T> {
  await client.query("begin");
  try {
    await client.query("set local role service_role");
    const result = await work();
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
}

async function claim(client: Client, churchId: string, claimId: string, force = false) {
  const row = await one<{ status: string }>(
    client,
    "select public.claim_weekly_announcement_draft($1, '2026-09-28'::date, $2, $3) as status",
    [churchId, claimId, force],
  );
  return row.status;
}

test("simultaneous weekly runs reserve one draft and preserve an uncertain result", suiteOptions, async () => {
  await withChurch(async (client, church) => {
    const second = await connect();
    try {
      const firstId = randomUUID();
      const secondId = randomUUID();
      const [first, next] = await Promise.all([
        asServiceRole(client, () => claim(client, church.id, firstId)),
        asServiceRole(second, () => claim(second, church.id, secondId)),
      ]);
      assert.deepEqual([first, next].sort(), ["claimed", "needs_review"]);
      const winner = first === "claimed" ? firstId : secondId;

      await asServiceRole(client, () => client.query(
        "select public.complete_weekly_announcement_draft($1, '2026-09-28'::date, $2, 'gmail-draft-1')",
        [church.id, winner],
      ));
      const state = await one<{ state: string; draft_id: string; setting_id: string }>(
        client,
        `select c.state, c.draft_id,
                s.last_weekly_announcement_draft_id as setting_id
         from public.announcement_weekly_draft_claims c
         join public.church_settings s on s.church_id = c.church_id
         where c.church_id = $1`,
        [church.id],
      );
      assert.deepEqual(state, { state: "saved", draft_id: "gmail-draft-1", setting_id: "gmail-draft-1" });
      assert.equal(
        await asServiceRole(client, () => claim(client, church.id, randomUUID())),
        "already_created",
      );

      const remakeId = randomUUID();
      assert.equal(
        await asServiceRole(client, () => claim(client, church.id, remakeId, true)),
        "claimed",
      );
      await asServiceRole(client, () => client.query(
        "select public.mark_weekly_announcement_draft_uncertain($1, '2026-09-28'::date, $2)",
        [church.id, remakeId],
      ));
      assert.equal(
        await asServiceRole(client, () => claim(client, church.id, randomUUID(), true)),
        "needs_review",
      );

      // Support can reconcile a draft found in the mailbox without making a
      // second provider call.
      await asServiceRole(client, () => client.query(
        "select public.complete_weekly_announcement_draft($1, '2026-09-28'::date, $2, 'gmail-draft-2')",
        [church.id, remakeId],
      ));
      const reconciled = await one<{ draft_id: string; setting_id: string }>(client,
        `select c.draft_id, s.last_weekly_announcement_draft_id as setting_id
         from public.announcement_weekly_draft_claims c
         join public.church_settings s on s.church_id = c.church_id
         where c.church_id = $1`, [church.id]);
      assert.deepEqual(reconciled, { draft_id: "gmail-draft-2", setting_id: "gmail-draft-2" });

      const reviewId = randomUUID();
      assert.equal(await asServiceRole(client, () => claim(client, church.id, reviewId, true)), "claimed");
      await asServiceRole(client, () => client.query(
        "select public.mark_weekly_announcement_draft_uncertain($1, '2026-09-28'::date, $2)",
        [church.id, reviewId],
      ));

      await assert.rejects(
        asServiceRole(client, () => client.query(
          "select public.clear_weekly_announcement_draft_claim($1, '2026-09-28'::date, $2, false)",
          [church.id, reviewId],
        )),
        /Mailbox review required/,
      );
      const tooSoon = await asServiceRole(client, () => one<{ cleared: boolean }>(
        client,
        "select public.clear_weekly_announcement_draft_claim($1, '2026-09-28'::date, $2, true) as cleared",
        [church.id, reviewId],
      ));
      assert.equal(tooSoon.cleared, false);

      await client.query(
        "update public.announcement_weekly_draft_claims set updated_at = now() - interval '16 minutes' where church_id = $1",
        [church.id],
      );
      const reviewed = await asServiceRole(client, () => one<{ cleared: boolean }>(
        client,
        "select public.clear_weekly_announcement_draft_claim($1, '2026-09-28'::date, $2, true) as cleared",
        [church.id, reviewId],
      ));
      assert.equal(reviewed.cleared, true);
      assert.equal(await asServiceRole(client, () => claim(client, church.id, randomUUID())), "claimed");

      const grants = await one<{ anon: boolean; member: boolean }>(client,
        `select has_function_privilege('anon',
            'public.claim_weekly_announcement_draft(uuid,date,uuid,boolean)', 'execute') as anon,
                has_function_privilege('authenticated',
            'public.claim_weekly_announcement_draft(uuid,date,uuid,boolean)', 'execute') as member`);
      assert.deepEqual(grants, { anon: false, member: false });
    } finally {
      await second.end();
    }
  });
});
