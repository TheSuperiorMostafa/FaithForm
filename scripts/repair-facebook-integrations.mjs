#!/usr/bin/env node
/**
 * Audits Facebook integrations connected before long-lived tokens landed.
 *
 * Those rows hold a Page token derived from a *short-lived* user token, so the
 * token dies about an hour after connecting and the row has no user token to
 * re-derive from. Nothing can heal them automatically — a long-lived token can
 * only come from the admin re-authorizing — but leaving them alone is worse
 * than useless: the status RPC reports "Connected" (the access_token column is
 * non-empty) right up until a post fails.
 *
 * So this flags the dead ones as needing reconnect, which is what makes the
 * Settings tab show "Reconnect needed" with a reason instead of a false green
 * light. Still-live tokens are reported but left running until they lapse.
 *
 * Usage:
 *   DATABASE_URL="postgresql://..." node scripts/repair-facebook-integrations.mjs
 *   DATABASE_URL="postgresql://..." node scripts/repair-facebook-integrations.mjs --apply
 *
 * Runs as a dry run unless --apply is passed.
 */
import pg from "pg";

const { Client } = pg;
const GRAPH = "https://graph.facebook.com/v21.0";
const RECONNECT_REASON =
  "Facebook access expired. Reconnect Facebook in Settings.";

const apply = process.argv.includes("--apply");
const databaseUrl = process.env.DATABASE_URL ?? process.env.SUPABASE_DB_URL;

if (!databaseUrl) {
  console.error(
    "Missing DATABASE_URL. Set the Supabase Postgres URI from Dashboard → Settings → Database.",
  );
  process.exit(1);
}

/** Resolves to true only on a definite answer, so network blips are not fatal. */
async function probePageToken(token) {
  try {
    const res = await fetch(
      `${GRAPH}/me?fields=id,name&access_token=${encodeURIComponent(token)}`,
    );
    const body = await res.json().catch(() => ({}));
    if (res.ok && body.id) return { alive: true };
    return {
      alive: false,
      detail: body.error?.message ?? `HTTP ${res.status}`,
    };
  } catch (err) {
    return { alive: null, detail: err.message ?? String(err) };
  }
}

const client = new Client({
  connectionString: databaseUrl,
  ssl: { rejectUnauthorized: false },
});

try {
  await client.connect();

  // Only rows missing a long-lived user token — anything reconnected since the
  // fix stores one in refresh_token and is left untouched.
  const { rows } = await client.query(`
    select ci.church_id,
           coalesce(c.name, ci.church_id::text) as church_name,
           ci.access_token,
           ci.metadata
      from public.church_integrations ci
      left join public.churches c on c.id = ci.church_id
     where ci.provider = 'facebook'
       and coalesce(ci.refresh_token, '') = ''
     order by church_name
  `);

  if (rows.length === 0) {
    console.log("No legacy Facebook connections found. Nothing to do.");
    process.exit(0);
  }

  console.log(
    `Found ${rows.length} Facebook connection(s) without a long-lived user token.\n`,
  );

  const dead = [];
  const alive = [];
  const unknown = [];

  for (const row of rows) {
    const token = (row.access_token ?? "").trim();

    if (!token) {
      dead.push({ ...row, detail: "no access token stored" });
      continue;
    }

    const probe = await probePageToken(token);
    if (probe.alive === true) alive.push(row);
    else if (probe.alive === false) dead.push({ ...row, detail: probe.detail });
    else unknown.push({ ...row, detail: probe.detail });
  }

  for (const row of dead) {
    console.log(`  DEAD    ${row.church_name} — ${row.detail}`);
  }
  for (const row of alive) {
    console.log(
      `  LIVE    ${row.church_name} — works for now, but expires within the hour`,
    );
  }
  for (const row of unknown) {
    console.log(`  UNKNOWN ${row.church_name} — could not reach Graph API: ${row.detail}`);
  }

  if (!apply) {
    console.log(
      `\nDry run. Re-run with --apply to flag the ${dead.length} dead connection(s) for reconnect.`,
    );
    process.exit(0);
  }

  if (dead.length > 0) {
    // Mirrors markIntegrationNeedsReconnect: clear the access token so the
    // status RPC reports disconnected, keep metadata so the Page id survives.
    await client.query(
      `
      update public.church_integrations
         set access_token = '',
             metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
               'needs_reconnect', true,
               'reconnect_reason', $2::text,
               -- Matches JavaScript's toISOString, which is what the app writes.
               'disconnected_at',
                 to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
             )
       where provider = 'facebook'
         and church_id = any($1::uuid[])
      `,
      [dead.map((r) => r.church_id), RECONNECT_REASON],
    );
    console.log(`\nFlagged ${dead.length} connection(s) as needing reconnect.`);
  }

  console.log(
    [
      "",
      "Every church listed above must reconnect Facebook once, from",
      "Settings → Integrations. After that the connection persists:",
      "new connects store a long-lived user token and re-derive Page",
      "tokens on their own.",
    ].join("\n"),
  );
} catch (err) {
  console.error("Repair failed:", err.message ?? err);
  process.exit(1);
} finally {
  await client.end();
}
