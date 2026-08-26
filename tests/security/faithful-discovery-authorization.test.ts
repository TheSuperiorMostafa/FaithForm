import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const read = (path: string) => readFileSync(path, "utf8");

const nearby = read("lib/faithful/nearby.ts");
const feed = read("lib/faithful/announcements-feed.ts");
const installations = read("lib/faithful/push/installations.ts");
const outbox = read("lib/faithful/push/outbox.ts");
const adapters = read("lib/faithful/push/adapters.ts");
const publishHook = read("lib/faithful/push/publish-hook.ts");
const discoveryService = read("lib/mobile/v1/discovery-service.ts");
const feedService = read("lib/mobile/v1/feed-service.ts");
const announcementActions = read("app/dashboard/announcements/actions.ts");

const PUSH_MODULES: [string, string][] = [
  ["nearby", nearby],
  ["feed", feed],
  ["installations", installations],
  ["outbox", outbox],
  ["adapters", adapters],
  ["publish-hook", publishHook],
  ["discovery-service", discoveryService],
  ["feed-service", feedService],
];

function mobileRouteFiles(dir = "app/api/mobile"): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) found.push(...mobileRouteFiles(full));
    else if (entry === "route.ts") found.push(full);
  }
  return found;
}

// ---------------------------------------------------------------------------
// Location privacy
// ---------------------------------------------------------------------------

test("no module logs a coordinate, a token, or a provider body", () => {
  for (const [name, source] of PUSH_MODULES) {
    const logs = source.match(/console\.(log|info|warn|error|debug)\([^)]*\)/g) ?? [];
    assert.equal(logs.length, 0, `${name} logs: ${logs.join(", ")}`);
  }
});

test("nearby search never persists a coordinate", () => {
  // The only thing done with a coordinate is pass it to the bounded query.
  assert.match(nearby, /rpc\("discover_churches_nearby"/);
  for (const write of [".insert(", ".update(", ".upsert("]) {
    assert.ok(!nearby.includes(write), `nearby performs a ${write} write`);
  }
});

test("nearby coordinates travel in a body, not a query string", () => {
  const route = read("app/api/mobile/v1/churches/nearby/route.ts");
  assert.match(route, /export const POST/);
  assert.ok(!route.includes("export const GET"), "must not accept coordinates via GET");
  // And the response is never cached anywhere.
  assert.match(route, /cache: "private-no-store"/);
});

test("nearby input is validated and bounded before it reaches the database", () => {
  assert.match(nearby, /\.min\(-90\)\.max\(90\)/);
  assert.match(nearby, /\.min\(-180\)\.max\(180\)/);
  assert.match(nearby, /radiusKm[\s\S]{0,60}\.min\(1\)\.max\(200\)/);
});

// ---------------------------------------------------------------------------
// Feed authorization
// ---------------------------------------------------------------------------

test("a blocked relationship sees nothing at all, not merely less", () => {
  assert.match(feed, /if \(input\.relationshipState === "blocked"\)/);
  assert.match(feed, /return \{ items: \[\], nextCursor: null, maxVersion: 0 \}/);
});

test("the feed never filters visibility in application memory", () => {
  // All targeting happens in SQL; the service maps rows and nothing else.
  assert.ok(
    !/\.filter\([^)]*visibility/.test(feed),
    "feed filters visibility in JS",
  );
  assert.match(feed, /rpc\("mobile_announcement_feed"/);
});

test("the relationship state is resolved server-side, never taken from a request", () => {
  assert.match(feedService, /resolveRelationshipState\(\s*input\.userId/);
  assert.ok(
    !/relationshipState:\s*input\.relationshipState/.test(feedService),
    "feed service must not accept a caller-supplied relationship",
  );
});

test("a notification tap resolves current content rather than trusting the payload", () => {
  const detail = read("app/api/mobile/v1/announcements/[slug]/[id]/route.ts");
  assert.match(detail, /getFeedItem/);
  assert.match(detail, /not_found/);
  assert.match(detail, /cache: "private-no-store"/);
});

// ---------------------------------------------------------------------------
// Device tokens
// ---------------------------------------------------------------------------

test("the installation view type has no token field", () => {
  assert.ok(
    !/export type InstallationView[\s\S]{0,400}providerToken/.test(installations),
    "InstallationView exposes a token",
  );
  // The only select including the token is the worker's recipient lookup.
  const tokenSelects = (installations.match(/\.select\("[^"]*provider_token[^"]*"\)/g) ?? []);
  assert.ok(tokenSelects.length <= 1, `too many token selects: ${tokenSelects.join(", ")}`);
});

test("retiring an installation clears the token rather than only disabling it", () => {
  const cleared = installations.match(/provider_token: ""/g) ?? [];
  assert.ok(cleared.length >= 3, "every retirement path must clear the token");
});

test("an install id from another account cannot be retired", () => {
  assert.match(
    installations,
    /\.eq\("install_id", installId\)[\s\S]{0,300}\.eq\("account_id", account\.id\)/,
  );
});

test("sign-out and deletion both retire notification authority", () => {
  const accountService = read("lib/mobile/v1/account-service.ts");
  const lifecycle = read("lib/faithful/account-lifecycle.ts");
  assert.match(accountService, /retireInstallationsForAccount\(account\.id, "signed_out"\)/);
  assert.match(lifecycle, /retireInstallationsForAccount\(accountId, "account_deleted"\)/);
});

test("a preference may only be set for a church with a live relationship", () => {
  const setter = installations.slice(installations.indexOf("export async function setPreference"));
  assert.match(setter, /from\("visitor_church_relationships"\)/);
  assert.match(setter, /relationship\.state === "blocked"/);
  assert.match(setter, /relationship_not_found/);
});

// ---------------------------------------------------------------------------
// Outbox
// ---------------------------------------------------------------------------

test("publication enqueues before any external provider is contacted", () => {
  const publishBody = announcementActions.slice(
    announcementActions.indexOf("export async function publishAnnouncement"),
  );
  const enqueueAt = publishBody.indexOf("applyMobilePublication");
  const facebookAt = publishBody.indexOf("if (payload.pushToFacebook)");
  assert.ok(enqueueAt > 0, "publish must enqueue");
  assert.ok(
    enqueueAt < facebookAt,
    "enqueue must happen before external providers, so a provider failure cannot affect it",
  );
});

test("unpublishing and deleting both withdraw from the app", () => {
  assert.ok(
    (announcementActions.match(/withdrawMobilePublication/g) ?? []).length >= 3,
    "unsubmit and delete must both withdraw",
  );
});

test("the audience is re-resolved at send time, not materialized at publish", () => {
  assert.match(outbox, /target_visibility: input\.visibility/);
  assert.match(outbox, /async function resolveRecipients/);
  assert.match(
    outbox,
    /from\("visitor_church_relationships"\)[\s\S]{0,200}\.in\("state", states\)/,
  );
});

test("a job is cancelled when its subject moved on", () => {
  assert.match(outbox, /subjectIsStillCurrent/);
  assert.match(outbox, /Number\(data\.publication_version\) !== job\.subject_version/);
  assert.match(outbox, /p_outcome: "cancelled"/);
});

test("an invalid token deactivates the installation", () => {
  assert.match(outbox, /if \(outcome\.invalidToken\)[\s\S]{0,120}invalidateToken/);
});

test("a permanent failure for one device does not re-notify everyone", () => {
  assert.match(outbox, /const jobOutcome = anyRetryable \? "retryable" : "sent"/);
});

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

test("every mobile route goes through a shared handler", () => {
  for (const file of mobileRouteFiles()) {
    const source = read(file);
    assert.match(
      source,
      /(authenticatedRoute|publicRoute|optionalAuthRoute)\(/,
      `${file} bypasses the shared handler`,
    );
  }
});

test("no mobile route reads a tenant or identity value from the request", () => {
  for (const file of mobileRouteFiles()) {
    const source = read(file);
    for (const forbidden of ["churchId", "accountId", "relationshipState", "userId"]) {
      assert.ok(
        !new RegExp(`searchParams\\.get\\("${forbidden}"`).test(source),
        `${file} reads ${forbidden} from the request`,
      );
    }
  }
});

test("authenticated routes are never shared-cacheable", () => {
  for (const file of mobileRouteFiles()) {
    const source = read(file);
    if (!source.includes("authenticatedRoute")) continue;
    assert.ok(
      source.includes('cache: "private-no-store"') ||
        source.includes('cache: "private-revalidate"'),
      `${file} is authenticated but not private-cached`,
    );
  }
});

test("no Prompt 6-11 capability was introduced", () => {
  const all = PUSH_MODULES.map(([, source]) => source).join("\n");
  for (const forbidden of [
    "attendance_records",
    "service_occurrence",
    "geofence",
    "kiosk",
    "stream_recordings",
    "giving_donations",
    "payment_intent",
    "ACCESS_BACKGROUND_LOCATION",
  ]) {
    assert.ok(
      !all.toLowerCase().includes(forbidden.toLowerCase()),
      `Prompt 5 must not implement ${forbidden}`,
    );
  }
});
