#!/usr/bin/env node
/** Read-only release gate: anonymous callers must see no private rows. */
const rawUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
if (!rawUrl || !key) {
  console.error("Set NEXT_PUBLIC_SUPABASE_URL and a public Supabase key.");
  process.exit(1);
}
const project = new URL(rawUrl);
if (project.protocol !== "https:" || !/^[a-z0-9-]+\.supabase\.(co|in)$/i.test(project.hostname)) {
  console.error("Refusing to send the public key to a non-Supabase URL.");
  process.exit(1);
}

const privateTables = [
  "members",
  "households",
  "member_files",
  "giving_donations",
  "giving_donors",
  "phone_calls",
  "stream_recordings",
  "church_users",
  "church_integrations",
  "donor_portal_sessions",
  "checkin_sessions",
  "announcements",
  "announcements_with_status",
];

const count = async (table) => {
  const url = new URL(`/rest/v1/${table}?select=id&limit=0`, project);
  const headers = { apikey: key, prefer: "count=exact" };
  if (key.startsWith("eyJ")) headers.authorization = `Bearer ${key}`;
  const response = await fetch(url, { method: "HEAD", headers, signal: AbortSignal.timeout(10000) });
  // Some private tables have no anonymous SELECT grant at all. A denial is
  // stronger than an empty RLS result and is a successful access check.
  if (response.status === 401 || response.status === 403) return "denied";
  if (!response.ok) throw new Error(`${table}: HTTP ${response.status}`);
  const match = response.headers.get("content-range")?.match(/\/(\d+)$/);
  if (!match) throw new Error(`${table}: response did not provide an exact count`);
  return Number(match[1]);
};

try {
  let exposed = false;
  // Sequential requests keep the check gentle on a live church database.
  for (const table of privateTables) {
    const rows = await count(table);
    console.log(`${table}: ${rows === "denied" ? "denied" : `anonymous rows=${rows}`}`);
    if (rows !== "denied" && rows !== 0) exposed = true;
  }
  if (exposed) {
    console.error("FAIL: anonymous callers can see private rows.");
    process.exitCode = 1;
  } else console.log("PASS: anonymous callers see no private rows.");
} catch (error) {
  console.error(`Could not verify anonymous private-data access: ${error.message}`);
  process.exitCode = 1;
}
