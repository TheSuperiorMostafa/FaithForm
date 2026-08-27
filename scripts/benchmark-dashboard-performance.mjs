#!/usr/bin/env node

/**
 * Read-only latency comparison for the dashboard query shapes changed in 0064.
 * It prints timings and row counts only — never tenant ids, user ids, names,
 * emails, donation amounts, or integration metadata.
 */
import { createClient } from "@supabase/supabase-js";

try {
  process.loadEnvFile?.(".env.local");
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error("Missing Supabase URL or server key; dashboard benchmark skipped.");
  process.exit(1);
}

const db = createClient(url, key, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function assertOk(result, label) {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return result.data ?? [];
}

async function sample(label, operation, count = 5) {
  await operation(); // warm TLS, DNS, and the database page cache
  const samples = [];
  let rows = 0;
  for (let index = 0; index < count; index += 1) {
    const start = performance.now();
    rows = await operation();
    samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);
  const median = samples[Math.floor(samples.length / 2)];
  console.log(`${label}: ${median.toFixed(1)} ms median (${rows} rows)`);
}

const links = assertOk(
  await db
    .from("church_users")
    .select("user_id, church_id")
    .order("created_at")
    .limit(1),
  "membership sample",
);
const attendanceSample = assertOk(
  await db.from("attendance_records").select("church_id").limit(1),
  "attendance sample",
);
const givingSample = assertOk(
  await db.from("giving_donations").select("church_id").limit(1),
  "giving sample",
);

if (!links[0]?.church_id || !links[0]?.user_id) {
  console.error("No representative church membership is available; benchmark skipped.");
  process.exit(1);
}

const churchId = links[0].church_id;
const attendanceChurchId = attendanceSample[0]?.church_id ?? churchId;
const givingChurchId = givingSample[0]?.church_id ?? churchId;
const userId = links[0].user_id;
const now = new Date();
const yearStart = new Date(now.getFullYear(), 0, 1).toISOString();
const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

const membershipRead = () =>
  db
    .from("church_users")
    .select("church_id, role, feature_permissions, churches(name, timezone)")
    .eq("user_id", userId)
    .order("created_at")
    .limit(1)
    .maybeSingle();
const featureRead = () =>
  db
    .from("church_features")
    .select("feature_key, enabled, disabled_reason, disabled_note")
    .eq("church_id", churchId);

console.log("Shared dashboard data");
await sample("  before (duplicate membership + features)", async () => {
  assertOk(await membershipRead(), "membership one");
  assertOk(await membershipRead(), "membership duplicate");
  return assertOk(await featureRead(), "feature flags").length + 2;
});
await sample("  after, cold (membership + features)", async () => {
  assertOk(await membershipRead(), "membership");
  return assertOk(await featureRead(), "feature flags").length + 1;
});
await sample("  after, warm feature cache (membership only)", async () => {
  assertOk(await membershipRead(), "membership");
  return 1;
});

const attendanceRecords = () =>
  db
    .from("attendance_records")
    .select("id, service_date, total_present, total_absent")
    .eq("church_id", attendanceChurchId)
    .order("service_date", { ascending: false })
    .limit(8);

console.log("Attendance list data");
if (attendanceSample.length === 0) {
  console.log("  skipped (the configured project has no attendance records)");
} else {
  await sample("  before (records then entries)", async () => {
    const records = assertOk(await attendanceRecords(), "attendance records");
    const ids = records.map((row) => row.id);
    if (ids.length === 0) return 0;
    const entries = assertOk(
      await db
        .from("attendance_entries")
        .select("record_id, follow_up_requested")
        .in("record_id", ids),
      "attendance entries",
    );
    return records.length + entries.length;
  });
  await sample("  after (one embedded read)", async () => {
    const rows = assertOk(
      await db
        .from("attendance_records")
        .select(
          "id, service_date, total_present, total_absent, attendance_entries(follow_up_requested)",
        )
        .eq("church_id", attendanceChurchId)
        .order("service_date", { ascending: false })
        .limit(8),
      "embedded attendance",
    );
    return rows.length;
  });
}

const kpiRead = (bounded) => {
  let query = db
    .from("giving_donations")
    .select("amount_cents, donor_id, donor_email, created_at")
    .eq("church_id", givingChurchId)
    .eq("status", "succeeded");
  if (bounded) query = query.gte("created_at", yearStart);
  return query;
};
const recentRead = () =>
  db
    .from("giving_donations")
    .select("id, amount_cents, status, created_at")
    .eq("church_id", givingChurchId)
    .order("created_at", { ascending: false })
    .limit(10);
const failedRead = () =>
  db
    .from("giving_subscriptions")
    .select("id", { count: "exact", head: true })
    .eq("church_id", givingChurchId)
    .in("status", ["past_due", "unpaid"]);
const fundRead = (since) =>
  db
    .from("giving_donations")
    .select("amount_cents, fund_id, created_at, giving_funds(id, name)")
    .eq("church_id", givingChurchId)
    .eq("status", "succeeded")
    .gte("created_at", since);

console.log("Giving dashboard data");
await sample("  before (five sequential waves)", async () => {
  const kpis = assertOk(await kpiRead(false), "giving kpis");
  const recent = assertOk(await recentRead(), "recent gifts");
  const failed = await failedRead();
  if (failed.error) throw failed.error;
  const month = assertOk(await fundRead(monthStart), "monthly funds");
  const ytd = assertOk(await fundRead(yearStart), "yearly funds");
  return kpis.length + recent.length + month.length + ytd.length;
});
await sample("  after (one concurrent bounded wave)", async () => {
  const [kpiResult, recentResult, failedResult, fundResult] = await Promise.all([
    kpiRead(true),
    recentRead(),
    failedRead(),
    fundRead(yearStart),
  ]);
  const kpis = assertOk(kpiResult, "bounded giving kpis");
  const recent = assertOk(recentResult, "recent gifts");
  if (failedResult.error) throw failedResult.error;
  const funds = assertOk(fundResult, "giving funds");
  return kpis.length + recent.length + funds.length;
});
