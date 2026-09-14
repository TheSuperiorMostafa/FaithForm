import assert from "node:assert/strict";
import test from "node:test";

import { ensureVisitorAccount } from "@/lib/faithform/account";
import {
  VISITOR_DISPLAY_NAME_MAX_LENGTH,
  sanitizeDisplayName,
  visitorProfileSchema,
} from "@/lib/faithform/schemas";
import { updateProfileRequestSchema } from "@/lib/mobile/v1/contract";

/**
 * The name typed at sign-up survives email confirmation.
 *
 * With confirmation on, sign-up returns no session, so the apps cannot send
 * the name as a profile update. They send it as Auth user metadata instead,
 * and the visitor row takes it when it is created. These tests run
 * `ensureVisitorAccount` against an in-memory admin client that answers only
 * the calls it makes.
 */

type Row = Record<string, unknown>;
type UserResult =
  | { data: { user: { id: string; user_metadata?: Record<string, unknown> } | null }; error: unknown }
  | Error;

class FakeAdmin {
  rows: Row[] = [];
  inserts: Row[] = [];
  userLookups: string[] = [];

  constructor(private readonly user: (id: string) => UserResult) {}

  client(): never {
    return {
      from: (table: string) => {
        assert.equal(table, "visitor_accounts");
        return new FakeQuery(this);
      },
      auth: {
        admin: {
          getUserById: async (id: string) => {
            this.userLookups.push(id);
            const result = this.user(id);
            if (result instanceof Error) throw result;
            return result;
          },
        },
      },
    } as never;
  }
}

class FakeQuery implements PromiseLike<{ data: Row | null; error: null }> {
  private values: Row | null = null;
  private patch: Row | null = null;
  private userId: unknown;

  constructor(private readonly db: FakeAdmin) {}

  select() {
    return this;
  }
  insert(values: Row) {
    this.values = values;
    return this;
  }
  update(values: Row) {
    this.patch = values;
    return this;
  }
  eq(column: string, value: unknown) {
    assert.equal(column, "user_id");
    this.userId = value;
    return this;
  }
  maybeSingle() {
    return this;
  }

  then<A = { data: Row | null; error: null }, B = never>(
    onFulfilled?: ((value: { data: Row | null; error: null }) => A | PromiseLike<A>) | null,
    onRejected?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    return Promise.resolve()
      .then(() => this.execute())
      .then(onFulfilled, onRejected);
  }

  private execute(): { data: Row | null; error: null } {
    if (this.values) {
      const row: Row = {
        id: `account-${this.db.rows.length + 1}`,
        status: "active",
        communication_prefs: {},
        authorization_version: 1,
        ...this.values,
      };
      this.db.inserts.push(this.values);
      this.db.rows.push(row);
      return { data: row, error: null };
    }
    if (this.patch) {
      const row = this.db.rows.find((candidate) => candidate.user_id === this.userId);
      if (!row) return { data: null, error: null };
      Object.assign(row, this.patch);
      return { data: row, error: null };
    }
    return {
      data: this.db.rows.find((row) => row.user_id === this.userId) ?? null,
      error: null,
    };
  }
}

const USER_ID = "00000000-0000-4000-8000-000000000001";

function withMetadata(metadata: Record<string, unknown> | undefined): FakeAdmin {
  return new FakeAdmin((id) => ({
    data: { user: { id, user_metadata: metadata } },
    error: null,
  }));
}

test("a new account takes the name given at sign-up", async () => {
  const admin = withMetadata({ display_name: "  Sarah Okafor  " });

  const account = await ensureVisitorAccount(USER_ID, undefined, admin.client());

  assert.equal(account.displayName, "Sarah Okafor");
  assert.equal(admin.inserts[0]?.display_name, "Sarah Okafor");
  assert.deepEqual(admin.userLookups, [USER_ID]);
});

test("a name the caller supplies wins, and Auth is not asked", async () => {
  const admin = withMetadata({ display_name: "From Metadata" });

  const account = await ensureVisitorAccount(
    USER_ID,
    { displayName: "From Caller" },
    admin.client(),
  );

  assert.equal(account.displayName, "From Caller");
  assert.deepEqual(admin.userLookups, []);
});

test("a blank name from the caller still falls back to the sign-up name", async () => {
  const admin = withMetadata({ display_name: "Sarah" });

  const account = await ensureVisitorAccount(USER_ID, { displayName: "   " }, admin.client());

  assert.equal(account.displayName, "Sarah");
});

test("an existing named account is returned without asking Auth anything", async () => {
  const admin = withMetadata({ display_name: "Someone Else" });
  admin.rows.push({
    id: "account-1",
    user_id: USER_ID,
    display_name: "Already Set",
    status: "active",
  });

  const account = await ensureVisitorAccount(USER_ID, undefined, admin.client());

  assert.equal(account.displayName, "Already Set");
  assert.deepEqual(admin.userLookups, []);
  assert.deepEqual(admin.inserts, []);
});

test("an existing account with no name is healed from Auth metadata", async () => {
  const admin = withMetadata({ display_name: "  Sarah Okafor  " });
  admin.rows.push({
    id: "account-1",
    user_id: USER_ID,
    display_name: null,
    status: "active",
  });

  const account = await ensureVisitorAccount(USER_ID, undefined, admin.client());

  assert.equal(account.displayName, "Sarah Okafor");
  assert.deepEqual(admin.userLookups, [USER_ID]);
  assert.deepEqual(admin.inserts, []);
  assert.equal(admin.rows[0]?.display_name, "Sarah Okafor");
});

test("an existing nameless account stays empty when Auth has no name either", async () => {
  const admin = withMetadata(undefined);
  admin.rows.push({
    id: "account-1",
    user_id: USER_ID,
    display_name: null,
    status: "active",
  });

  const account = await ensureVisitorAccount(USER_ID, undefined, admin.client());

  assert.equal(account.displayName, null);
  assert.deepEqual(admin.userLookups, [USER_ID]);
  assert.deepEqual(admin.inserts, []);
});

test("no usable sign-up name leaves the display name empty", async () => {
  const cases: [string, FakeAdmin][] = [
    ["no metadata", withMetadata(undefined)],
    ["no name in metadata", withMetadata({ locale: "en" })],
    ["a blank name", withMetadata({ display_name: " \n\t " })],
    ["a name that is not text", withMetadata({ display_name: { first: "Sarah" } })],
    ["a number", withMetadata({ display_name: 42 })],
    [
      "an Auth error",
      new FakeAdmin(() => ({ data: { user: null }, error: { status: 404, message: "gone" } })),
    ],
    ["an Auth outage", new FakeAdmin(() => new Error("fetch failed"))],
  ];

  for (const [label, admin] of cases) {
    const account = await ensureVisitorAccount(USER_ID, undefined, admin.client());
    assert.equal(account.displayName, null, label);
    assert.equal(admin.inserts.length, 1, `${label}: the account is still created`);
    assert.equal(admin.inserts[0]?.display_name, null, label);
  }
});

test("an overlong sign-up name is clamped to what the profile allows", async () => {
  const admin = withMetadata({ display_name: "A".repeat(500) });

  const account = await ensureVisitorAccount(USER_ID, undefined, admin.client());

  assert.equal(account.displayName, "A".repeat(VISITOR_DISPLAY_NAME_MAX_LENGTH));
});

test("the sanitizer trims, clamps and empties to null", () => {
  assert.equal(sanitizeDisplayName("  Sarah  "), "Sarah");
  assert.equal(sanitizeDisplayName(""), null);
  assert.equal(sanitizeDisplayName("   "), null);
  assert.equal(sanitizeDisplayName(null), null);
  assert.equal(sanitizeDisplayName(undefined), null);
  assert.equal(sanitizeDisplayName(["Sarah"]), null);

  // A clamp that lands on a space does not leave it trailing.
  const spaced = `${"a".repeat(VISITOR_DISPLAY_NAME_MAX_LENGTH - 1)} b`;
  assert.equal(sanitizeDisplayName(spaced), "a".repeat(VISITOR_DISPLAY_NAME_MAX_LENGTH - 1));

  // A clamp that lands inside an emoji drops the half rather than keeping it.
  const emoji = `${"a".repeat(VISITOR_DISPLAY_NAME_MAX_LENGTH - 1)}\u{1F600}`;
  const clamped = sanitizeDisplayName(emoji);
  assert.equal(clamped, "a".repeat(VISITOR_DISPLAY_NAME_MAX_LENGTH - 1));
  assert.ok(!/[\uD800-\uDBFF]$/.test(clamped ?? ""));
});

test("whatever the sanitizer keeps, both profile schemas accept", () => {
  for (const input of [
    "Sarah",
    "  Sarah Okafor ",
    "x".repeat(1000),
    `${"a".repeat(VISITOR_DISPLAY_NAME_MAX_LENGTH - 1)}\u{1F600}`,
  ]) {
    const name = sanitizeDisplayName(input);
    assert.ok(name, input);
    assert.ok(visitorProfileSchema.safeParse({ displayName: name }).success, input);
    assert.ok(updateProfileRequestSchema.safeParse({ displayName: name }).success, input);
  }

  // And the maximum is the schemas' own: one more is refused by both.
  const tooLong = "x".repeat(VISITOR_DISPLAY_NAME_MAX_LENGTH + 1);
  assert.equal(visitorProfileSchema.safeParse({ displayName: tooLong }).success, false);
  assert.equal(updateProfileRequestSchema.safeParse({ displayName: tooLong }).success, false);
});
