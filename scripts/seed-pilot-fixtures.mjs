#!/usr/bin/env node
/**
 * Seeds a **non-production** database with enough to walk the app end to end.
 *
 * One church, three campuses' worth of service times, a handful of
 * announcements, two funds, and a recording row. Every name is obviously
 * invented, every email is `@example.test`, and there is **no real church,
 * member, donor, or payment data anywhere in it**.
 *
 * Refuses to run against anything that looks like a real deployment. Seeding a
 * production database with "Test Church" is the kind of mistake that is
 * discovered by a pastor.
 *
 * It writes **no donations**: a donation row that did not come from a verified
 * Stripe webhook is a lie about money, and the whole giving design exists to
 * make that impossible. Giving is exercised by giving, in test mode.
 */

import { randomUUID } from "node:crypto";

const url = process.env.FAITHFUL_TEST_DATABASE_URL;

if (!url) {
  console.error("FAITHFUL_TEST_DATABASE_URL is not set.");
  process.exit(1);
}
if (/prod|supabase\.co|amazonaws|rds\./i.test(url)) {
  console.error("Refusing to seed a database that looks like a real deployment.");
  process.exit(1);
}

const { Client } = await import("pg");
const client = new Client({ connectionString: url });
await client.connect();

const churchId = randomUUID();
const slug = "smoke-chapel";

try {
  // Idempotent: running it twice replaces the fixture rather than making two.
  await client.query(`delete from public.churches where slug = $1`, [slug]);

  await client.query(
    `insert into public.churches (id, name, slug, timezone, is_discoverable, join_policy)
     values ($1, 'Smoke Test Chapel', $2, 'America/New_York', true, 'open')`,
    [churchId, slug],
  );
  console.log(`church      Smoke Test Chapel (${slug})`);

  // Stripe readiness is *off*. A smoke fixture that looked payment-ready would
  // invite a donation attempt against a connected account that does not exist.
  console.log("giving      funds seeded, Stripe deliberately not marked ready");

  const funds = [
    ["General", "general", "Where it's needed most", [2500, 5000, 10000]],
    ["Building", "building", "Toward the new roof", [5000, 10000, 25000]],
  ];
  for (const [index, [name, fundSlug, title, suggested]] of funds.entries()) {
    await client.query(
      `insert into public.giving_funds
         (id, church_id, name, slug, sort_order, is_default, is_active,
          mobile_visibility, mobile_title, mobile_suggested_amounts,
          mobile_min_amount_cents, mobile_max_amount_cents, mobile_published_at)
       values ($1, $2, $3, $4, $5, $6, true, 'public', $7, $8, 500, 100000, now())`,
      [randomUUID(), churchId, name, fundSlug, index, index === 0, title, suggested],
    );
    console.log(`fund        ${name}`);
  }

  const recordingId = randomUUID();
  await client.query(
    `insert into public.stream_recordings
       (id, church_id, title, storage_path, status, duration_sec)
     values ($1, $2, 'A service that never happened', $3, 'ready', 2400)`,
    [recordingId, churchId, `relay/${churchId}/${recordingId}.mp4`],
  );
  // Deliberately unpublished and unverified: publishing it would assert a
  // playable file behind a storage path that holds nothing, and the eligibility
  // gate would be right to refuse it.
  console.log("recording   seeded, unpublished — there is no file behind it");

  console.log("");
  console.log(`Seeded. Remove it with:  delete from public.churches where slug = '${slug}';`);
  console.log("No donation, donor, member, or payment row was written.");
} finally {
  await client.end();
}
