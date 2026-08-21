#!/usr/bin/env node
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";

const safeTargets = new Set(["disposable", "nonproduction"]);
const target = process.env.FAITHFORM_DB_TARGET;
const databaseUrl = process.env.DATABASE_URL;

if (!safeTargets.has(target ?? "") || !databaseUrl) {
  console.error(
    "Set DATABASE_URL and FAITHFORM_DB_TARGET=disposable or nonproduction to run database security tests.",
  );
  process.exit(1);
}

function createDbClient() {
  return new pg.Client({
    connectionString: databaseUrl,
    ssl: databaseUrl.includes("localhost")
      ? false
      : { rejectUnauthorized: false },
  });
}

const client = createDbClient();

const ids = {
  user: "10000000-0000-4000-8000-000000000001",
  revokedUser: "10000000-0000-4000-8000-000000000002",
  church: "20000000-0000-4000-8000-000000000001",
  otherChurch: "20000000-0000-4000-8000-000000000002",
  donor: "30000000-0000-4000-8000-000000000001",
  portal: "40000000-0000-4000-8000-000000000001",
};

async function setRole(role, userId = null) {
  await client.query(`set local role ${role}`);
  await client.query("select set_config('request.jwt.claim.sub', $1, true)", [
    userId ?? "",
  ]);
}

async function resetRole() {
  await client.query("reset role");
  await client.query("select set_config('request.jwt.claim.sub', '', true)");
}

async function expectDenied(name, operation) {
  await client.query(`savepoint ${name}`);
  let denied = false;
  try {
    const result = await operation();
    denied = result?.rowCount === 0;
  } catch (error) {
    denied = error?.code === "42501" || error?.code === "P0001";
    await client.query(`rollback to savepoint ${name}`);
  }
  if (!denied) await client.query(`rollback to savepoint ${name}`);
  await client.query(`release savepoint ${name}`);
  assert.equal(denied, true, `${name} should be denied`);
}

async function verifyConcurrentClaims() {
  const setup = createDbClient();
  const first = createDbClient();
  const second = createDbClient();
  const churchId = randomUUID();
  const donorId = randomUUID();
  const sessionId = randomUUID();
  const suffix = randomUUID();
  const slug = `p2-race-${suffix}`;
  const tokenHash = `p2-race-token-${suffix}`;
  const rateKey = `p2-race-rate-${suffix}`;

  await setup.connect();
  try {
    await setup.query("begin");
    await setup.query(
      "insert into public.churches(id, name, slug) values ($1, 'P2 Concurrent Test', $2)",
      [churchId, slug],
    );
    await setup.query(
      "insert into public.giving_donors(id, church_id, email, name) values ($1, $2, $3, 'Concurrent Test Donor')",
      [donorId, churchId, `${suffix}@invalid.test`],
    );
    await setup.query(
      "insert into public.donor_portal_sessions(id, church_id, donor_id, token_hash, expires_at) values ($1, $2, $3, $4, now() + interval '30 minutes')",
      [sessionId, churchId, donorId, tokenHash],
    );
    await setup.query("commit");

    await Promise.all([first.connect(), second.connect()]);
    await Promise.all([
      first.query("set role service_role"),
      second.query("set role service_role"),
    ]);

    const consumeSql =
      "select * from public.consume_donor_portal_token($1, $2, now() + interval '7 days')";
    const [firstConsume, secondConsume] = await Promise.all([
      first.query(consumeSql, [tokenHash, slug]),
      second.query(consumeSql, [tokenHash, slug]),
    ]);
    assert.equal(
      firstConsume.rowCount + secondConsume.rowCount,
      1,
      "exactly one concurrent portal-token consumer must win",
    );

    const limitSql =
      "select allowed from public.consume_api_rate_limit($1, 1, 60)";
    const [firstLimit, secondLimit] = await Promise.all([
      first.query(limitSql, [rateKey]),
      second.query(limitSql, [rateKey]),
    ]);
    assert.deepEqual(
      [firstLimit.rows[0]?.allowed, secondLimit.rows[0]?.allowed].sort(),
      [false, true],
    );
  } finally {
    await Promise.allSettled([first.end(), second.end()]);
    try {
      await setup.query("delete from public.api_rate_limits where rate_key = $1", [
        rateKey,
      ]);
      await setup.query("delete from public.churches where id = $1", [churchId]);
    } finally {
      await setup.end();
    }
  }
}

try {
  await client.connect();
  await client.query("begin");

  await client.query(
    `insert into auth.users(
       instance_id, id, aud, role, email, encrypted_password,
       email_confirmed_at, created_at, updated_at,
       confirmation_token, recovery_token, email_change_token_new, email_change
     ) values
       ('00000000-0000-0000-0000-000000000000', $1, 'authenticated', 'authenticated', 'p2-user@invalid.test', '', now(), now(), now(), '', '', '', ''),
       ('00000000-0000-0000-0000-000000000000', $2, 'authenticated', 'authenticated', 'p2-revoked@invalid.test', '', now(), now(), now(), '', '', '', '')`,
    [ids.user, ids.revokedUser],
  );
  await client.query(
    "insert into public.churches(id, name, slug) values ($1, 'P2 Church', 'p2-church'), ($2, 'P2 Other', 'p2-other')",
    [ids.church, ids.otherChurch],
  );
  await client.query(
    "insert into public.church_users(church_id, user_id, role) values ($1, $2, 'admin'), ($1, $3, 'admin')",
    [ids.church, ids.user, ids.revokedUser],
  );
  await client.query(
    "insert into storage.buckets(id, name, public) values ('church-logos', 'church-logos', true), ('church-covers', 'church-covers', true), ('social-graphics', 'social-graphics', true) on conflict (id) do nothing",
  );
  await client.query(
    "insert into storage.objects(bucket_id, name) values ('church-logos', $1)",
    [`${ids.otherChurch}/other.png`],
  );
  await client.query(
    "insert into public.church_integrations(church_id, provider, access_token, metadata) values ($1, 'google', 'fixture-never-logged', '{\"email\":\"display@invalid.test\"}'::jsonb)",
    [ids.church],
  );
  await client.query(
    "insert into public.giving_donors(id, church_id, email, name) values ($1, $2, 'donor@invalid.test', 'Test Donor')",
    [ids.donor, ids.church],
  );
  await client.query(
    "insert into public.donor_portal_sessions(id, church_id, donor_id, token_hash, expires_at) values ($1, $2, $3, 'fixture-token-hash', now() + interval '30 minutes')",
    [ids.portal, ids.church, ids.donor],
  );

  await setRole("authenticated", ids.user);
  const ownInsert = await client.query(
    "insert into storage.objects(bucket_id, name) values ('church-logos', $1) returning name",
    [`${ids.church}/own.png`],
  );
  assert.equal(ownInsert.rowCount, 1);
  await expectDenied("other_insert", () =>
    client.query(
      "insert into storage.objects(bucket_id, name) values ('church-logos', $1)",
      [`${ids.otherChurch}/blocked.png`],
    ),
  );
  await expectDenied("other_update", () =>
    client.query(
      "update storage.objects set name = $1 where bucket_id = 'church-logos' and name = $2",
      [`${ids.otherChurch}/changed.png`, `${ids.otherChurch}/other.png`],
    ),
  );
  await expectDenied("other_delete", () =>
    client.query(
      "delete from storage.objects where bucket_id = 'church-logos' and name = $1",
      [`${ids.otherChurch}/other.png`],
    ),
  );
  await expectDenied("browser_token_table", () =>
    client.query("select access_token from public.church_integrations"),
  );
  await expectDenied("browser_token_rpc", () =>
    client.query(
      "select * from public.get_church_integration_tokens($1, 'google')",
      [ids.church],
    ),
  );
  const ownStatus = await client.query(
    "select provider, metadata from public.get_church_integration_status($1)",
    [ids.church],
  );
  assert.equal(ownStatus.rowCount, 1);
  assert.equal(JSON.stringify(ownStatus.rows).includes("fixture-never-logged"), false);
  const otherStatus = await client.query(
    "select provider from public.get_church_integration_status($1)",
    [ids.otherChurch],
  );
  assert.equal(otherStatus.rowCount, 0);
  await resetRole();

  await setRole("anon");
  await expectDenied("anonymous_insert", () =>
    client.query(
      "insert into storage.objects(bucket_id, name) values ('church-logos', $1)",
      [`${ids.church}/anonymous.png`],
    ),
  );
  const publicRead = await client.query(
    "select name from storage.objects where bucket_id = 'church-logos' and name = $1",
    [`${ids.otherChurch}/other.png`],
  );
  assert.equal(publicRead.rowCount, 1);
  await resetRole();

  await client.query("delete from public.church_users where user_id = $1", [
    ids.revokedUser,
  ]);
  await setRole("authenticated", ids.revokedUser);
  await expectDenied("revoked_insert", () =>
    client.query(
      "insert into storage.objects(bucket_id, name) values ('church-logos', $1)",
      [`${ids.church}/revoked.png`],
    ),
  );
  await resetRole();

  await setRole("service_role");
  const workerRead = await client.query(
    "select access_token from public.church_integrations where church_id = $1",
    [ids.church],
  );
  assert.equal(workerRead.rowCount, 1);
  const firstConsume = await client.query(
    "select * from public.consume_donor_portal_token('fixture-token-hash', 'p2-church', now() + interval '7 days')",
  );
  const replayConsume = await client.query(
    "select * from public.consume_donor_portal_token('fixture-token-hash', 'p2-church', now() + interval '7 days')",
  );
  assert.equal(firstConsume.rowCount, 1);
  assert.equal(replayConsume.rowCount, 0);

  const limiterResults = [];
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const result = await client.query(
      "select allowed from public.consume_api_rate_limit('p2-test-key', 5, 60)",
    );
    limiterResults.push(result.rows[0]?.allowed);
  }
  assert.deepEqual(limiterResults, [true, true, true, true, true, false]);
  await resetRole();

  await client.query("rollback");
  await verifyConcurrentClaims();
  console.log(
    "Database security tests passed for own tenant, other tenant, anonymous, revoked, replay, concurrent claims, limiter, and worker access.",
  );
} catch (error) {
  try {
    await client.query("rollback");
  } catch {
    // Connection may have failed before the transaction started.
  }
  console.error(`Database security tests failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  await client.end();
}
