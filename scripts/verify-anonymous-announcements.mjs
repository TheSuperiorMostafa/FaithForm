#!/usr/bin/env node
/** Read-only release gate: anonymous callers must see no announcement rows. */
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

const count = async (table) => {
  const url = new URL(`/rest/v1/${table}?select=id&limit=0`, project);
  const headers = { apikey: key, prefer: "count=exact" };
  if (key.startsWith("eyJ")) headers.authorization = `Bearer ${key}`;
  const response = await fetch(url, { method: "HEAD", headers, signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error(`${table}: HTTP ${response.status}`);
  const match = response.headers.get("content-range")?.match(/\/(\d+)$/);
  if (!match) throw new Error(`${table}: response did not provide an exact count`);
  return Number(match[1]);
};

try {
  const [baseRows, viewRows] = await Promise.all([
    count("announcements"),
    count("announcements_with_status"),
  ]);
  console.log(`Anonymous rows: announcements=${baseRows}, announcements_with_status=${viewRows}`);
  if (baseRows !== 0 || viewRows !== 0) {
    console.error("FAIL: anonymous callers can see announcement rows.");
    process.exitCode = 1;
  } else {
    console.log("PASS: anonymous callers see no announcement rows.");
  }
} catch (error) {
  console.error(`Could not verify anonymous announcement access: ${error.message}`);
  process.exitCode = 1;
}
