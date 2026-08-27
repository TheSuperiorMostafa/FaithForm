import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

/**
 * Whether the hot paths *have an index that answers them*.
 *
 * ## Why not "is the plan an index scan"
 *
 * That was the first version of this file, and it failed on three correct
 * queries. The planner chooses a sequential scan on a small table whatever the
 * indexes say, because reading four hundred rows is cheaper than descending a
 * btree — so on fixture data the assertion measured the fixture size, not the
 * schema. Seeding "enough" rows to change the planner's mind is a number nobody
 * can defend and a suite nobody wants to run.
 *
 * So each check asks the question that actually matters: **with a sequential
 * scan taken off the table, can this query be answered by an index at all?** An
 * index that does not exist, or exists with the wrong columns, or is partial on
 * a predicate the query does not carry, cannot — and that is the failure worth
 * catching, because it is the one that only shows up on a church with four years
 * of data.
 *
 * ## What this still cannot say
 *
 * Nothing about speed. There is no benchmark here, no timing, and no claim that
 * any of these are fast on real data — a laptop with a cold cache and no rows
 * would produce numbers that mean nothing. Real-volume performance is a staging
 * item.
 */

const DATABASE_URL = process.env.FAITHFUL_TEST_DATABASE_URL;

const SKIP_REASON =
  "FAITHFUL_TEST_DATABASE_URL is not set — no disposable Postgres target. " +
  "The hot-path index coverage is UNOBSERVED until this runs.";

if (/prod/i.test(DATABASE_URL ?? "")) {
  throw new Error("refusing to run plan checks against a production-looking database");
}

type Client = {
  query: (text: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
  end: () => Promise<void>;
};

async function connect(): Promise<Client> {
  const { Client: PgClient } = await import("pg");
  const client = new PgClient({ connectionString: DATABASE_URL });
  await client.connect();
  return client as unknown as Client;
}

function run(body: (client: Client) => Promise<void>): () => Promise<void> {
  return async () => {
    const client = await connect();
    try {
      await body(client);
    } finally {
      await client.end().catch(() => {});
    }
  };
}

/**
 * The plan for one query, with sequential scans taken off the table.
 *
 * `enable_seqscan = off` does not forbid a seq scan — PostgreSQL will still use
 * one when there is no alternative. That is precisely what makes it useful here:
 * a plan that *still* scans is a plan with no index to use.
 */
async function planWithoutSeqScan(
  client: Client,
  sql: string,
  values: unknown[] = [],
): Promise<string> {
  // Session-level, not `SET LOCAL`: outside a transaction block `SET LOCAL`
  // emits a warning and does nothing, which makes every assertion below pass or
  // fail for the wrong reason. Each test has its own connection, so the setting
  // cannot leak into another.
  await client.query("set enable_seqscan = off");
  const { rows } = await client.query(`explain (analyze false, verbose false) ${sql}`, values);
  await client.query("set enable_seqscan = on");
  return rows.map((row) => String(row["QUERY PLAN"])).join("\n");
}

/**
 * Asserts an index answers this query, and names it.
 *
 * Naming the index is the point: "some index was used" would pass on a primary
 * key doing a full scan, which is not what any of these paths need.
 *
 * Used only where **one** index is the right answer. For a query two indexes
 * could serve, naming one asserts which the planner picked on an empty table —
 * which is a fact about the fixture, not about the schema. Those use
 * `assertUniqueConstraint` plus `assertAnyIndexAnswers` instead.
 */
async function assertIndexAnswers(
  client: Client,
  context: string,
  index: string,
  sql: string,
  values: unknown[] = [],
) {
  const plan = await planWithoutSeqScan(client, sql, values);
  assert.ok(
    plan.includes(index),
    `${context} is not answered by ${index}:\n${plan}`,
  );
}

/** Any index at all, for a query more than one could legitimately serve. */
async function assertAnyIndexAnswers(
  client: Client,
  context: string,
  sql: string,
  values: unknown[] = [],
) {
  const plan = await planWithoutSeqScan(client, sql, values);
  assert.ok(
    /Index (Only )?Scan/.test(plan),
    `${context} has no index to answer it:\n${plan}`,
  );
}

/**
 * Asserts a **unique** index exists on exactly these columns.
 *
 * Uniqueness is a schema fact, not a plan fact — and for these two paths it is a
 * correctness property rather than a performance one. A missing unique index
 * here would not be slow; it would let one person be counted twice, or one
 * donation become two charges.
 */
async function assertUniqueConstraint(
  client: Client,
  table: string,
  columns: string[],
) {
  const { rows } = await client.query(
    `select indexdef from pg_indexes
      where schemaname = 'public' and tablename = $1`,
    [table],
  );
  const definitions = rows.map((row) => String(row.indexdef));
  const match = definitions.find(
    (definition) =>
      definition.includes("UNIQUE") &&
      columns.every((column) => new RegExp(`\\b${column}\\b`).test(definition)),
  );
  assert.ok(
    match,
    `${table} has no unique index on (${columns.join(", ")}):\n${definitions.join("\n")}`,
  );
}

const options = DATABASE_URL ? {} : { skip: SKIP_REASON };

// ---------------------------------------------------------------------------
// The check that keeps the rest honest
// ---------------------------------------------------------------------------

test("a query with no index still scans, so these assertions are not vacuous", options,
  run(async (client) => {
    // If `enable_seqscan = off` made *everything* look indexed, every assertion
    // below would pass on a schema with no indexes at all.
    const plan = await planWithoutSeqScan(
      client,
      `select * from public.media_views where source = $1`,
      ["website"],
    );
    assert.ok(
      /Seq Scan/.test(plan),
      `a query with no usable index did not scan, so this suite proves nothing:\n${plan}`,
    );
  }));

// ---------------------------------------------------------------------------
// Attendance and check-in
// ---------------------------------------------------------------------------

test("a church's attendance reporting has an index", options,
  run(async (client) => {
    await assertIndexAnswers(
      client,
      "attendance reporting",
      "attendance_facts_church_reporting_idx",
      `select * from public.attendance_facts
        where church_id = $1
        order by counted_at desc
        limit 25`,
      [randomUUID()],
    );
  }));

test("a member's own attendance history has an index", options,
  run(async (client) => {
    await assertIndexAnswers(
      client,
      "member attendance history",
      "attendance_facts_member_history_idx",
      `select * from public.attendance_facts
        where member_id = $1
        order by counted_at desc
        limit 25`,
      [randomUUID()],
    );
  }));

test("the duplicate-check-in guard is enforced by a unique index", options,
  run(async (client) => {
    // The index that makes "counted once" true rather than hopeful. A missing
    // one would not be slow — it would be wrong.
    //
    // Asserted as a schema fact: on an empty table the planner will serve this
    // query from the member-history index just as happily, and asserting which
    // one it picked would be asserting the fixture.
    await assertUniqueConstraint(client, "attendance_facts", [
      "service_occurrence_id",
      "member_id",
    ]);
    await assertAnyIndexAnswers(
      client,
      "the counted-once lookup",
      `select 1 from public.attendance_facts
        where service_occurrence_id = $1 and member_id = $2`,
      [randomUUID(), randomUUID()],
    );
  }));

// ---------------------------------------------------------------------------
// Media
// ---------------------------------------------------------------------------

test("the published media archive has a partial index that matches its predicate", options,
  run(async (client) => {
    // The predicate matters. `stream_recordings_mobile_archive_idx` is partial
    // on `mobile_visibility <> 'none' and mobile_unpublished_at is null`, and a
    // query missing either half cannot use it — which is how a partial index
    // ends up decorating a table nobody's query can reach.
    await assertIndexAnswers(
      client,
      "the media archive",
      "stream_recordings_mobile_archive_idx",
      `select * from public.stream_recordings
        where church_id = $1
          and mobile_visibility <> 'none'
          and mobile_unpublished_at is null
        order by mobile_published_at desc, id desc
        limit 25`,
      [randomUUID()],
    );
  }));

test("the eligibility filter has an index", options,
  run(async (client) => {
    await assertIndexAnswers(
      client,
      "the mobile-playable filter",
      "stream_recordings_mobile_playable_idx",
      // Partial on all three conditions. A query carrying only `mobile_playable`
      // cannot use it — which is exactly the mistake this test caught in its own
      // first draft.
      `select * from public.stream_recordings
        where church_id = $1
          and mobile_playable
          and mobile_visibility <> 'none'
          and mobile_unpublished_at is null
        order by mobile_published_at desc`,
      [randomUUID()],
    );
  }));

// ---------------------------------------------------------------------------
// Giving
// ---------------------------------------------------------------------------

test("published giving funds have a partial index", options,
  run(async (client) => {
    await assertIndexAnswers(
      client,
      "the giving fund list",
      "giving_funds_mobile_published_idx",
      `select * from public.giving_funds
        where church_id = $1 and mobile_visibility <> 'none'
        order by sort_order`,
      [randomUUID()],
    );
  }));

test("a donor's own giving history has an index", options,
  run(async (client) => {
    await assertIndexAnswers(
      client,
      "giving history",
      "giving_donation_attempts_history_idx",
      `select * from public.giving_donation_attempts
        where account_id = $1 and church_id = $2
        order by created_at desc
        limit 25`,
      [randomUUID(), randomUUID()],
    );
  }));

test("the duplicate-donation guard is enforced by a unique index", options,
  run(async (client) => {
    // The index that makes one logical attempt one charge. As with attendance,
    // a missing one is a correctness failure rather than a slow query.
    await assertUniqueConstraint(client, "giving_donation_attempts", [
      "account_id",
      "client_attempt_id",
    ]);
    await assertAnyIndexAnswers(
      client,
      "the one-attempt-one-charge lookup",
      `select 1 from public.giving_donation_attempts
        where account_id = $1 and client_attempt_id = $2`,
      [randomUUID(), "attempt-aaaaaaaa"],
    );
  }));

test("a payment intent resolves to one attempt by index", options,
  run(async (client) => {
    // The webhook's own lookup, on the hottest path in giving.
    await assertIndexAnswers(
      client,
      "the webhook's attempt lookup",
      "giving_donation_attempts_intent_key",
      `select 1 from public.giving_donation_attempts
        where stripe_payment_intent_id = $1`,
      ["pi_example"],
    );
  }));

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

test("church-by-slug has a unique index", options,
  run(async (client) => {
    // The single most-executed lookup in the product: every request the app
    // makes resolves a church by slug first.
    await assertIndexAnswers(
      client,
      "church-by-slug",
      "churches_slug_key",
      `select id, name from public.churches where slug = $1`,
      ["grace"],
    );
  }));

// ---------------------------------------------------------------------------
// Web dashboard
// ---------------------------------------------------------------------------

test("dashboard church membership resolution has an ordered index", options,
  run(async (client) => {
    await assertIndexAnswers(
      client,
      "dashboard church membership resolution",
      "church_users_user_created_idx",
      `select church_id, role from public.church_users
        where user_id = $1
        order by created_at
        limit 1`,
      [randomUUID()],
    );
  }));

test("the active people roster has an ordered tenant index", options,
  run(async (client) => {
    await assertIndexAnswers(
      client,
      "active people roster",
      "members_church_active_name_idx",
      `select id, first_name, last_name from public.members
        where church_id = $1 and is_active = true
        order by last_name, first_name`,
      [randomUUID()],
    );
  }));

test("bounded succeeded-gift summaries have a composite index", options,
  run(async (client) => {
    await assertIndexAnswers(
      client,
      "bounded succeeded-gift summaries",
      "giving_donations_church_status_created_idx",
      `select amount_cents, donor_id, donor_email, created_at
         from public.giving_donations
        where church_id = $1 and status = 'succeeded' and created_at >= $2`,
      [randomUUID(), new Date("2026-01-01T00:00:00Z")],
    );
  }));
