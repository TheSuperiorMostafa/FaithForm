import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { one, staffUser, suiteOptions, withChurch, type Client } from "./groups-fixtures";

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

async function reply(client: Client, ticketId: string, churchId: string, userId: string) {
  return one<{ subject: string }>(
    client,
    "select public.reply_to_support_ticket($1, $2, $3, 'QA Admin', '  QA reply  ') as subject",
    [ticketId, churchId, userId],
  );
}

test("church reply and ticket reopening commit together", suiteOptions, async () => {
  await withChurch(async (client, church) => {
    const userId = await staffUser(client, church.id);
    const ticket = await one<{ id: string }>(client,
      `insert into public.support_tickets (church_id, submitted_by, subject, status)
       values ($1, $2, 'QA support ticket', 'resolved') returning id`, [church.id, userId]);

    assert.deepEqual(
      await asServiceRole(client, () => reply(client, ticket.id, church.id, userId)),
      { subject: "QA support ticket" },
    );
    const saved = await one<{ status: string; body: string; author_role: string; church_id: string }>(client,
      `select t.status, c.body, c.author_role, c.church_id
       from public.support_tickets t
       join public.support_ticket_comments c on c.ticket_id = t.id
       where t.id = $1`, [ticket.id]);
    assert.deepEqual(saved, {
      status: "open", body: "QA reply", author_role: "church", church_id: church.id,
    });

    await assert.rejects(
      asServiceRole(client, () => reply(client, ticket.id, randomUUID(), userId)),
      /Support ticket not found/,
    );
    const count = await one<{ count: number }>(client,
      "select count(*)::int as count from public.support_ticket_comments where ticket_id = $1",
      [ticket.id]);
    assert.equal(count.count, 1);

    const privileges = await one<{ anon: boolean; authenticated: boolean; service_role: boolean }>(client,
      `select has_function_privilege('anon',
         'public.reply_to_support_ticket(uuid,uuid,uuid,text,text)', 'execute') as anon,
       has_function_privilege('authenticated',
         'public.reply_to_support_ticket(uuid,uuid,uuid,text,text)', 'execute') as authenticated,
       has_function_privilege('service_role',
         'public.reply_to_support_ticket(uuid,uuid,uuid,text,text)', 'execute') as service_role`);
    assert.deepEqual(privileges, { anon: false, authenticated: false, service_role: true });
  });
});

test("failed reopening leaves no church reply behind", suiteOptions, async () => {
  await withChurch(async (client, church) => {
    const userId = await staffUser(client, church.id);
    const ticket = await one<{ id: string }>(client,
      `insert into public.support_tickets (church_id, submitted_by, subject, status)
       values ($1, $2, 'QA rollback ticket', 'resolved') returning id`, [church.id, userId]);

    await client.query(
      `alter table public.support_tickets add constraint qa_reopen_must_fail
       check (id <> '${ticket.id}'::uuid or status <> 'open')`,
    );
    try {
      await assert.rejects(
        asServiceRole(client, () => reply(client, ticket.id, church.id, userId)),
        /qa_reopen_must_fail/,
      );
      const state = await one<{ status: string; count: number }>(client,
        `select t.status, (select count(*)::int from public.support_ticket_comments
                           where ticket_id = t.id) as count
         from public.support_tickets t where t.id = $1`, [ticket.id]);
      assert.deepEqual(state, { status: "resolved", count: 0 });
    } finally {
      await client.query("alter table public.support_tickets drop constraint qa_reopen_must_fail");
    }
  });
});

test("tracked church replies start pending and remain atomic across churches", suiteOptions, async () => {
  await withChurch(async (client, church) => {
    const userId = await staffUser(client, church.id);
    const ticket = await one<{ id: string; notification_email_status: string }>(client,
      `insert into public.support_tickets (church_id, submitted_by, subject, status)
       values ($1, $2, 'QA tracked ticket', 'resolved')
       returning id, notification_email_status`, [church.id, userId]);
    assert.equal(ticket.notification_email_status, "pending");

    const commentId = randomUUID();
    const trackedReply = () => one<{ subject: string }>(client,
      `select public.reply_to_support_ticket($1, $2, $3, 'QA Admin', '  QA tracked reply  ', $4) as subject`,
      [ticket.id, church.id, userId, commentId]);
    assert.deepEqual(await asServiceRole(client, trackedReply), { subject: "QA tracked ticket" });

    const saved = await one<{ status: string; body: string; notification_email_status: string }>(client,
      `select t.status, c.body, c.notification_email_status
       from public.support_tickets t join public.support_ticket_comments c on c.ticket_id = t.id
       where c.id = $1`, [commentId]);
    assert.deepEqual(saved, { status: "open", body: "QA tracked reply", notification_email_status: "pending" });

    await assert.rejects(asServiceRole(client, trackedReply), /duplicate key/);
    await assert.rejects(
      asServiceRole(client, () => one(client,
        `select public.reply_to_support_ticket($1, $2, $3, 'QA Admin', 'cross church', $4)`,
        [ticket.id, randomUUID(), userId, randomUUID()])),
      /Support ticket not found/,
    );
    const count = await one<{ count: number }>(client,
      "select count(*)::int as count from public.support_ticket_comments where ticket_id = $1", [ticket.id]);
    assert.equal(count.count, 1);

    const privileges = await one<{ anon: boolean; authenticated: boolean; service_role: boolean }>(client,
      `select has_function_privilege('anon',
         'public.reply_to_support_ticket(uuid,uuid,uuid,text,text,uuid)', 'execute') as anon,
       has_function_privilege('authenticated',
         'public.reply_to_support_ticket(uuid,uuid,uuid,text,text,uuid)', 'execute') as authenticated,
       has_function_privilege('service_role',
         'public.reply_to_support_ticket(uuid,uuid,uuid,text,text,uuid)', 'execute') as service_role`);
    assert.deepEqual(privileges, { anon: false, authenticated: false, service_role: true });
  });
});

test("support email review records a human outcome without claiming delivery", suiteOptions, async () => {
  await withChurch(async (client, church) => {
    const userId = await staffUser(client, church.id);
    const ticket = await one<{ id: string; notification_email_status: string }>(client,
      `insert into public.support_tickets (church_id, submitted_by, subject)
       values ($1, $2, 'QA email review') returning id, notification_email_status`,
      [church.id, userId]);
    assert.equal(ticket.notification_email_status, "pending");
    const comment = await one<{ id: string; notification_email_status: string }>(client,
      `insert into public.support_ticket_comments
        (ticket_id, church_id, author_role, author_user_id, body)
       values ($1, $2, 'church', $3, 'QA reply') returning id, notification_email_status`,
      [ticket.id, church.id, userId]);
    assert.equal(comment.notification_email_status, "pending");

    await assert.rejects(
      asServiceRole(client, () => client.query(
        "update public.support_tickets set notification_email_status = 'reviewed' where id = $1",
        [ticket.id],
      )),
      /support_tickets_notification_email_review_check/,
    );

    await asServiceRole(client, async () => {
      await client.query(
        `update public.support_tickets set notification_email_status = 'reviewed',
           notification_email_reviewed_at = now(), notification_email_reviewed_by = $2
         where id = $1 and notification_email_status = 'pending'`, [ticket.id, userId]);
      await client.query(
        `update public.support_ticket_comments set notification_email_status = 'reviewed',
           notification_email_reviewed_at = now(), notification_email_reviewed_by = $2
         where id = $1 and ticket_id = $3 and notification_email_status = 'pending'`,
        [comment.id, userId, ticket.id]);
    });
    const state = await one<{ ticket_status: string; comment_status: string; reviewer: string; count: number }>(client,
      `select t.notification_email_status as ticket_status,
              c.notification_email_status as comment_status,
              c.notification_email_reviewed_by as reviewer,
              (select count(*)::int from public.support_ticket_comments
                where ticket_id = t.id and notification_email_status in ('pending', 'unconfirmed')) as count
       from public.support_tickets t
       join public.support_ticket_comments c on c.ticket_id = t.id
       where c.id = $1`, [comment.id]);
    assert.deepEqual(state, {
      ticket_status: "reviewed", comment_status: "reviewed", reviewer: userId, count: 0,
    });

    const privileges = await one<{
      ticket: boolean; comment: boolean; church_subject: boolean;
      private_notes: boolean; comment_body: boolean; comment_email: boolean;
      service_role: boolean; service_insert: boolean;
      anonymous_truncate: boolean; church_truncate: boolean; comment_truncate: boolean;
    }>(client,
      `select has_column_privilege('authenticated', 'public.support_tickets',
          'notification_email_status', 'update') as ticket,
          has_column_privilege('authenticated', 'public.support_ticket_comments',
          'notification_email_status', 'update') as comment,
          has_column_privilege('authenticated', 'public.support_tickets',
          'subject', 'select') as church_subject,
          has_column_privilege('authenticated', 'public.support_tickets',
          'admin_notes', 'select') as private_notes,
          has_column_privilege('authenticated', 'public.support_ticket_comments',
          'body', 'select') as comment_body,
          has_column_privilege('authenticated', 'public.support_ticket_comments',
          'notification_email_status', 'select') as comment_email,
          has_column_privilege('service_role', 'public.support_tickets',
          'notification_email_status', 'update') as service_role,
          has_table_privilege('service_role', 'public.support_tickets', 'insert') as service_insert,
          has_table_privilege('anon', 'public.support_tickets', 'truncate') as anonymous_truncate,
          has_table_privilege('authenticated', 'public.support_tickets', 'truncate') as church_truncate,
          has_table_privilege('authenticated', 'public.support_ticket_comments', 'truncate') as comment_truncate`);
    assert.deepEqual(privileges, {
      ticket: false, comment: false, church_subject: true, private_notes: false,
      comment_body: true, comment_email: false, service_role: true, service_insert: true,
      anonymous_truncate: false, church_truncate: false, comment_truncate: false,
    });

    await client.query("begin");
    try {
      await client.query("set local role authenticated");
      await client.query("select set_config('request.jwt.claim.sub', $1, true)", [userId]);
      const visible = await one<{ subject: string }>(client,
        "select subject from public.support_tickets where id = $1", [ticket.id]);
      assert.equal(visible.subject, "QA email review");
      const churchReply = await one<{ body: string }>(client,
        "select body from public.support_ticket_comments where id = $1", [comment.id]);
      assert.equal(churchReply.body, "QA reply");
      await assert.rejects(
        client.query("select notification_email_status from public.support_ticket_comments where id = $1", [comment.id]),
        /permission denied/,
      );
      await client.query("rollback");
      await client.query("begin");
      await client.query("set local role authenticated");
      await client.query("select set_config('request.jwt.claim.sub', $1, true)", [userId]);
      await assert.rejects(
        client.query("select admin_notes from public.support_tickets where id = $1", [ticket.id]),
        /permission denied/,
      );
    } finally {
      await client.query("rollback");
    }
  });
});
