import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const routeSource = readFileSync(
  "app/api/webhooks/notifications/dispatch/route.ts",
  "utf8",
);

/**
 * The route with comments stripped.
 *
 * Assertions about what the code does must not be satisfied — or defeated — by
 * prose describing it. A comment saying "no notification body" is not a body.
 */
const route = routeSource
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .split("\n")
  .map((line) => line.replace(/\/\/.*$/, ""))
  .join("\n");
const outbox = readFileSync("lib/faithful/push/outbox.ts", "utf8");
const migration = readFileSync(
  "supabase/migrations/0054_faithful_publication_and_push.sql",
  "utf8",
);
const vercel = JSON.parse(readFileSync("vercel.json", "utf8")) as {
  crons: { path: string; schedule: string }[];
  functions: Record<string, { maxDuration: number }>;
};

const DISPATCH_PATH = "/api/webhooks/notifications/dispatch";

// ---------------------------------------------------------------------------
// Invocation path
// ---------------------------------------------------------------------------

test("the worker has a durable, registered invocation path", () => {
  const cron = vercel.crons.find((entry) => entry.path === DISPATCH_PATH);
  assert.ok(cron, "dispatch route must be registered as a cron");
  // Frequent enough that a published announcement reaches phones promptly.
  assert.match(cron!.schedule, /^\*\/\d+ \* \* \* \*$/);
});

test("the worker function has headroom for two outbound providers", () => {
  const config = vercel.functions[
    "app/api/webhooks/notifications/dispatch/route.ts"
  ];
  assert.ok(config, "dispatch route must have an explicit duration");
  assert.ok(config.maxDuration >= 60, "30s is not enough for a provider batch");
});

test("the route follows the repository's established cron convention", () => {
  // Same shape as weekly-draft, keep-alive and receipt-retry: Bearer secret,
  // constant-time comparison, generic 401.
  assert.match(route, /compareSecret\(provided, process\.env\.CRON_SECRET\)/);
  assert.match(route, /replace\(\/\^Bearer\\s\+\/i, ""\)/);
  assert.match(route, /status: 401/);
  assert.match(route, /export async function GET/);
});

test("authorization failure is generic and unconditional", () => {
  // Distinguishing "no secret configured" from "wrong secret" would tell a
  // prober which it is.
  assert.match(route, /\{ error: "Unauthorized" \}/);
  assert.ok(
    !/process\.env\.CRON_SECRET\s*(===|!==|\?\?|\|\|)/.test(
      route.replace(/compareSecret\([^)]*\)/g, ""),
    ),
    "the secret must not be branched on outside compareSecret",
  );
});

test("work is bounded so one invocation cannot exceed its budget", () => {
  assert.match(route, /const DEFAULT_BATCH = \d+/);
  assert.match(route, /const MAX_BATCH = \d+/);
  assert.match(route, /Math\.min\(parsed, MAX_BATCH\)/);
  // A malformed limit falls back to the default rather than being trusted.
  assert.match(route, /if \(!Number\.isInteger\(parsed\) \|\| parsed < 1\) return DEFAULT_BATCH/);
});

test("the response is observability, not a data export", () => {
  assert.match(route, /durationMs/);
  assert.match(route, /"Cache-Control": "no-store"/);
  for (const forbidden of [
    "provider_token",
    "providerToken",
    "deep_link",
    "title",
    "body",
    "accountId",
    "churchId",
  ]) {
    assert.ok(!route.includes(forbidden), `dispatch response exposes ${forbidden}`);
  }
});

// ---------------------------------------------------------------------------
// Overlap safety
// ---------------------------------------------------------------------------

test("concurrent invocations are safe by construction, not by scheduling", () => {
  // Two workers must claim disjoint sets rather than one blocking the other.
  assert.match(migration, /for update skip locked/i);
  // Each invocation mints its own lease token.
  assert.match(outbox, /const leaseToken = randomUUID\(\)/);
  // The route deliberately takes no global lock — that would itself become a
  // stuck state needing recovery.
  assert.ok(
    !/lock|mutex|semaphore/i.test(route),
    "the route must not add a global lock",
  );
});

test("a dead worker's jobs become claimable again rather than sticking", () => {
  const claim = migration.slice(
    migration.indexOf("create or replace function public.claim_notification_jobs"),
    migration.indexOf("create or replace function public.complete_notification_job"),
  );
  // Lease expiry is the recovery mechanism: no separate reaper to also fail.
  assert.match(claim, /o\.lease_expires_at is null or o\.lease_expires_at <= p_now/);
  assert.match(claim, /lease_expires_at = p_now \+ make_interval/);
  assert.match(claim, /greatest\(p_lease_seconds, 30\)/);
});

test("only the lease holder may complete a job", () => {
  const complete = migration.slice(
    migration.indexOf("create or replace function public.complete_notification_job"),
  );
  assert.match(complete, /and o\.lease_token = p_lease_token/);
  // A recovered job that a stale worker then tries to complete updates nothing.
  assert.match(complete, /get diagnostics updated = row_count/);
  assert.match(complete, /return updated > 0/);
});

test("retries are bounded and backoff is capped", () => {
  const complete = migration.slice(
    migration.indexOf("create or replace function public.complete_notification_job"),
  );
  assert.match(complete, /when o\.attempts >= o\.max_attempts then 'failed'/);
  assert.match(
    complete,
    /least\(greatest\(p_backoff_seconds, 10\) \* power\(2, o\.attempts - 1\), 3600\)/,
  );

  const claim = migration.slice(
    migration.indexOf("create or replace function public.claim_notification_jobs"),
    migration.indexOf("create or replace function public.complete_notification_job"),
  );
  // An exhausted job is never re-claimed.
  assert.match(claim, /o\.attempts < o\.max_attempts/);
});

test("the claim batch is bounded server-side too", () => {
  const claim = migration.slice(
    migration.indexOf("create or replace function public.claim_notification_jobs"),
    migration.indexOf("create or replace function public.complete_notification_job"),
  );
  // A caller asking for a million rows gets 100.
  assert.match(claim, /least\(greatest\(coalesce\(p_limit, 10\), 1\), 100\)/);
});

// ---------------------------------------------------------------------------
// Idempotency
// ---------------------------------------------------------------------------

test("a re-run cannot duplicate a logical notification", () => {
  assert.match(migration, /dedupe_key text not null unique/);
  assert.match(outbox, /dedupeKeyFor\(input\.announcementId, input\.publicationVersion\)/);
  // Attempt rows are unique per attempt, so a retried worker cannot
  // double-count a delivery.
  assert.match(migration, /unique \(outbox_id, installation_id, attempt_number\)/);
});

test("a claimed job re-checks its subject before sending", () => {
  assert.match(outbox, /if \(!\(await subjectIsStillCurrent\(admin, raw\)\)\)/);
  assert.match(outbox, /p_outcome: "cancelled"/);
});

// ---------------------------------------------------------------------------
// Provider authentication
// ---------------------------------------------------------------------------

test("no adapter reads a pre-issued provider token from the environment", () => {
  const adapters = readFileSync("lib/faithful/push/adapters.ts", "utf8");
  for (const forbidden of ["APNS_BEARER_TOKEN", "FCM_ACCESS_TOKEN", "authorizationToken"]) {
    assert.ok(!adapters.includes(forbidden), `adapters still assume ${forbidden}`);
  }
  // Both now mint their own.
  assert.match(adapters, /ApnsTokenProvider/);
  assert.match(adapters, /FcmTokenProvider/);
});

test("a rejected credential invalidates the cached provider token", () => {
  const adapters = readFileSync("lib/faithful/push/adapters.ts", "utf8");
  const invalidations = adapters.match(
    /if \(result\.errorCategory === "auth_rejected"\) this\.tokens\.invalidate\(\)/g,
  );
  assert.equal(invalidations?.length, 2, "both adapters must drop a rejected token");
});

test("provider auth never logs anything", () => {
  const auth = readFileSync("lib/faithful/push/provider-auth.ts", "utf8");
  const logs = auth.match(/console\.(log|info|warn|error|debug)\(/g) ?? [];
  assert.equal(logs.length, 0, `provider-auth logs: ${logs.join(", ")}`);
});

test("signing configuration is read from the environment, never from a request", () => {
  const auth = readFileSync("lib/faithful/push/provider-auth.ts", "utf8");
  // Config comes only from process.env via envValue.
  assert.match(auth, /function envValue\(name: string\)/);
  assert.ok(!auth.includes("searchParams"), "provider auth must not read a request");
  assert.ok(!auth.includes("headers.get"), "provider auth must not read a request");
});
