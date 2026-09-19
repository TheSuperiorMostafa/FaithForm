import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import {
  appAccount,
  asUser,
  authUser,
  connect,
  group,
  join,
  one,
  refused,
  staffUser,
  suiteOptions,
  withChurch,
  type Client,
} from "./groups-fixtures";

/**
 * Migration 0092 against the whole migration chain: the outbox that keeps the
 * chat provider in step with FaithForm, the triggers that fill it, and who can
 * read what.
 */

async function pending(client: Client, kind: string, subject: string) {
  const { rows } = await client.query(
    `select id, status, payload, attempts from public.messaging_sync_jobs
      where kind = $1 and subject = $2 order by created_at`,
    [kind, subject],
  );
  return rows;
}

/** A chat user for an account, the way the session endpoint creates one. */
async function bind(client: Client, userId: string): Promise<string> {
  const letters = "abcdefghijklmnopqrstuvwxyz234567";
  let chatId = "ff_";
  for (let i = 0; i < 26; i += 1) chatId += letters[Math.floor(Math.random() * letters.length)];
  await client.query(
    `insert into public.messaging_user_bindings (user_id, chat_user_id) values ($1, $2)`,
    [userId, chatId],
  );
  return chatId;
}

async function clearJobs(client: Client) {
  await client.query(`delete from public.messaging_sync_jobs`);
}

test("a membership change enqueues one reconcile per group, however many changes arrive", suiteOptions, async () => {
  await withChurch(async (client, church) => {
    const groupId = await group(client, church.id);
    await clearJobs(client);

    for (let i = 0; i < 3; i += 1) {
      const { accountId } = await appAccount(client, church.id);
      await join(client, groupId, accountId);
    }

    const jobs = await pending(client, "group.members", groupId);
    assert.equal(jobs.length, 1, "three joins, one pending reconcile");
    assert.equal(jobs[0].status, "pending");
  });
});

test("a change while a job runs queues exactly one more, and completion supersedes a duplicate", suiteOptions, async () => {
  await withChurch(async (client, church) => {
    const groupId = await group(client, church.id);
    await clearJobs(client);
    const first = await appAccount(client, church.id);
    await join(client, groupId, first.accountId);

    const lease = randomUUID();
    const claimed = await client.query(`select * from public.claim_messaging_sync_jobs($1, 10)`, [lease]);
    assert.equal(claimed.rowCount, 1);
    const running = claimed.rows[0];
    assert.equal(running.status, "running");

    // The running job may have read the roster before this join.
    const second = await appAccount(client, church.id);
    await join(client, groupId, second.accountId);
    const jobs = await pending(client, "group.members", groupId);
    assert.deepEqual(jobs.map((j) => j.status), ["running", "pending"]);

    // A retry of the running job collides with the newer pending one and is
    // folded away rather than creating a third.
    const retried = await one<{ complete_messaging_sync_job: boolean }>(
      client,
      `select public.complete_messaging_sync_job($1, $2, 'retry', 'provider_unavailable')`,
      [running.id, lease],
    );
    assert.equal(retried.complete_messaging_sync_job, true);
    const after = await pending(client, "group.members", groupId);
    assert.deepEqual(after.map((j) => j.status).sort(), ["cancelled", "pending"]);
  });
});

test("only the lease holder completes a job; retries back off; attempts run out into failed", suiteOptions, async () => {
  await withChurch(async (client, church) => {
    await clearJobs(client);
    await client.query(`select public.enqueue_messaging_sync($1, 'church.channels', $2)`, [church.id, church.id]);
    await client.query(
      `update public.messaging_sync_jobs set max_attempts = 2 where kind = 'church.channels' and subject = $1`,
      [church.id],
    );

    const lease = randomUUID();
    const [job] = (await client.query(`select * from public.claim_messaging_sync_jobs($1, 10)`, [lease])).rows;
    const stranger = await one<{ complete_messaging_sync_job: boolean }>(
      client,
      `select public.complete_messaging_sync_job($1, $2, 'done')`,
      [job.id, randomUUID()],
    );
    assert.equal(stranger.complete_messaging_sync_job, false, "a stranger's lease completes nothing");

    await client.query(`select public.complete_messaging_sync_job($1, $2, 'retry', 'timeout')`, [job.id, lease]);
    const backedOff = await one<{ status: string; wait: number; last_error: string }>(
      client,
      `select status, extract(epoch from next_attempt_at - now())::int as wait, last_error
         from public.messaging_sync_jobs where id = $1`,
      [job.id],
    );
    assert.equal(backedOff.status, "pending");
    assert.ok(backedOff.wait >= 10 && backedOff.wait <= 20, `backed off ${backedOff.wait}s`);
    assert.equal(backedOff.last_error, "timeout");

    await client.query(`update public.messaging_sync_jobs set next_attempt_at = now() where id = $1`, [job.id]);
    const lease2 = randomUUID();
    const reclaimed = await client.query(`select * from public.claim_messaging_sync_jobs($1, 10)`, [lease2]);
    assert.equal(reclaimed.rowCount, 1);
    await client.query(`select public.complete_messaging_sync_job($1, $2, 'retry', 'timeout')`, [job.id, lease2]);
    const failed = await one<{ status: string }>(
      client,
      `select status from public.messaging_sync_jobs where id = $1`,
      [job.id],
    );
    assert.equal(failed.status, "failed", "out of attempts: left for a person, not retried forever");
  });
});

test("two workers claim disjoint jobs, and an expired lease returns a job to the queue", suiteOptions, async () => {
  await withChurch(async (client, church) => {
    const subjects = Array.from({ length: 6 }, () => randomUUID());
    const keys = subjects.map((subject) => `group.channel:${subject}`);
    for (const subject of subjects) {
      await client.query(`select public.enqueue_messaging_sync($1, 'group.channel', $2)`, [church.id, subject]);
    }

    const [a, b] = [await connect(), await connect()];
    try {
      await a.query("begin");
      await b.query("begin");
      const first = await a.query(
        `select id from public.claim_messaging_sync_jobs($1, 4, 120, now(), $2)`,
        [randomUUID(), keys],
      );
      const second = await b.query(
        `select id from public.claim_messaging_sync_jobs($1, 4, 120, now(), $2)`,
        [randomUUID(), keys],
      );
      await a.query("commit");
      await b.query("commit");
      const ids = [...first.rows, ...second.rows].map((r) => r.id);
      assert.equal(ids.length, 6);
      assert.equal(new Set(ids).size, 6, "no job was claimed twice");
    } finally {
      await a.end();
      await b.end();
    }

    await client.query(
      `update public.messaging_sync_jobs set lease_expires_at = now() - interval '1 second' where dedupe_key = any ($1)`,
      [keys],
    );
    const reclaimed = await client.query(
      `select id from public.claim_messaging_sync_jobs($1, 10, 120, now(), $2)`,
      [randomUUID(), keys],
    );
    assert.equal(reclaimed.rowCount, 6, "a dead worker's jobs come back");
  });
});

test("group, relationship, device and preference changes enqueue only for people who use chat", suiteOptions, async () => {
  await withChurch(async (client, church) => {
    const groupId = await group(client, church.id);
    const chatter = await appAccount(client, church.id);
    const quiet = await appAccount(client, church.id);
    await bind(client, chatter.userId);
    await join(client, groupId, chatter.accountId);
    await join(client, groupId, quiet.accountId);
    await clearJobs(client);

    await client.query(`update public.groups set name = 'Renamed' where id = $1`, [groupId]);
    assert.equal((await pending(client, "group.channel", groupId)).length, 1);

    // Counts moving is not a channel change.
    await clearJobs(client);
    await client.query(`select public.refresh_group_counts($1)`, [groupId]);
    assert.equal((await pending(client, "group.channel", groupId)).length, 0);

    await client.query(`update public.visitor_accounts set display_name = 'New Name' where id = $1`, [chatter.accountId]);
    await client.query(`update public.visitor_accounts set display_name = 'Other Name' where id = $1`, [quiet.accountId]);
    assert.equal((await pending(client, "user.sync", chatter.userId)).length, 1);
    assert.equal((await pending(client, "user.sync", quiet.userId)).length, 0, "no chat identity, no job");

    await client.query(
      `insert into public.visitor_device_installations
         (account_id, install_id, platform, environment, provider, provider_token)
       values ($1, $2, 'ios', 'production', 'apns', $3)`,
      [chatter.accountId, randomUUID(), "a".repeat(64)],
    );
    const devices = await pending(client, "user.devices", chatter.userId);
    assert.equal(devices.length, 1);
    assert.deepEqual(devices[0].payload, {}, "a job never carries a device token");

    await client.query(
      `update public.group_memberships set notification_level = 'muted' where account_id = $1`,
      [chatter.accountId],
    );
    assert.equal((await pending(client, "user.push", chatter.userId)).length, 1);

    await client.query(
      `update public.visitor_church_relationships set state = 'left' where account_id = $1`,
      [chatter.accountId],
    );
    assert.equal((await pending(client, "user.sync", chatter.userId)).length, 1, "tenancy re-derived");
    assert.equal((await pending(client, "group.members", groupId)).length, 1, "their memberships ended and resync");
  });
});

test("deleting a sign-in enqueues the chat identity's deletion with the provider id", suiteOptions, async () => {
  await withChurch(async (client, church) => {
    const person = await appAccount(client, church.id);
    const chatId = await bind(client, person.userId);
    await clearJobs(client);

    await client.query(`delete from auth.users where id = $1`, [person.userId]);

    const jobs = await pending(client, "user.delete", chatId);
    assert.equal(jobs.length, 1);
    assert.deepEqual(jobs[0].payload, { chatUserId: chatId });
    const binding = await client.query(`select 1 from public.messaging_user_bindings where user_id = $1`, [person.userId]);
    assert.equal(binding.rowCount, 0);
  });
});

test("message activity is counted per group and day, and only for channels FaithForm made", suiteOptions, async () => {
  await withChurch(async (client, church) => {
    const groupId = await group(client, church.id);
    const channelId = `grp_${groupId.replace(/-/g, "")}`;
    await client.query(
      `insert into public.group_chat_bindings (group_id, church_id, channel_id, state) values ($1, $2, $3, 'active')`,
      [groupId, church.id, channelId],
    );

    const unknown = await one<{ record_group_message_activity: boolean }>(
      client,
      `select public.record_group_message_activity('grp_${"0".repeat(32)}', now())`,
    );
    assert.equal(unknown.record_group_message_activity, false);

    for (let i = 0; i < 3; i += 1) {
      await client.query(`select public.record_group_message_activity($1, now())`, [channelId]);
    }
    const day = await one<{ message_count: number }>(
      client,
      `select message_count from public.group_activity_daily where group_id = $1`,
      [groupId],
    );
    assert.equal(day.message_count, 3);
    const last = await one<{ last_activity_at: string | null }>(
      client,
      `select last_activity_at from public.groups where id = $1`,
      [groupId],
    );
    assert.ok(last.last_activity_at);
  });
});

test("staff read their own church's reports and settings; nobody reads blocks, bindings or jobs", suiteOptions, async () => {
  await withChurch(async (client, churchA) => {
    await withChurch(async (_c, churchB) => {
      const staffA = await staffUser(client, churchA.id);
      const reporter = await appAccount(client, churchB.id);
      const reported = await appAccount(client, churchB.id);
      await client.query(
        `insert into public.messaging_reports (church_id, report_type, reporter_user_id, reported_user_id, message_id, reason)
         values ($1, 'message', $2, $3, 'msg-1', 'harassment')`,
        [churchB.id, reporter.userId, reported.userId],
      );
      await client.query(
        `insert into public.messaging_reports (church_id, report_type, reporter_user_id, reported_user_id, message_id, reason)
         values ($1, 'message', $2, $3, 'msg-2', 'spam')`,
        [churchA.id, reporter.userId, reported.userId],
      );
      await client.query(
        `insert into public.messaging_blocks (blocker_user_id, blocked_user_id, church_id) values ($1, $2, $3)`,
        [reporter.userId, reported.userId, churchA.id],
      );
      await bind(client, staffA);
      await client.query(`insert into public.church_messaging_settings (church_id, dm_policy) values ($1, 'everyone')`, [churchB.id]);

      await asUser(client, staffA, async () => {
        const reports = await client.query(`select message_id from public.messaging_reports`);
        assert.deepEqual(reports.rows.map((r) => r.message_id), ["msg-2"], "only their church's reports");
        const settings = await client.query(`select church_id from public.church_messaging_settings`);
        assert.equal(settings.rowCount, 0, "another church's policy is invisible");
        for (const table of [
          "messaging_blocks", "messaging_user_bindings", "messaging_sync_jobs",
          "messaging_dm_channels", "messaging_notification_preferences", "messaging_webhook_receipts",
          "group_chat_bindings",
        ]) {
          assert.ok(await refused(client, `select * from public.${table}`), `${table} is server-only`);
        }
        assert.ok(
          await refused(client, `update public.messaging_reports set status = 'dismissed'`),
          "a report is resolved by the server, not by a browser",
        );
        assert.ok(
          await refused(client, `select public.enqueue_messaging_sync(null, 'user.delete', 'x')`),
          "the outbox is not callable",
        );
      });
    });
  });
});

test("a staff member's own read markers are theirs alone", suiteOptions, async () => {
  await withChurch(async (client, church) => {
    const staffA = await staffUser(client, church.id);
    const staffB = await staffUser(client, church.id);
    const groupId = await group(client, church.id);
    for (const staff of [staffA, staffB]) {
      await client.query(
        `insert into public.group_staff_reads (user_id, group_id, church_id) values ($1, $2, $3)`,
        [staff, groupId, church.id],
      );
    }
    await asUser(client, staffA, async () => {
      const { rows } = await client.query(`select user_id from public.group_staff_reads`);
      assert.deepEqual(rows.map((r) => r.user_id), [staffA]);
    });
  });
});

test("church policy defaults to no direct messages, and a policy change enqueues a re-evaluation", suiteOptions, async () => {
  await withChurch(async (client, church) => {
    await clearJobs(client);
    const settings = await one<{ dm_policy: string; messaging_enabled: boolean }>(
      client,
      `insert into public.church_messaging_settings (church_id) values ($1) returning dm_policy, messaging_enabled`,
      [church.id],
    );
    assert.equal(settings.dm_policy, "disabled");
    assert.equal(settings.messaging_enabled, true);
    await clearJobs(client);

    await client.query(`update public.church_messaging_settings set dm_policy = 'group_members' where church_id = $1`, [church.id]);
    assert.equal((await pending(client, "dm.sync", `church:${church.id}`)).length, 1);
    assert.equal((await pending(client, "church.channels", church.id)).length, 1);

    await assert.rejects(
      client.query(`update public.church_messaging_settings set dm_policy = 'anyone' where church_id = $1`, [church.id]),
      /church_messaging_dm_policy_check/,
    );
  });
});

test("a direct conversation is one row per pair per church, and deleting it enqueues the provider's deletion", suiteOptions, async () => {
  await withChurch(async (client, church) => {
    const [a, b] = [await authUser(client), await authUser(client)];
    const [low, high] = [a, b].sort();
    const channel = `dm_${"a".repeat(30)}`;
    await client.query(
      `insert into public.messaging_dm_channels (church_id, channel_id, user_low, user_high) values ($1, $2, $3, $4)`,
      [church.id, channel, low, high],
    );
    await assert.rejects(
      client.query(
        `insert into public.messaging_dm_channels (church_id, channel_id, user_low, user_high) values ($1, $2, $3, $4)`,
        [church.id, `dm_${"b".repeat(30)}`, low, high],
      ),
      /unique/,
    );
    await assert.rejects(
      client.query(
        `insert into public.messaging_dm_channels (church_id, channel_id, user_low, user_high) values ($1, $2, $3, $4)`,
        [church.id, `dm_${"c".repeat(30)}`, high, low],
      ),
      /messaging_dm_channels_ordered/,
    );
    await clearJobs(client);
    await client.query(`delete from auth.users where id = $1`, [a]);
    const jobs = await pending(client, "channel.delete", `ff_dm:${channel}`);
    assert.equal(jobs.length, 1);
    assert.deepEqual(jobs[0].payload, { channelType: "ff_dm", channelId: channel });
    await client.query(`delete from auth.users where id = $1`, [b]);
  });
});

test("a church can still be deleted, and its group channels are queued for removal", suiteOptions, async () => {
  const client = await connect();
  const churchId = randomUUID();
  try {
    await client.query(
      `insert into public.churches (id, name, slug) values ($1, 'Doomed Church', $2)`,
      [churchId, `doomed-${churchId.slice(0, 8)}`],
    );
    const groupId = await group(client, churchId);
    const person = await appAccount(client, churchId);
    await bind(client, person.userId);
    await join(client, groupId, person.accountId);
    const channelId = `grp_${groupId.replace(/-/g, "")}`;
    await client.query(
      `insert into public.group_chat_bindings (group_id, church_id, channel_id, state) values ($1, $2, $3, 'active')`,
      [groupId, churchId, channelId],
    );
    await clearJobs(client);

    // The whole cascade — groups, memberships, bindings — in one statement.
    await client.query(`delete from public.churches where id = $1`, [churchId]);

    const jobs = await pending(client, "channel.delete", `ff_group:${channelId}`);
    assert.equal(jobs.length, 1, "the channel is queued for deletion");
    const job = await one<{ church_id: string | null }>(
      client,
      `select church_id from public.messaging_sync_jobs where id = $1`,
      [jobs[0].id],
    );
    assert.equal(job.church_id, null, "and holds no pointer to a church that no longer exists");
    await client.query(`delete from auth.users where id = $1`, [person.userId]);
  } finally {
    await client.query(`delete from public.churches where id = $1`, [churchId]);
    await client.end();
  }
});
