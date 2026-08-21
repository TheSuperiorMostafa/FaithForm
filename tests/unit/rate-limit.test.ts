import assert from "node:assert/strict";
import test from "node:test";
import {
  checkRateLimit,
  getClientIp,
  hashRateLimitKey,
} from "@/lib/security/rate-limit";

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

test("rate-limit keys are privacy-safe and isolated", () => {
  const secret = "rate-limit-test-secret-at-least-32-bytes";
  const raw = "portal:203.0.113.10:church-a";
  const hashed = hashRateLimitKey(raw, secret);
  assert.equal(hashed.includes("203.0.113.10"), false);
  assert.notEqual(hashed, hashRateLimitKey(`${raw}:other`, secret));
  assert.equal(hashed, hashRateLimitKey(raw, secret));
});

test("forwarded IP headers are ignored without an explicitly trusted proxy", () => {
  const previousVercel = process.env.VERCEL;
  const previousTrust = process.env.TRUST_PROXY_HEADERS;
  delete process.env.VERCEL;
  delete process.env.TRUST_PROXY_HEADERS;
  const request = new Request("http://internal", {
    headers: { "x-forwarded-for": "198.51.100.1" },
  });
  assert.equal(getClientIp(request), "untrusted");
  restoreEnv("VERCEL", previousVercel);
  restoreEnv("TRUST_PROXY_HEADERS", previousTrust);
});

test("trusted proxy mode uses the first normalized address", () => {
  const previous = process.env.TRUST_PROXY_HEADERS;
  process.env.TRUST_PROXY_HEADERS = "true";
  const request = new Request("http://internal", {
    headers: { "x-forwarded-for": "198.51.100.1, 10.0.0.2" },
  });
  assert.equal(getClientIp(request), "198.51.100.1");
  restoreEnv("TRUST_PROXY_HEADERS", previous);
});

test("an unavailable limiter fails closed", async () => {
  const priorUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const priorService = process.env.SUPABASE_SECRET_KEY;
  const priorLegacyService = process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.SUPABASE_SECRET_KEY;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  const result = await checkRateLimit("test", { limit: 1, windowMs: 1_000 });
  assert.deepEqual(result, { ok: false, retryAfterSeconds: 60 });
  restoreEnv("NEXT_PUBLIC_SUPABASE_URL", priorUrl);
  restoreEnv("SUPABASE_SECRET_KEY", priorService);
  restoreEnv("SUPABASE_SERVICE_ROLE_KEY", priorLegacyService);
});
