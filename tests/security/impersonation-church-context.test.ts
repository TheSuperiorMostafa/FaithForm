import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(path, "utf8");

/**
 * A platform admin working inside a church must be answered with that church
 * however the caller asks. Thirty-odd call sites pass their own client or a
 * user id, and each of those used to resolve the admin's own church instead:
 * Settings showed nothing connected, and an iCloud connection or a published
 * announcement landed on the wrong account.
 */

test("getChurchAuth with a client still honours the church being worked in", () => {
  const source = read("lib/auth/church.ts");
  const forClient = source.slice(
    source.indexOf("async function getChurchAuthForClient"),
    source.indexOf("export function getChurchAuth("),
  );

  assert.match(forClient, /await getImpersonatedChurchAuth\(\)/);
  // Only for the same person: a client for anyone else answers for itself.
  assert.match(forClient, /claims\?\.sub === impersonated\.userId/);

  const exported = source.slice(source.indexOf("export function getChurchAuth("));
  assert.match(exported, /getChurchAuthForClient\(supabase\)/);
  assert.doesNotMatch(exported, /\? getChurchAuthWithClient\(supabase\)/);
});

test("getCurrentChurchId answers the admin with the church they are in", () => {
  const source = read("lib/auth/current-church.ts");
  const fn = source.slice(source.indexOf("export async function getCurrentChurchId"));

  assert.ok(
    fn.indexOf("getActiveImpersonation()") < fn.indexOf("getMembershipChurchId("),
    "impersonation must be checked before membership",
  );
  assert.match(fn, /acting\.adminUserId === userId/);
});

test("server code resolves the current church through the impersonation-aware lookup", () => {
  const callers = [
    "app/dashboard/actions.ts",
    "app/dashboard/announcements/actions.ts",
    "app/dashboard/attendance/(record)/[date]/actions.ts",
    "app/dashboard/attendance/(record)/[date]/page.tsx",
    "app/dashboard/library/page.tsx",
    "app/dashboard/sermon-builder/new/page.tsx",
    "app/dashboard/sermon-builder/[id]/page.tsx",
    "app/dashboard/sermon-builder/[id]/edit/page.tsx",
    "app/dashboard/sermon-builder/[id]/social/page.tsx",
    "app/dashboard/sermon-builder/[id]/discussion/page.tsx",
    "app/dashboard/sermon-builder/series/new/page.tsx",
    "app/dashboard/sermon-builder/series/[id]/page.tsx",
    "app/api/sermon/themes/route.ts",
    "lib/reports/auth.ts",
  ];

  for (const path of callers) {
    const source = read(path);
    assert.match(
      source,
      /import \{ getCurrentChurchId \} from "@\/lib\/auth\/current-church"/,
      `${path} must use the impersonation-aware lookup`,
    );
  }
});

test("the membership lookup client components import stays free of cookie code", () => {
  // lib/queries/dashboard.ts is reachable from client components, so pulling
  // the impersonation module in there breaks the production build.
  assert.doesNotMatch(read("lib/queries/dashboard.ts"), /lib\/auth\/impersonation/);
});

test("feature switches for an impersonated church read through the service role", () => {
  const source = read("lib/features/access.ts");
  assert.match(source, /client && !auth\.impersonation/);
});

test("integration status is projected server-side before the uid-scoped RPC", () => {
  const source = read("lib/integrations/tokens.ts");
  const loader = source.slice(
    source.indexOf("async function loadIntegrationStatusRows"),
    source.indexOf("function projectSafeMetadata"),
  );

  assert.ok(
    loader.indexOf("createAdminClientOrNull") < loader.indexOf("get_church_integration_status"),
    "the admin projection must be tried first",
  );
  assert.match(loader, /projectSafeMetadata\(/);
  // The projection still never selects a refresh token.
  assert.doesNotMatch(loader, /refresh_token/);
});
