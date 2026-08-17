#!/usr/bin/env node
/**
 * Reports which migrations have actually reached the database.
 *
 * Migrations here are applied by hand, one bespoke script at a time, so a
 * database can sit several behind without anything saying so. The symptom
 * surfaces much later and somewhere unrelated — "Could not find the table
 * 'public.church_features' in the schema cache" when a platform admin toggles a
 * feature, months after 0041 was skipped.
 *
 * Each migration is identified by one object it creates. Present means applied.
 *
 * Usage:
 *   DATABASE_URL="postgresql://..." pnpm db:check
 */
import { readFileSync, existsSync } from "node:fs";
import pg from "pg";

const { Client } = pg;

function loadEnvFile(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    if (process.env[key]) continue;
    process.env[key] = trimmed
      .slice(eq + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
  }
}

loadEnvFile(".env.local");

/**
 * migration -> a table (or table.column) it introduces, and the command that
 * applies it. Only migrations with their own runner are listed; the early
 * schema ones are assumed present if anything works at all.
 */
const CHECKS = [
  ["0006_sermon_builder", "sermons", "pnpm db:sermon"],
  ["0013_stripe_giving", "donations", "pnpm db:stripe"],
  ["0015_onboarding", "churches.onboarding_completed_at", "pnpm db:onboarding"],
  ["0021_slide_themes", "slide_themes", "pnpm import:themes"],
  ["0022_bible_text_storage", "bible_verses", "pnpm db:bible-text"],
  ["0023_social_assets", "social_assets", "pnpm db:social-assets"],
  ["0028_api_rate_limits", "api_rate_limits", "pnpm db:rate-limits"],
  ["0030_stream_relay", "stream_relay_settings", "pnpm db:stream-relay"],
  [
    "0031_youtube_live_integration",
    "stream_events.youtube_broadcast_id",
    "pnpm db:youtube-live",
  ],
  ["0032_stream_production", "stream_sessions", "pnpm db:stream-production"],
  ["0034_stream_recordings", "stream_recordings", "pnpm db:stream-production"],
  [
    "0041_team_access_and_feature_flags",
    "church_features",
    "pnpm db:team-access",
  ],
  ["0042_church_sites", "site_domains", "pnpm db:church-sites"],
  [
    "0043_attendance_follow_up_access",
    "church_users.feature_permissions",
    "pnpm db:attendance-follow-up",
  ],
  ["0044_site_domain_requests", "site_domain_requests", "pnpm db:domains"],
  ["0045_church_slide_themes", "slide_themes.church_id", "pnpm db:church-themes"],
  [
    "0046_attendance_follow_up_log",
    "attendance_follow_up_log",
    "pnpm db:follow-up-log",
  ],
  ["0047_media_library", "media_views", "pnpm db:media-library"],
  [
    "0048_announcement_email_queue",
    "announcement_email_queue",
    "pnpm db:email-queue",
  ],
  [
    "0049_feature_disabled_reason",
    "church_features.disabled_reason",
    "pnpm db:feature-reason",
  ],
];

const databaseUrl = process.env.DATABASE_URL ?? process.env.SUPABASE_DB_URL;

if (!databaseUrl) {
  console.error(
    "Missing DATABASE_URL. Set the Supabase Postgres URI from Dashboard → Settings → Database.",
  );
  process.exit(1);
}

const client = new Client({
  connectionString: databaseUrl,
  ssl: { rejectUnauthorized: false },
});

async function exists(target) {
  const [table, column] = target.split(".");

  if (column) {
    const { rows } = await client.query(
      `select 1
         from information_schema.columns
        where table_schema = 'public'
          and table_name = $1
          and column_name = $2
        limit 1`,
      [table, column],
    );
    return rows.length > 0;
  }

  const { rows } = await client.query(
    `select 1
       from information_schema.tables
      where table_schema = 'public'
        and table_name = $1
      limit 1`,
    [table],
  );
  return rows.length > 0;
}

try {
  await client.connect();

  const missing = [];

  for (const [migration, target, command] of CHECKS) {
    const applied = await exists(target);
    console.log(`${applied ? "✓" : "✗"} ${migration}  (${target})`);
    if (!applied) missing.push({ migration, command });
  }

  if (missing.length === 0) {
    console.log("\nEvery tracked migration is applied.");
  } else {
    console.log(`\n${missing.length} migration(s) not applied. Run, in order:\n`);
    // Dedupe: some runners cover more than one migration.
    const commands = [...new Set(missing.map((m) => m.command))];
    console.log(`  ${commands.join(" && \\\n  ")}\n`);
    process.exitCode = 1;
  }
} catch (err) {
  console.error("Check failed:", err.message ?? err);
  process.exit(1);
} finally {
  await client.end();
}
