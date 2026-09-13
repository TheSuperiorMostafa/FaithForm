import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { GET } from "@/app/api/webhooks/accounts/deletion/route";

/**
 * The route that deletes sign-in identities.
 *
 * Anyone who can call it successfully can make FaithForm finish deletions
 * early, so the only thing it may do for an unauthenticated caller is refuse,
 * the same way whether or not a secret is configured.
 */

const ROUTE_FILE = "app/api/webhooks/accounts/deletion/route.ts";
const PATH = "/api/webhooks/accounts/deletion";

/** The route with comments stripped, so prose cannot satisfy an assertion. */
const route = readFileSync(ROUTE_FILE, "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .split("\n")
  .map((line) => line.replace(/\/\/.*$/, ""))
  .join("\n");
const job = readFileSync("lib/faithform/account-deletion.ts", "utf8");
const vercel = JSON.parse(readFileSync("vercel.json", "utf8")) as {
  crons: { path: string; schedule: string }[];
  functions: Record<string, { maxDuration: number }>;
};

async function call(
  headers: Record<string, string>,
  secret: string | undefined,
  query = "",
) {
  const previous = {
    CRON_SECRET: process.env.CRON_SECRET,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  };
  if (secret === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = secret;
  // No database. A request that got past the check would reach the job, fail
  // to build its client, and come back 500 (never 401), so a refusal below
  // cannot pass by accident, and nothing here can touch a real project.
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.SUPABASE_SECRET_KEY;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;

  try {
    const response = await GET(new Request(`https://faithform.io${PATH}${query}`, { headers }));
    return { status: response.status, body: await response.json() };
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("a missing, wrong or unconfigured secret is refused, identically", async () => {
  const secret = "a-long-random-cron-secret-value";
  const cases: [string, Record<string, string>, string | undefined, string?][] = [
    ["no header", {}, secret],
    ["wrong secret", { authorization: "Bearer not-the-secret" }, secret],
    ["wrong secret of the right length", { authorization: `Bearer ${"x".repeat(secret.length)}` }, secret],
    ["empty bearer", { authorization: "Bearer " }, secret],
    ["secret in the query string instead", {}, secret, `?secret=${secret}`],
    ["no secret configured, empty header", { authorization: "Bearer " }, undefined],
    ["no secret configured, any header", { authorization: "Bearer anything" }, undefined],
  ];

  for (const [name, headers, configured, query] of cases) {
    const { status, body } = await call(headers, configured, query);
    assert.equal(status, 401, name);
    assert.deepEqual(body, { error: "Unauthorized" }, name);
  }
});

test("the right secret does reach the job, so the refusals above are not vacuous", async () => {
  // There is no database, so the job cannot read its queue: a generic 500,
  // with nothing changed and nothing about the failure in the body.
  const secret = "a-long-random-cron-secret-value";
  const original = console.error;
  console.error = () => {};
  try {
    const { status, body } = await call({ authorization: `Bearer ${secret}` }, secret);
    assert.equal(status, 500);
    assert.deepEqual(body, { ok: false });
  } finally {
    console.error = original;
  }
});

test("the secret is checked before any work, in constant time, from the header only", () => {
  assert.match(route, /compareSecret\(provided, process\.env\.CRON_SECRET\)/);
  assert.match(route, /replace\(\/\^Bearer\\s\+\/i, ""\)/);
  assert.ok(
    route.indexOf("compareSecret(") < route.indexOf("runAccountDeletions("),
    "the job must not run before the secret is checked",
  );
  assert.doesNotMatch(route, /searchParams\.get\("secret"\)/);
  assert.ok(
    !/process\.env\.CRON_SECRET\s*(===|!==|\?\?|\|\|)/.test(route.replace(/compareSecret\([^)]*\)/g, "")),
    "the secret must not be branched on outside compareSecret",
  );
});

test("the job is registered, hourly, with room for a full batch", () => {
  const cron = vercel.crons.find((entry) => entry.path === PATH);
  assert.ok(cron, "the deletion route is not a registered cron, so nothing runs it");
  assert.match(cron!.schedule, /^\d{1,2} \* \* \* \*$/, "expected an hourly schedule");
  assert.ok(vercel.functions[ROUTE_FILE]?.maxDuration >= 60);
});

test("work per invocation is bounded", () => {
  assert.match(route, /const DEFAULT_BATCH = \d+/);
  assert.match(route, /const MAX_BATCH = \d+/);
  assert.match(route, /Math\.min\(parsed, MAX_BATCH\)/);
  assert.match(route, /if \(!Number\.isInteger\(parsed\) \|\| parsed < 1\) return DEFAULT_BATCH/);
  assert.match(job, /Math\.min\(\s*Math\.max\(Math\.trunc\(options\.limit \?\? DEFAULT_DELETION_BATCH\), 1\),\s*MAX_DELETION_BATCH,\s*\)/);
});

test("the response and the logs are counts and codes, never a person", () => {
  for (const forbidden of ["userId", "accountId", "email", "user_id", "account_id", ".message"]) {
    assert.ok(!route.includes(forbidden), `the route response exposes ${forbidden}`);
  }
  assert.match(route, /"Cache-Control": "no-store"/);

  // Every log call in the job, and what it passes.
  const logCalls = [...job.matchAll(/logger\.(?:info|error)\(([\s\S]*?)\);/g)].map((match) => match[1]);
  assert.ok(logCalls.length >= 3, "the job's log calls moved and this test went stale");
  for (const call of logCalls) {
    for (const forbidden of ["userId", "accountId", "email", "account_id", "user_id", ".message"]) {
      assert.ok(!call.includes(forbidden), `a log line passes ${forbidden}`);
    }
  }
  // A stored or logged error is a step and a code, built from nothing else:
  // no provider or exception message is ever read.
  assert.match(job, /\? `\$\{error\.step\}:\$\{error\.code\}`\s*: `unexpected:\$\{codeOf\(error\)\}`/);
  assert.doesNotMatch(job.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, ""), /\.message\b/);
});

test("the Auth delete is a hard delete, and staff are checked first", () => {
  assert.match(job, /auth\.admin\.deleteUser\(userId, false\)/);
  const processing = job.slice(job.indexOf("export async function processDeletionRequest"));
  assert.ok(
    processing.indexOf("inspectSignInIdentity(") < processing.indexOf("deleteAuthUser("),
    "the staff check must come before the Auth delete",
  );
  assert.match(processing, /if \(identity\.hasStaffAccess \|\| !identity\.exists\) \{\s*[\s\S]{0,300}deleteVisitorAccountRow/);
});
