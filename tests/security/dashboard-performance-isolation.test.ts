import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(path, "utf8");

test("persistent feature caching is tenant-scoped and never caches identity", () => {
  const access = read("lib/features/access.ts");
  const auth = read("lib/auth/church.ts");

  assert.match(access, /\["church-feature-state", churchId\]/);
  assert.match(access, /churchFeatureCacheTag\(churchId\)/);
  assert.match(access, /resolveAllowedFeatures\(auth, flags\)/);
  assert.doesNotMatch(auth, /unstable_cache/);
});

test("feature mutations invalidate the exact church cache", () => {
  const action = read("app/admin/feature-actions.ts");
  assert.match(
    action,
    /revalidateTag\(churchFeatureCacheTag\(churchId\)\)/,
  );
});

test("dashboard auth verifies claims, then resolves membership under RLS", () => {
  const auth = read("lib/auth/church.ts");
  assert.match(auth, /auth\.getClaims\(\)/);
  assert.match(auth, /\.from\("church_users"\)/);
  assert.match(auth, /\.eq\("user_id", userId\)/);
});

test("session refresh responses carry Supabase's private no-cache headers", () => {
  const middleware = read("lib/supabase/middleware.ts");
  assert.match(middleware, /setAll: \(cookiesToSet, headers\)/);
  assert.match(middleware, /nextResponse\.headers\.set\(name, value\)/);
});

test("dynamic dashboard routes have a shared streamed loading boundary", () => {
  const loading = read("app/dashboard/loading.tsx");
  assert.match(loading, /DashboardRouteLoading/);
});
