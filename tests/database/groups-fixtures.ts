import { randomUUID } from "node:crypto";

/**
 * Shared set-up for the Groups and Messaging database suites.
 *
 * These run only against a database built from the *whole* migration chain
 * (`scripts/run-groups-database-tests.mjs` sets `FAITHFORM_FULL_SCHEMA=1`).
 * The attendance rehearsal also runs every `tests/database/*.test.ts` file
 * against its hand-reduced bootstrap, which lacks what Groups builds on — so
 * without the flag these suites skip rather than fail for a reason that has
 * nothing to do with them.
 */

export const DATABASE_URL = process.env.FAITHFORM_TEST_DATABASE_URL;

export const SKIP_REASON =
  "Groups database suites need a full-chain database: run `pnpm test:groups-database` " +
  "with FAITHFORM_TEST_DATABASE_URL pointing at a disposable Postgres server.";

export const suiteOptions =
  DATABASE_URL && process.env.FAITHFORM_FULL_SCHEMA === "1" ? {} : { skip: SKIP_REASON };

if (/prod|supabase\.co/i.test(DATABASE_URL ?? "")) {
  throw new Error("refusing to run database tests against a production-looking database");
}

export type Client = {
  query: (text: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>;
  end: () => Promise<void>;
};

export async function connect(): Promise<Client> {
  const { Client: PgClient } = await import("pg");
  const client = new PgClient({ connectionString: DATABASE_URL });
  await client.connect();
  return client as unknown as Client;
}

export async function one<T = Record<string, unknown>>(
  client: Client,
  text: string,
  values?: unknown[],
): Promise<T> {
  const { rows } = await client.query(text, values);
  return rows[0] as T;
}

/** A church, torn down with everything it owns when the body finishes. */
export async function withChurch(
  body: (client: Client, church: { id: string; slug: string }) => Promise<void>,
  options: { name?: string } = {},
): Promise<void> {
  const client = await connect();
  const id = randomUUID();
  const slug = `grp-${id.slice(0, 8)}`;
  try {
    await client.query(
      `insert into public.churches (id, name, slug, timezone) values ($1, $2, $3, 'America/New_York')`,
      [id, options.name ?? "Groups Test Church", slug],
    );
    await body(client, { id, slug });
  } finally {
    try {
      await client.query("reset role");
      await client.query(
        `delete from auth.users where id in (
           select a.user_id from public.visitor_accounts a
            where a.id in (select account_id from public.visitor_church_relationships where church_id = $1)
           union
           select user_id from public.church_users where church_id = $1
         )`,
        [id],
      );
      await client.query(`delete from public.churches where id = $1`, [id]);
    } finally {
      await client.end();
    }
  }
}

export async function authUser(client: Client, name?: string): Promise<string> {
  const row = await one<{ id: string }>(
    client,
    `insert into auth.users (email, raw_user_meta_data) values ($1, $2::jsonb) returning id`,
    [`${randomUUID()}@example.test`, JSON.stringify(name ? { display_name: name } : {})],
  );
  return row.id;
}

/** A signed-in app account with a relationship to the church. */
export async function appAccount(
  client: Client,
  churchId: string,
  input: { name?: string | null; state?: string; status?: string } = {},
): Promise<{ accountId: string; userId: string }> {
  const userId = await authUser(client);
  const account = await one<{ id: string }>(
    client,
    `insert into public.visitor_accounts (user_id, display_name, status)
     values ($1, $2, $3) returning id`,
    [userId, input.name === undefined ? `Person ${randomUUID().slice(0, 6)}` : input.name, input.status ?? "active"],
  );
  await client.query(
    `insert into public.visitor_church_relationships (account_id, church_id, state)
     values ($1, $2, $3)`,
    [account.id, churchId, input.state ?? "following"],
  );
  return { accountId: account.id, userId };
}

/** A dashboard staff member. `features` are explicit grants for non-admins. */
export async function staffUser(
  client: Client,
  churchId: string,
  input: { role?: "admin" | "viewer"; features?: string[] } = {},
): Promise<string> {
  const userId = await authUser(client, "Staff Person");
  await client.query(
    `insert into public.church_users (church_id, user_id, role, feature_permissions)
     values ($1, $2, $3, $4)`,
    [churchId, userId, input.role ?? "admin", input.features ?? []],
  );
  return userId;
}

export async function person(
  client: Client,
  churchId: string,
  first: string,
  last: string,
): Promise<string> {
  const row = await one<{ id: string }>(
    client,
    `insert into public.members (church_id, first_name, last_name) values ($1, $2, $3) returning id`,
    [churchId, first, last],
  );
  return row.id;
}

export async function group(
  client: Client,
  churchId: string,
  input: Partial<{
    name: string;
    visibility: string;
    enrollment: string;
    capacity: number | null;
    status: string;
    safetyProfile: string;
  }> = {},
): Promise<string> {
  const archived = input.status === "archived";
  const row = await one<{ id: string }>(
    client,
    `insert into public.groups (church_id, name, visibility, enrollment, capacity, status, archived_at, safety_profile)
     values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
    [
      churchId,
      input.name ?? `Group ${randomUUID().slice(0, 6)}`,
      input.visibility ?? "public",
      input.enrollment ?? "open",
      input.capacity ?? null,
      input.status ?? "active",
      archived ? new Date().toISOString() : null,
      input.safetyProfile ?? "standard",
    ],
  );
  return row.id;
}

export async function join(
  client: Client,
  groupId: string,
  accountId: string,
  tokenHash: string | null = null,
): Promise<{ outcome: string; membership_id: string | null; request_id: string | null }> {
  return one(client, `select * from public.group_join($1, $2, null, $3)`, [groupId, accountId, tokenHash]);
}

/** Acts as a signed-in user for the rest of the transaction. */
export async function actAs(client: Client, userId: string | null): Promise<void> {
  await client.query(`set local role ${userId ? "authenticated" : "anon"}`);
  await client.query(`select set_config('request.jwt.claim.sub', $1, true)`, [userId ?? ""]);
}

/**
 * Runs `body` in a transaction as `userId` and rolls it back, so a denied write
 * cannot leave anything behind and the next test starts clean.
 */
export async function asUser<T>(
  client: Client,
  userId: string | null,
  body: () => Promise<T>,
): Promise<T> {
  await client.query("begin");
  try {
    await actAs(client, userId);
    return await body();
  } finally {
    await client.query("rollback");
  }
}

/** True when the statement is refused by privileges or policy. */
export async function refused(client: Client, text: string, values?: unknown[]): Promise<boolean> {
  await client.query("savepoint probe");
  try {
    const result = await client.query(text, values);
    await client.query("release savepoint probe");
    return (result.rowCount ?? 0) === 0;
  } catch (error) {
    await client.query("rollback to savepoint probe");
    const code = (error as { code?: string }).code;
    return code === "42501" || code === "P0001";
  }
}
