import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

function configuredEnvironment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    NODE_ENV: "development", // The readiness command must still enforce production.
    NEXT_PUBLIC_SUPABASE_URL: "https://readiness.supabase.co",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_readiness_only",
    SUPABASE_SECRET_KEY: "sb_secret_readiness_only_00000000000000001",
    NEXT_PUBLIC_SITE_URL: "https://readiness.invalid",
    STREAM_HLS_UPSTREAM_URL: "https://hls.readiness.invalid",
    STREAM_WS_INGEST_UPSTREAM_URL: "wss://ingest.readiness.invalid",
    STRIPE_SECRET_KEY: "sk_test_readiness_only_000000000",
    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "pk_test_readiness_only_000000000",
    STRIPE_WEBHOOK_SECRET: "whsec_readiness_only_000000000000001",
    RESEND_API_KEY: "re_readiness_only_000000000",
  };
  for (const name of [
    "DONOR_PORTAL_SESSION_SECRET", "INTEGRATION_OAUTH_STATE_SECRET",
    "N8N_WEBHOOK_SECRET", "RATE_LIMIT_KEY_SECRET", "STREAM_RELAY_WEBHOOK_SECRET",
    "STREAM_RELAY_PLAYBACK_SECRET", "STREAM_INGEST_SIGNING_SECRET",
    "STREAM_PLAYBACK_SECRET", "CRON_SECRET", "ATTENDANCE_QR_SECRET",
  ]) env[name] = `readiness-only-${name.toLowerCase()}-00000000000001`;
  return env;
}

function check(env: NodeJS.ProcessEnv) {
  const result = spawnSync(process.execPath, ["scripts/pilot-readiness.mjs"], {
    env, encoding: "utf8",
  });
  assert.ifError(result.error);
  assert.equal(result.stderr, "");
  return result;
}

test("Supabase-only configuration cannot report production readiness", () => {
  const full = configuredEnvironment();
  const result = check({
    NODE_ENV: "development",
    NEXT_PUBLIC_SUPABASE_URL: full.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: full.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    SUPABASE_SERVICE_ROLE_KEY: full.SUPABASE_SECRET_KEY,
  });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /failed\s+CRON_SECRET/);
  assert.match(result.stdout, /failed\s+ATTENDANCE_QR_SECRET/);
  assert.match(result.stdout, /failed\s+RESEND_API_KEY/);
});

test("complete modern configuration succeeds without printing values", () => {
  const env = configuredEnvironment();
  const result = check(env);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Production environment: configured/);
  assert.match(result.stdout, /delivery is unavailable for those platforms/);
  for (const [name, value] of Object.entries(env)) {
    if (name !== "NODE_ENV") assert.ok(!result.stdout.includes(value!), name);
  }
});

test("legacy Supabase aliases accepted by production are accepted by readiness", () => {
  const env = configuredEnvironment();
  env.SUPABASE_SERVICE_ROLE_KEY = env.SUPABASE_SECRET_KEY;
  env.NEXT_PUBLIC_SUPABASE_ANON_KEY = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  delete env.SUPABASE_SECRET_KEY;
  delete env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  assert.equal(check(env).status, 0);
});

test("missing production signing configuration fails even in development mode", () => {
  const env = configuredEnvironment();
  delete env.ATTENDANCE_QR_SECRET;
  const result = check(env);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /failed\s+ATTENDANCE_QR_SECRET/);
});

test("mixed Stripe modes and reused signing secrets fail", () => {
  const env = configuredEnvironment();
  env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY = "pk_live_readiness_only_000000000";
  env.CRON_SECRET = env.ATTENDANCE_QR_SECRET;
  const result = check(env);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /failed\s+stripe-key-mode/);
  assert.match(result.stdout, /failed\s+unique-secret-values/);
});


test("FCM JSON alternative is validated and its values are never printed", () => {
  const env = configuredEnvironment();
  const serviceAccount = {
    project_id: "readiness-push-project",
    client_email: "readiness-push@readiness.invalid",
    private_key: "BEGIN PRIVATE KEY\\nreadiness-push-private-key",
  };
  env.FCM_SERVICE_ACCOUNT_JSON = JSON.stringify(serviceAccount);
  const result = check(env);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Push — Android \(FCM\): ready/);
  assert.match(result.stdout, /source\s+FCM_SERVICE_ACCOUNT_JSON/);
  for (const value of Object.values(serviceAccount)) assert.ok(!result.stdout.includes(value));
});

test("malformed or incomplete FCM JSON never falls back to split credentials", () => {
  const env = configuredEnvironment();
  env.FCM_PROJECT_ID = "readiness-push-project";
  env.FCM_CLIENT_EMAIL = "readiness-push@readiness.invalid";
  env.FCM_PRIVATE_KEY = "BEGIN PRIVATE KEY readiness-push-private-key";
  for (const json of ["invalid-json-sensitive", JSON.stringify({ project_id: env.FCM_PROJECT_ID }), JSON.stringify({ project_id: "project", client_email: "invalid-email", private_key: "invalid-key" }), JSON.stringify({ project_id: 123, client_email: env.FCM_CLIENT_EMAIL, private_key: env.FCM_PRIVATE_KEY })]) {
    env.FCM_SERVICE_ACCOUNT_JSON = json;
    const result = check(env);
    assert.match(result.stdout, /Push — Android \(FCM\): not configured/);
    assert.ok(!result.stdout.includes(json));
  }
});
