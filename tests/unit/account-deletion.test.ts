import assert from "node:assert/strict";
import test from "node:test";

import {
  DELETION_LEASE_MS,
  MAX_DELETION_ATTEMPTS,
  SIGN_IN_DEPENDENTS,
  runAccountDeletions,
  type DeletionLogger,
} from "@/lib/faithform/account-deletion";
import { enqueueRecurringGiftCancellationsForAccount, runRecurringGiftCancellationWorker } from "@/lib/giving/v1/recurring-cancellation-jobs";
import type { GivingPaymentProvider } from "@/lib/giving/v1/payment-provider";
import { BOOTSTRAP_SUPERADMIN_EMAILS } from "@/lib/auth/superadmin-emails";

import {
  ACCOUNT_REFERENCES,
  AUTH_USER_CASCADES,
  AUTH_USER_OWNED,
  type Reference,
} from "../policies/account-references";

/**
 * The deletion job against an in-memory Supabase.
 *
 * The fake's foreign keys are not written here: they come from
 * account-references.ts, which `tests/policies/account-deletion-migration.test.ts`
 * proves is exactly what the migrations declare. So "the Auth delete removed
 * the relationships" below is the real schema's cascade, run in memory: the
 * same behaviour a disposable Postgres showed when the migration was written.
 *
 * What is not proven here is PostgREST or GoTrue themselves: the fake answers
 * the subset of the query builder the job uses, and nothing else.
 */

type Row = Record<string, unknown>;
type DbError = { code: string; message: string; status?: number };

const NOW = new Date("2026-09-13T12:00:00.000Z");

// ---------------------------------------------------------------------------
// The fake
// ---------------------------------------------------------------------------

const EXTRA_REFERENCES: Record<string, Reference[]> = {
  // Second-level pointers the job relies on being nulled, not deleted.
  visitor_people_links: [{ table: "visitor_people_link_events", column: "link_id", action: "set null" }],
  visitor_people_claims: [
    { table: "visitor_people_links", column: "claim_id", action: "set null" },
    { table: "visitor_people_link_events", column: "claim_id", action: "set null" },
  ],
};

const REFERENCES: Record<string, Reference[]> = {
  "auth.users": [
    ...AUTH_USER_CASCADES,
    ...AUTH_USER_OWNED,
    { table: "visitor_people_link_events", column: "actor_user_id", action: "set null" },
  ],
  visitor_accounts: [...ACCOUNT_REFERENCES],
  ...EXTRA_REFERENCES,
};

type Operation = { table: string; op: "select" | "update" | "delete" | "insert"; rows: Row[] };

class FakeDatabase {
  tables = new Map<string, Row[]>();
  users = new Map<string, { id: string; email: string }>();
  deletedUsers: string[] = [];
  /** Return an error to make that operation fail, before it changes anything. */
  failOn: (operation: Operation) => DbError | null = () => null;
  failAuthDelete: (userId: string) => DbError | null = () => null;
  /** Runs just before a write, so a test can play a second, overlapping run. */
  beforeWrite: (operation: Operation) => void = () => {};
  clock = new Date(NOW);
  private ids = 0;

  rows(table: string): Row[] {
    if (!this.tables.has(table)) this.tables.set(table, []);
    return this.tables.get(table)!;
  }

  insert(table: string, row: Row): Row {
    const stored = { id: row.id ?? `${table}-${++this.ids}`, ...row };
    this.rows(table).push(stored);
    return stored;
  }

  remove(table: string, doomed: Row[]): void {
    const ids = new Set(doomed.map((row) => row.id));
    this.tables.set(
      table,
      this.rows(table).filter((row) => !ids.has(row.id)),
    );
    const key = table === "auth.users" ? "auth.users" : table;
    for (const reference of REFERENCES[key] ?? []) {
      const children = this.rows(reference.table).filter((child) =>
        doomed.some((parent) => child[reference.column] === parent.id),
      );
      if (reference.action === "cascade") this.remove(reference.table, children);
      else for (const child of children) child[reference.column] = null;
    }
  }

  client(): never {
    return {
      from: (table: string) => new FakeQuery(this, table),
      rpc: async (name: string, input: { p_lease_token: string; p_limit: number }) => {
        assert.equal(name, "claim_recurring_gift_cancellations");
        const error = this.failOn({ table: "giving_recurring_cancellation_jobs", op: "select", rows: [] });
        if (error) return { data: null, error };
        const jobs = this.rows("giving_recurring_cancellation_jobs").filter((row) =>
          (row.status === "pending" && String(row.next_attempt_at) <= this.clock.toISOString()) ||
          (row.status === "processing" && String(row.lease_expires_at) <= this.clock.toISOString()),
        ).slice(0, input.p_limit);
        for (const row of jobs) Object.assign(row, { status: "processing", attempts: Number(row.attempts) + 1, lease_token: input.p_lease_token, lease_expires_at: new Date(this.clock.getTime() + 600_000).toISOString() });
        return { data: jobs.map((row) => ({ ...row })), error: null };
      },
      auth: {
        admin: {
          getUserById: async (id: string) => {
            const user = this.users.get(id);
            return user
              ? { data: { user }, error: null }
              : { data: { user: null }, error: { status: 404, code: "user_not_found", message: `no ${id}` } };
          },
          deleteUser: async (id: string, soft?: boolean) => {
            assert.equal(soft, false, "a soft delete keeps the email address");
            const failure = this.failAuthDelete(id);
            if (failure) return { data: { user: null }, error: failure };
            const user = this.users.get(id);
            if (!user) {
              return { data: { user: null }, error: { status: 404, code: "user_not_found", message: "gone" } };
            }
            this.users.delete(id);
            this.deletedUsers.push(id);
            this.remove("auth.users", [{ id }]);
            return { data: { user: {} }, error: null };
          },
        },
      },
    } as never;
  }
}

class FakeQuery implements PromiseLike<{ data: unknown; error: DbError | null }> {
  private op: Operation["op"] = "select";
  private values: Row | Row[] | null = null;
  private filters: ((row: Row) => boolean)[] = [];
  private orders: { column: string; ascending: boolean; nullsFirst: boolean }[] = [];
  private max: number | null = null;
  private offset = 0;
  private ignoreDuplicates = false;
  private returning = false;
  private single = false;

  constructor(
    private readonly db: FakeDatabase,
    private readonly table: string,
  ) {}

  select() {
    if (this.op !== "select") this.returning = true;
    return this;
  }
  update(values: Row) {
    this.op = "update";
    this.values = values;
    return this;
  }
  delete() {
    this.op = "delete";
    return this;
  }
  insert(values: Row | Row[]) {
    this.op = "insert";
    this.values = values;
    return this;
  }
  upsert(values: Row | Row[], options: { ignoreDuplicates: boolean }) {
    this.ignoreDuplicates = options.ignoreDuplicates;
    return this.insert(values);
  }
  is(column: string, value: unknown) {
    this.filters.push((row) => value === null ? row[column] == null : row[column] === value);
    return this;
  }
  gt(column: string, value: string) {
    this.filters.push((row) => typeof row[column] === "string" && String(row[column]) > value);
    return this;
  }
  range(from: number, to: number) {
    this.offset = from;
    this.max = to - from + 1;
    return this;
  }
  eq(column: string, value: unknown) {
    this.filters.push((row) => row[column] === value);
    return this;
  }
  in(column: string, values: unknown[]) {
    this.filters.push((row) => values.includes(row[column]));
    return this;
  }
  lt(column: string, value: string) {
    this.filters.push((row) => typeof row[column] === "string" && (row[column] as string) < value);
    return this;
  }
  order(column: string, options: { ascending?: boolean; nullsFirst?: boolean } = {}) {
    this.orders.push({
      column,
      ascending: options.ascending ?? true,
      nullsFirst: options.nullsFirst ?? false,
    });
    return this;
  }
  limit(count: number) {
    this.max = count;
    return this;
  }
  maybeSingle() {
    this.single = true;
    return this;
  }

  then<A = { data: unknown; error: DbError | null }, B = never>(
    onFulfilled?: ((value: { data: unknown; error: DbError | null }) => A | PromiseLike<A>) | null,
    onRejected?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    return Promise.resolve().then(() => this.execute()).then(onFulfilled, onRejected);
  }

  private execute(): { data: unknown; error: DbError | null } {
    const matched = this.db.rows(this.table).filter((row) => this.filters.every((f) => f(row)));
    const operation: Operation = { table: this.table, op: this.op, rows: matched };

    const failure = this.db.failOn(operation);
    if (failure) return { data: null, error: failure };

    if (this.op === "insert") {
      const values = Array.isArray(this.values) ? this.values : [this.values!];
      this.db.beforeWrite(operation);
      const inserted = values.flatMap((value) => {
        if (this.ignoreDuplicates && this.db.rows(this.table).some((row) => row.stripe_account_id === value.stripe_account_id && row.stripe_subscription_id === value.stripe_subscription_id)) return [];
        const defaults = this.table === "giving_recurring_cancellation_jobs" ? { status: "pending", attempts: 0, next_attempt_at: this.db.clock.toISOString(), lease_token: null, lease_expires_at: null } : {};
        return [this.db.insert(this.table, { ...defaults, ...value })];
      });
      return { data: this.returning ? inserted : null, error: null };
    }

    if (this.op === "update") {
      this.db.beforeWrite(operation);
      // Re-filter: `beforeWrite` may have changed a row, as a concurrent
      // writer would between our read and our write.
      const current = this.db.rows(this.table).filter((row) => this.filters.every((f) => f(row)));
      for (const row of current) Object.assign(row, this.values);
      return { data: this.returning ? current.map((row) => ({ ...row })) : null, error: null };
    }

    if (this.op === "delete") {
      this.db.beforeWrite(operation);
      this.db.remove(this.table, matched);
      return { data: this.returning ? matched : null, error: null };
    }

    let rows = [...matched];
    for (const order of [...this.orders].reverse()) {
      rows.sort((a, b) => {
        const left = a[order.column] as string | null;
        const right = b[order.column] as string | null;
        if (left === right) return 0;
        if (left == null) return order.nullsFirst ? -1 : 1;
        if (right == null) return order.nullsFirst ? 1 : -1;
        return (left < right ? -1 : 1) * (order.ascending ? 1 : -1);
      });
    }
    if (this.offset) rows = rows.slice(this.offset);
    if (this.max !== null) rows = rows.slice(0, this.max);
    const copies = rows.map((row) => ({ ...row }));
    return { data: this.single ? (copies[0] ?? null) : copies, error: null };
  }
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const CHURCH = "church-1";

/**
 * A churchgoer with something in every kind of table: the account's own data,
 * a church's records that point at it, and a pending deletion request.
 */
function seedChurchgoer(db: FakeDatabase, n: number, overrides: { email?: string } = {}) {
  const userId = `00000000-0000-4000-8000-00000000000${n}`;
  const accountId = `account-${n}`;
  const memberId = `member-${n}`;
  const email = overrides.email ?? `person${n}@example.com`;

  db.users.set(userId, { id: userId, email });
  db.insert("visitor_accounts", { id: accountId, user_id: userId, display_name: `Person ${n}` });
  db.insert("members", { id: memberId, church_id: CHURCH, first_name: "Pat" });

  // The account's own.
  db.insert("visitor_church_relationships", { account_id: accountId, church_id: CHURCH, state: "joined" });
  db.insert("visitor_relationship_events", { account_id: accountId, church_id: CHURCH, action: "join" });
  const claim = db.insert("visitor_people_claims", {
    account_id: accountId,
    church_id: CHURCH,
    claimed_first_name: "Pat",
    normalized_email: email,
  });
  const link = db.insert("visitor_people_links", {
    id: `link-${n}`,
    account_id: accountId,
    church_id: CHURCH,
    member_id: memberId,
    claim_id: claim.id,
    is_active: true,
  });
  db.insert("visitor_device_installations", { account_id: accountId, provider_token: "apns-token" });
  db.insert("visitor_notification_preferences", { account_id: accountId, church_id: CHURCH });
  db.insert("attendance_detections", { account_id: accountId, member_id: memberId });
  db.insert("attendance_qr_scan_redemptions", { account_id: accountId, nonce: "n" });
  db.insert("giving_donor_links", { account_id: accountId, church_id: CHURCH, donor_id: `donor-${n}` });
  db.insert("giving_donation_attempts", { account_id: accountId, church_id: CHURCH, amount_cents: 2500 });

  // A church's records.
  db.insert("giving_donors", { id: `donor-${n}`, church_id: CHURCH, email });
  db.insert("giving_donations", { church_id: CHURCH, donor_id: `donor-${n}`, amount_cents: 2500 });
  db.insert("attendance_attempts", { church_id: CHURCH, member_id: memberId, account_id: accountId });
  db.insert("attendance_qr_redemptions", { church_id: CHURCH, account_id: accountId, nonce: "n" });
  db.insert("visitor_invitations", { church_id: CHURCH, max_uses: 50, accepted_by_account_id: accountId });
  db.insert("checkin_sessions", { church_id: CHURCH, pre_checked_in_by_account_id: accountId });
  db.insert("visitor_people_link_events", {
    church_id: CHURCH,
    account_id: accountId,
    link_id: link.id,
    claim_id: claim.id,
    member_id: memberId,
    action: "claim_opened",
    actor_type: "visitor",
    actor_user_id: userId,
  });

  // An old export, and the deletion request itself.
  db.insert("visitor_account_requests", {
    id: `export-${n}`,
    account_id: accountId,
    kind: "export",
    status: "pending",
    attempts: 0,
    started_at: null,
    requested_at: "2026-09-01T00:00:00.000Z",
    payload: { displayName: `Person ${n}` },
    outcome: null,
  });
  const request = db.insert("visitor_account_requests", {
    id: `request-${n}`,
    account_id: accountId,
    kind: "deletion",
    status: "pending",
    attempts: 0,
    started_at: null,
    requested_at: `2026-09-13T0${n}:00:00.000Z`,
    completed_at: null,
    last_error: null,
    outcome: null,
  });

  return { userId, accountId, memberId, email, requestId: request.id as string };
}

function capturingLogger() {
  const entries: { level: string; message: string; fields: Record<string, unknown> }[] = [];
  const logger: DeletionLogger = {
    info: (message, fields) => entries.push({ level: "info", message, fields }),
    error: (message, fields) => entries.push({ level: "error", message, fields }),
  };
  return { logger, entries };
}

const run = (db: FakeDatabase, logger = capturingLogger().logger, limit?: number) =>
  runAccountDeletions({ client: db.client(), now: () => NOW, logger, limit });

const request = (db: FakeDatabase, id: string) =>
  db.rows("visitor_account_requests").find((row) => row.id === id)!;

const OWNED_TABLES = [
  "visitor_church_relationships",
  "visitor_relationship_events",
  "visitor_people_claims",
  "visitor_people_links",
  "visitor_device_installations",
  "visitor_notification_preferences",
  "attendance_detections",
  "attendance_qr_scan_redemptions",
  "giving_donor_links",
  "giving_donation_attempts",
];

// ---------------------------------------------------------------------------
// A churchgoer
// ---------------------------------------------------------------------------

test("a due request deletes the sign-in, the account's data, and nothing a church keeps", async () => {
  const db = new FakeDatabase();
  const person = seedChurchgoer(db, 1);

  const result = await run(db);

  assert.deepEqual(result, {
    due: 1,
    authUserDeleted: 1,
    staffAccountRetained: 0,
    alreadyRemoved: 0,
    retrying: 0,
    failed: 0,
    skipped: 0,
  });

  // The email and password.
  assert.deepEqual(db.deletedUsers, [person.userId]);
  assert.equal(db.users.has(person.userId), false);

  // The profile and everything the account owned.
  assert.equal(db.rows("visitor_accounts").length, 0);
  for (const table of OWNED_TABLES) {
    assert.equal(db.rows(table).length, 0, `${table} survived the deletion`);
  }

  // The church's records stay, no longer connected to an account.
  assert.equal(db.rows("members").length, 1);
  assert.equal(db.rows("giving_donations").length, 1);
  assert.equal(db.rows("giving_donors").length, 1);
  assert.equal(db.rows("attendance_attempts")[0].account_id, null);
  assert.equal(db.rows("attendance_attempts")[0].member_id, person.memberId);
  assert.equal(db.rows("attendance_qr_redemptions")[0].account_id, null);
  assert.equal(db.rows("checkin_sessions")[0].pre_checked_in_by_account_id, null);
  const invitation = db.rows("visitor_invitations")[0];
  assert.equal(invitation.accepted_by_account_id, null);
  // A church's shared join link keeps working for everyone else.
  assert.equal(invitation.revoked_at, undefined);

  // The church's People audit says why the link went, and names nobody.
  const events = db.rows("visitor_people_link_events");
  const revoked = events.filter((event) => event.action === "link_revoked_account_deleted");
  assert.equal(revoked.length, 1);
  assert.equal(revoked[0].member_id, person.memberId);
  for (const event of events) {
    assert.equal(event.account_id, null);
    assert.equal(event.link_id, null);
    // The system-written revocation never had an actor; the visitor's own
    // event had their sign-in, which the Auth delete nulled.
    assert.ok(event.actor_user_id == null, "an audit row still names the deleted sign-in");
  }

  // The record that it was asked for and done.
  const done = request(db, person.requestId);
  assert.equal(done.status, "completed");
  assert.equal(done.completed_at, NOW.toISOString());
  assert.equal(done.outcome, "auth_user_deleted");
  assert.equal(done.account_id, null);
  assert.equal(done.attempts, 1);
  assert.equal(done.last_error, null);

  // An export outlives the account without a copy of it.
  const exported = request(db, "export-1");
  assert.equal(exported.payload, null);
  assert.equal(exported.status, "cancelled");
});

test("logs carry request ids and outcomes, never who the person was", async () => {
  const db = new FakeDatabase();
  const person = seedChurchgoer(db, 1);
  const other = seedChurchgoer(db, 2);
  db.failAuthDelete = (id) =>
    id === other.userId ? { status: 500, code: "unexpected_failure", message: `boom for ${other.email}` } : null;
  const { logger, entries } = capturingLogger();

  await run(db, logger);

  assert.equal(entries.length, 2);
  const text = JSON.stringify(entries);
  for (const secret of [person.userId, person.email, person.accountId, other.userId, other.email, other.accountId]) {
    assert.ok(!text.includes(secret), `a log line contains ${secret}`);
  }
  // And the provider's message, which quoted an email, is not stored either.
  assert.equal(request(db, other.requestId).last_error, "auth_delete:unexpected_failure");
});

// ---------------------------------------------------------------------------
// Staff
// ---------------------------------------------------------------------------

test("a church staff member keeps their sign-in; only the app account goes", async () => {
  const db = new FakeDatabase();
  const person = seedChurchgoer(db, 1);
  db.insert("church_users", { church_id: CHURCH, user_id: person.userId, role: "admin" });

  const result = await run(db);

  assert.equal(result.staffAccountRetained, 1);
  assert.equal(result.authUserDeleted, 0);
  assert.deepEqual(db.deletedUsers, [], "the dashboard sign-in was deleted");
  assert.equal(db.users.has(person.userId), true);
  assert.equal(db.rows("church_users").length, 1, "the church lost its admin");

  // The app account and its data are gone all the same.
  assert.equal(db.rows("visitor_accounts").length, 0);
  for (const table of OWNED_TABLES) {
    assert.equal(db.rows(table).length, 0, `${table} survived the deletion`);
  }
  // The staff member's sign-in no longer names them in the church's audit of
  // what they did as a churchgoer.
  const events = db.rows("visitor_people_link_events");
  assert.ok(events.some((event) => event.actor_type === "visitor"), "fixture lost its visitor event");
  for (const event of events) {
    assert.ok(event.actor_user_id == null, "an audit row still names the retained sign-in");
  }

  const done = request(db, person.requestId);
  assert.equal(done.status, "completed");
  assert.equal(done.outcome, "staff_account_retained");
});

test("every table an Auth delete would reach keeps the sign-in, and so does a bootstrap admin", async () => {
  for (const dependent of SIGN_IN_DEPENDENTS) {
    const db = new FakeDatabase();
    const person = seedChurchgoer(db, 1);
    db.insert(dependent.table, { church_id: CHURCH, [dependent.column]: person.userId });

    await run(db);

    assert.deepEqual(db.deletedUsers, [], `${dependent.table} did not keep the sign-in`);
    assert.equal(db.rows(dependent.table).length, 1, `${dependent.table} lost its row`);
    assert.equal(request(db, person.requestId).outcome, "staff_account_retained");
  }

  const db = new FakeDatabase();
  const person = seedChurchgoer(db, 1, { email: BOOTSTRAP_SUPERADMIN_EMAILS[0] });
  await run(db);
  assert.deepEqual(db.deletedUsers, []);
  assert.equal(request(db, person.requestId).outcome, "staff_account_retained");
});

test("the staff check fails closed: a lookup error deletes nothing", async () => {
  const db = new FakeDatabase();
  const person = seedChurchgoer(db, 1);
  db.failOn = ({ table, op }) =>
    table === "church_users" && op === "select" ? { code: "57014", message: "timeout" } : null;

  const result = await run(db);

  assert.equal(result.retrying, 1);
  assert.deepEqual(db.deletedUsers, []);
  assert.equal(db.rows("visitor_accounts").length, 1);
  const pending = request(db, person.requestId);
  assert.equal(pending.status, "pending");
  assert.equal(pending.attempts, 1);
  assert.equal(pending.last_error, "dependents_church_users:57014");
});

// ---------------------------------------------------------------------------
// Idempotency and recovery
// ---------------------------------------------------------------------------

test("running twice is harmless", async () => {
  const db = new FakeDatabase();
  const person = seedChurchgoer(db, 1);

  await run(db);
  const second = await run(db);

  assert.equal(second.due, 0);
  assert.deepEqual(db.deletedUsers, [person.userId]);
  assert.equal(request(db, person.requestId).status, "completed");
  assert.equal(request(db, person.requestId).attempts, 1);
});

test("a run that died after deleting is finished by the next, from its own record", async () => {
  const db = new FakeDatabase();
  const staleStart = new Date(NOW.getTime() - DELETION_LEASE_MS - 1000).toISOString();

  // Died after the Auth delete: the cascade already nulled the account id.
  db.insert("visitor_account_requests", {
    id: "request-died",
    account_id: null,
    kind: "deletion",
    status: "processing",
    attempts: 1,
    started_at: staleStart,
    requested_at: "2026-09-12T00:00:00.000Z",
    outcome: "staff_account_retained",
  });
  // Deleted by hand in Supabase before the job ever saw it.
  db.insert("visitor_account_requests", {
    id: "request-by-hand",
    account_id: null,
    kind: "deletion",
    status: "pending",
    attempts: 0,
    started_at: null,
    requested_at: "2026-09-12T01:00:00.000Z",
    outcome: null,
  });

  const result = await run(db);

  assert.equal(result.staffAccountRetained, 1);
  assert.equal(result.alreadyRemoved, 1);
  assert.deepEqual(db.deletedUsers, []);
  assert.equal(request(db, "request-died").status, "completed");
  assert.equal(request(db, "request-died").outcome, "staff_account_retained");
  assert.equal(request(db, "request-by-hand").status, "completed");
  assert.equal(request(db, "request-by-hand").outcome, "account_already_removed");
});

test("a retried run records the People link revocation once", async () => {
  const db = new FakeDatabase();
  const person = seedChurchgoer(db, 1);
  let failures = 1;
  db.failAuthDelete = () =>
    failures-- > 0 ? { status: 503, code: "service_unavailable", message: "later" } : null;

  await run(db);
  assert.equal(request(db, person.requestId).status, "pending");
  await run(db);

  assert.equal(request(db, person.requestId).status, "completed");
  assert.equal(request(db, person.requestId).attempts, 2);
  const revoked = db
    .rows("visitor_people_link_events")
    .filter((event) => event.action === "link_revoked_account_deleted");
  assert.equal(revoked.length, 1);
});

test("a request still inside another run's lease is left to that run", async () => {
  const db = new FakeDatabase();
  const person = seedChurchgoer(db, 1);
  Object.assign(request(db, person.requestId), {
    status: "processing",
    attempts: 1,
    started_at: new Date(NOW.getTime() - 60_000).toISOString(),
  });

  const result = await run(db);

  assert.equal(result.due, 0);
  assert.deepEqual(db.deletedUsers, []);
});

test("a request another run claims first is skipped, not worked twice", async () => {
  const db = new FakeDatabase();
  const person = seedChurchgoer(db, 1);
  let raced = false;
  db.beforeWrite = ({ table, op }) => {
    if (!raced && table === "visitor_account_requests" && op === "update") {
      raced = true;
      Object.assign(request(db, person.requestId), { status: "processing", attempts: 1, started_at: NOW.toISOString() });
    }
  };

  const result = await run(db);

  assert.equal(result.skipped, 1);
  assert.deepEqual(db.deletedUsers, []);
  assert.equal(db.rows("visitor_accounts").length, 1);
});

// ---------------------------------------------------------------------------
// Isolation and bounds
// ---------------------------------------------------------------------------

test("one account that cannot be deleted does not stop the others", async () => {
  const db = new FakeDatabase();
  const stuck = seedChurchgoer(db, 1);
  const fine = seedChurchgoer(db, 2);
  db.failAuthDelete = (id) =>
    id === stuck.userId ? { status: 500, code: "unexpected_failure", message: "db error" } : null;

  const result = await run(db);

  assert.equal(result.authUserDeleted, 1);
  assert.equal(result.retrying, 1);
  assert.deepEqual(db.deletedUsers, [fine.userId]);
  assert.equal(request(db, fine.requestId).status, "completed");

  const retry = request(db, stuck.requestId);
  assert.equal(retry.status, "pending");
  assert.equal(retry.attempts, 1);
  assert.equal(retry.last_error, "auth_delete:unexpected_failure");
  // Nothing of the stuck account was half-deleted.
  assert.equal(db.users.has(stuck.userId), true);
  assert.ok(db.rows("visitor_accounts").some((row) => row.id === stuck.accountId));
});

test("a failure that throws instead of returning an error is contained too", async () => {
  const db = new FakeDatabase();
  const thrower = seedChurchgoer(db, 1);
  const fine = seedChurchgoer(db, 2);
  const client = db.client() as unknown as { auth: { admin: { getUserById: (id: string) => Promise<unknown> } } };
  const original = client.auth.admin.getUserById;
  client.auth.admin.getUserById = async (id) => {
    if (id === thrower.userId) throw new TypeError("fetch failed");
    return original(id);
  };

  const result = await runAccountDeletions({ client: client as never, now: () => NOW, logger: capturingLogger().logger });

  assert.equal(result.retrying, 1);
  assert.deepEqual(db.deletedUsers, [fine.userId]);
  assert.equal(request(db, thrower.requestId).last_error, "unexpected:unknown");
});

test("retries are bounded, and an exhausted request is left for a person", async () => {
  const db = new FakeDatabase();
  const person = seedChurchgoer(db, 1);
  Object.assign(request(db, person.requestId), { attempts: MAX_DELETION_ATTEMPTS - 1 });
  db.failAuthDelete = () => ({ status: 500, code: "unexpected_failure", message: "db error" });
  const { logger, entries } = capturingLogger();

  const result = await run(db, logger);

  assert.equal(result.failed, 1);
  assert.equal(request(db, person.requestId).status, "failed");
  assert.match(entries[0].message, /needs a person/);

  // A failed request is not picked up again on its own.
  const next = await run(db);
  assert.equal(next.due, 0);
});

test("a run is bounded, and takes never-attempted requests before retries", async () => {
  const db = new FakeDatabase();
  const retried = seedChurchgoer(db, 1);
  const fresh = seedChurchgoer(db, 2);
  // Older, but already tried and failed once.
  Object.assign(request(db, retried.requestId), {
    attempts: 1,
    started_at: "2026-09-13T10:00:00.000Z",
    last_error: "auth_delete:unexpected_failure",
  });

  const result = await run(db, capturingLogger().logger, 1);

  assert.equal(result.due, 1);
  assert.deepEqual(db.deletedUsers, [fresh.userId]);
  assert.equal(request(db, retried.requestId).status, "pending");
});


// Durable recurring cancellation after account ownership has been removed.
const JOBS = "giving_recurring_cancellation_jobs";
function seedRecurringGift(db: FakeDatabase) {
  const person = seedChurchgoer(db, 1);
  db.insert("churches", { id: CHURCH, stripe_account_id: "acct_mock" });
  db.insert("giving_subscriptions", { church_id: CHURCH, donor_id: "donor-1", stripe_subscription_id: "sub_mock", status: "active" });
  return person;
}
const cancellationProvider = (cancel: GivingPaymentProvider["cancelSubscription"]) => ({ cancelSubscription: cancel }) as GivingPaymentProvider;
const workCancellations = (db: FakeDatabase, cancel: GivingPaymentProvider["cancelSubscription"]) => runRecurringGiftCancellationWorker({ client: db.client(), provider: cancellationProvider(cancel), now: () => db.clock.getTime() });

test("deletion finishes during a provider outage and its durable cancellation later succeeds", async () => {
  const db = new FakeDatabase();
  const person = seedRecurringGift(db);
  const deletion = await run(db);
  assert.equal(deletion.authUserDeleted, 1);
  assert.equal(db.rows("giving_donor_links").length, 0);
  assert.equal(db.rows("visitor_accounts").length, 0);
  assert.deepEqual(Object.keys(db.rows(JOBS)[0]).sort(), ["attempts", "id", "lease_expires_at", "lease_token", "next_attempt_at", "status", "stripe_account_id", "stripe_subscription_id"].sort());
  assert.equal(db.users.has(person.userId), false);
  assert.equal((await workCancellations(db, async () => false)).retried, 1);
  assert.equal(db.rows(JOBS)[0].status, "pending");
  db.clock = new Date(NOW.getTime() + 3_600_000);
  const calls: string[][] = [];
  assert.equal((await workCancellations(db, async (account, subscription) => { calls.push([account, subscription]); return true; })).completed, 1);
  assert.deepEqual(calls, [["acct_mock", "sub_mock"]]);
  assert.equal(db.rows(JOBS)[0].status, "completed");
  assert.equal((await workCancellations(db, async () => { throw new Error("must not recancel completed job"); })).claimed, 0);
});

for (const table of ["giving_donor_links", "giving_subscriptions", "giving_recurring_attempts", "churches", JOBS]) {
  test(`a ${table} read or enqueue failure preserves account ownership for retry`, async () => {
    const db = new FakeDatabase();
    const person = seedRecurringGift(db);
    db.failOn = (op) => op.table === table ? { code: "08006", message: "private provider payload" } : null;
    assert.equal((await run(db)).retrying, 1);
    assert.equal(db.users.has(person.userId), true);
    assert.equal(db.rows("giving_donor_links").length, 1);
    db.failOn = () => null;
    assert.equal((await run(db)).authUserDeleted, 1);
    assert.equal(db.rows(JOBS).length, 1);
  });
}

test("missing Stripe configuration does not skip durable cancellation handoff", async () => {
  const db = new FakeDatabase();
  seedRecurringGift(db);
  const key = process.env.STRIPE_SECRET_KEY;
  delete process.env.STRIPE_SECRET_KEY;
  try { assert.equal((await run(db)).authUserDeleted, 1); assert.equal(db.rows(JOBS).length, 1); }
  finally { if (key === undefined) delete process.env.STRIPE_SECRET_KEY; else process.env.STRIPE_SECRET_KEY = key; }
});

test("attached recurring attempts are queued even before subscription webhook projection", async () => {
  const db = new FakeDatabase();
  const person = seedRecurringGift(db);
  db.tables.set("giving_subscriptions", []);
  db.insert("giving_recurring_attempts", { account_id: person.accountId, church_id: CHURCH, stripe_subscription_id: "sub_delayed" });
  assert.equal((await run(db)).authUserDeleted, 1);
  assert.equal(db.rows(JOBS)[0].stripe_subscription_id, "sub_delayed");
  assert.equal(db.rows("giving_recurring_attempts").length, 0);
});

for (const field of ["stripe_account_id", "stripe_subscription_id"]) {
  test(`missing or malformed ${field} cannot destroy cancellation ownership`, async () => {
    for (const invalid of [null, "", "wrong-id"]) {
      const db = new FakeDatabase();
      const person = seedRecurringGift(db);
      db.rows(field === "stripe_account_id" ? "churches" : "giving_subscriptions")[0][field] = invalid;
      assert.equal((await run(db)).retrying, 1);
      assert.equal(db.users.has(person.userId), true);
    }
  });
}

test("enqueue replay leaves completed cancellation rows untouched", async () => {
  const db = new FakeDatabase();
  const person = seedRecurringGift(db);
  await enqueueRecurringGiftCancellationsForAccount({ accountId: person.accountId, client: db.client() });
  await workCancellations(db, async () => true);
  const completed = { ...db.rows(JOBS)[0] };
  await enqueueRecurringGiftCancellationsForAccount({ accountId: person.accountId, client: db.client() });
  assert.deepEqual(db.rows(JOBS), [completed]);
});

test("stalled cancellation leases are reclaimed and successful provider work is safe to repeat", async () => {
  const db = new FakeDatabase();
  seedRecurringGift(db);
  await run(db);
  let calls = 0;
  db.failOn = (op) => op.table === JOBS && op.op === "update" ? { code: "08006", message: "private payload" } : null;
  await assert.rejects(workCancellations(db, async () => { calls++; return true; }), /recurring_cancellation_result_failed/);
  assert.equal(db.rows(JOBS)[0].status, "processing");
  db.failOn = () => null;
  assert.equal((await workCancellations(db, async () => { calls++; return true; })).claimed, 0);
  db.clock = new Date(NOW.getTime() + 600_001);
  assert.equal((await workCancellations(db, async () => { calls++; return true; })).completed, 1);
  assert.equal(calls, 2);
});

test("a worker cannot complete a cancellation after its lease is taken by another run", async () => {
  const db = new FakeDatabase();
  seedRecurringGift(db);
  await run(db);
  const result = await workCancellations(db, async () => { db.rows(JOBS)[0].lease_token = "another-worker"; return true; });
  assert.equal(result.leaseLost, 1);
  assert.equal(db.rows(JOBS)[0].status, "processing");
  assert.equal(db.rows(JOBS)[0].lease_token, "another-worker");
});

test("cancellation failures have no terminal attempt cap and never store provider messages", async () => {
  const db = new FakeDatabase();
  seedRecurringGift(db);
  await run(db);
  db.rows(JOBS)[0].attempts = 999;
  const result = await workCancellations(db, async () => { throw new Error("private payload"); });
  assert.equal(result.retried, 1);
  assert.equal(db.rows(JOBS)[0].last_error, "provider_unavailable");
  assert.equal(db.rows(JOBS)[0].next_attempt_at, new Date(NOW.getTime() + 3_600_000).toISOString());
});


test("a cancellation claim database failure does not masquerade as an empty queue", async () => {
  const db = new FakeDatabase();
  seedRecurringGift(db);
  await run(db);
  db.failOn = (op) => op.table === JOBS && op.op === "select" ? { code: "08006", message: "private payload" } : null;
  await assert.rejects(workCancellations(db, async () => true), /recurring_cancellation_claim_failed/);
  assert.equal(db.rows(JOBS)[0].status, "pending");
});

test("an exhausted worker releases untouched jobs without contacting Stripe", async () => {
  const db = new FakeDatabase();
  seedRecurringGift(db);
  await run(db);
  const result = await runRecurringGiftCancellationWorker({ client: db.client(), provider: cancellationProvider(async () => { throw new Error("must not call provider after budget"); }), now: () => db.clock.getTime(), budgetMs: 0 });
  assert.equal(result.retried, 1);
  assert.equal(db.rows(JOBS)[0].status, "pending");
  assert.equal(db.rows(JOBS)[0].last_error, "worker_budget_exhausted");
});

test("all subscription pages are persisted before deletion, including incomplete gifts", async () => {
  const db = new FakeDatabase();
  seedRecurringGift(db);
  db.tables.set("giving_subscriptions", []);
  for (let n = 0; n < 1001; n++) db.insert("giving_subscriptions", { church_id: CHURCH, donor_id: "donor-1", stripe_subscription_id: `sub_mock${n}`, status: n === 1000 ? "incomplete" : "active" });
  assert.equal((await run(db)).authUserDeleted, 1);
  assert.equal(db.rows(JOBS).length, 1001);
});
