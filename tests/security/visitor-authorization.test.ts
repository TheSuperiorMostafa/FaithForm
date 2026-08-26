import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(path, "utf8");

const relationships = read("lib/faithful/relationships.ts");
const claims = read("lib/faithful/people-claims.ts");
const campuses = read("lib/faithful/campuses.ts");
const discovery = read("lib/faithful/discovery.ts");
const invitations = read("lib/faithful/invitations.ts");
const lifecycle = read("lib/faithful/account-lifecycle.ts");
const account = read("lib/faithful/account.ts");
const settingsActions = read("app/dashboard/settings/faithful-actions.ts");
const claimActions = read("app/dashboard/people/claim-actions.ts");
const staffRelationships = read("lib/faithful/staff-relationships.ts");

// ---------------------------------------------------------------------------
// Tenant resolution
// ---------------------------------------------------------------------------

test("staff actions resolve the church from the session, never from the caller", () => {
  for (const [name, source] of [
    ["settings", settingsActions],
    ["claims", claimActions],
  ] as const) {
    assert.match(source, /getChurchAuth\(\)/, `${name} must resolve auth`);
    // No exported action may accept a churchId argument.
    assert.doesNotMatch(
      source,
      /export async function [a-zA-Z]+\([^)]*churchId/,
      `${name} exposes churchId as an argument`,
    );
  }
});

test("every staff mutation requires an admin", () => {
  assert.match(settingsActions, /if \(!auth\.isAdmin\) throw new Error\("forbidden"\)/);
  assert.match(claimActions, /if \(!auth\.isAdmin\) throw new Error\("forbidden"\)/);
});

test("the People claim workflow is gated on the People feature", () => {
  assert.match(claimActions, /featureActionError\("people"\)/);
});

test("staff-side writes carry an exact church predicate", () => {
  // Each of these updates a row a client could name by id; all must also
  // constrain the tenant so another church's id matches nothing.
  for (const [label, source, symbol] of [
    ["approveClaim", claims, "visitor_people_claims"],
    ["revokeLink", claims, "visitor_people_links"],
    ["updateCampus", campuses, "church_campuses"],
    ["revokeInvitation", invitations, "visitor_invitations"],
  ] as const) {
    const uses = source.match(
      new RegExp(`from\\("${symbol}"\\)[\\s\\S]{0,900}?\\.eq\\("church_id"`, "g"),
    );
    assert.ok(uses && uses.length > 0, `${label} missing church_id predicate`);
  }
});

test("campus and service-time writes cannot cross a tenant", () => {
  assert.match(
    campuses,
    /\.eq\("id", campusId\)[\s\S]{0,200}\.eq\("church_id", churchId\)/,
  );
  assert.match(
    campuses,
    /\.eq\("id", serviceTimeId\)[\s\S]{0,200}\.eq\("church_id", churchId\)/,
  );
});

// ---------------------------------------------------------------------------
// Visitors are not staff
// ---------------------------------------------------------------------------

test("no Faithful module ever writes church_users", () => {
  for (const [name, source] of [
    ["relationships", relationships],
    ["claims", claims],
    ["invitations", invitations],
    ["account", account],
    ["lifecycle", lifecycle],
    ["campuses", campuses],
    ["discovery", discovery],
    ["staff-relationships", staffRelationships],
  ] as const) {
    assert.ok(
      !source.includes('from("church_users")'),
      `${name} touches church_users`,
    );
  }
});

test("no Faithful module creates, merges or deletes a People record", () => {
  for (const [name, source] of [
    ["claims", claims],
    ["lifecycle", lifecycle],
    ["relationships", relationships],
    ["invitations", invitations],
  ] as const) {
    assert.ok(!/from\("members"\)[\s\S]{0,200}\.insert\(/.test(source), `${name} inserts members`);
    assert.ok(!/from\("members"\)[\s\S]{0,200}\.delete\(/.test(source), `${name} deletes members`);
    assert.ok(!/from\("members"\)[\s\S]{0,200}\.update\(/.test(source), `${name} updates members`);
    assert.ok(!/from\("members"\)[\s\S]{0,200}\.upsert\(/.test(source), `${name} upserts members`);
  }
});

test("account deletion never destroys church-owned history", () => {
  const fn = lifecycle.slice(lifecycle.indexOf("export async function processDeletion"));
  for (const table of [
    "members",
    "attendance_records",
    "attendance_entries",
    "giving_donations",
    "giving_donors",
  ]) {
    assert.ok(!fn.includes(`from("${table}")`), `deletion touches ${table}`);
  }
  // A block survives account deletion; only live states are ended.
  assert.match(fn, /\.in\("state", \["following", "pending", "joined"\]\)/);
});

// ---------------------------------------------------------------------------
// No automatic People linking
// ---------------------------------------------------------------------------

test("a link is only ever created by an explicit staff approval", () => {
  const inserts = claims.match(/from\("visitor_people_links"\)\s*\.insert\(/g) ?? [];
  assert.equal(inserts.length, 1, "exactly one code path may create a link");

  const approve = claims.slice(
    claims.indexOf("export async function approveClaim"),
    claims.indexOf("export async function rejectClaim"),
  );
  assert.ok(approve.includes('from("visitor_people_links")'));
  assert.match(approve, /linked_by: input\.staffUserId/);
  // The member is named by the resolver, not inferred.
  assert.match(approve, /member_id: parsed\.data\.memberId/);
});

test("email and phone are candidate hints and never a link key", () => {
  const candidates = claims.slice(
    claims.indexOf("async function findCandidates"),
    claims.indexOf("export async function approveClaim"),
  );
  // Contact columns are read only to suggest, inside the candidate finder.
  assert.match(candidates, /\.eq\("email", hints\.email\)/);
  assert.match(candidates, /\.eq\("phone", hints\.phone\)/);
  assert.match(candidates, /\.limit\(10\)/);

  // and nothing in the approval path consults them.
  const approve = claims.slice(
    claims.indexOf("export async function approveClaim"),
    claims.indexOf("export async function rejectClaim"),
  );
  assert.ok(!approve.includes("normalized_email"));
  assert.ok(!approve.includes("normalized_phone"));
});

test("approval refuses a person already claimed by another account", () => {
  const approve = claims.slice(
    claims.indexOf("export async function approveClaim"),
    claims.indexOf("export async function rejectClaim"),
  );
  assert.match(approve, /member_already_claimed/);
  assert.match(approve, /taken\.account_id !== claim\.account_id/);
});

test("a claim invitation for an already-linked person opens a dispute", () => {
  assert.match(claims, /openDisputedClaim/);
  assert.match(claims, /claim_disputed_already_linked/);
});

test("dependent claims fail closed", () => {
  assert.match(claims, /unsupported_dependent_claim/);
  assert.match(claims, /if \(parsed\.data\.onBehalfOfMemberId\)/);
});

test("candidate suggestions are never returned to the claimant", () => {
  const visitorView = claims.slice(
    claims.indexOf("export async function getClaimStatus"),
    claims.indexOf("// Staff side"),
  );
  assert.ok(!visitorView.includes("findCandidates"));
  assert.ok(!visitorView.includes("member_id"));
  assert.ok(!visitorView.includes("resolved_member_id"));
});

// ---------------------------------------------------------------------------
// Invitations
// ---------------------------------------------------------------------------

test("invitation tokens are hashed before any lookup and never stored raw", () => {
  assert.match(relationships, /hashInvitationToken\(rawToken\)/);
  assert.match(claims, /hashInvitationToken\(rawToken\)/);
  assert.match(invitations, /token_hash: hashInvitationToken\(token\)/);
  assert.ok(!invitations.includes("token: token,"));
});

test("invitation listings never return the hash", () => {
  const list = invitations.slice(invitations.indexOf("export async function listInvitations"));
  assert.ok(!list.includes("token_hash"));
});

test("only a people_claim invitation may name a member, and it is tenant-checked", () => {
  const issue = invitations.slice(
    invitations.indexOf("export async function issueInvitation"),
    invitations.indexOf("export type InvitationSummary"),
  );
  assert.match(issue, /\.eq\("id", parsed\.data\.memberId\)[\s\S]{0,120}\.eq\("church_id", input\.churchId\)/);
  assert.match(issue, /Only a person invitation may name a person/);
});

test("invitation consumption is a single atomic call, not a read then write", () => {
  for (const source of [relationships, claims]) {
    assert.match(source, /rpc\("consume_visitor_invitation"/);
    assert.ok(
      !/from\("visitor_invitations"\)[\s\S]{0,200}\.update\(/.test(source),
      "invitations must not be consumed by a separate update",
    );
  }
});

test("every invitation failure maps to a distinct, non-leaking error", () => {
  for (const reason of ["expired", "revoked", "exhausted", "wrong_purpose", "blocked"]) {
    assert.ok(relationships.includes(`"${reason}"`), `missing ${reason}`);
  }
});

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

test("public reads go through projection functions, never a churches select", () => {
  assert.match(discovery, /rpc\("discover_churches"/);
  assert.match(discovery, /rpc\("public_church_profile"/);
  assert.match(discovery, /rpc\("public_church_campuses"/);

  // The only direct churches reads are staff-side writes gated upstream.
  const publicSection = discovery.slice(
    0,
    discovery.indexOf("export async function updateDiscoverySettings"),
  );
  assert.ok(!publicSection.includes('from("churches")'));
});

test("an unknown slug and a hidden church are indistinguishable", () => {
  const profile = discovery.slice(
    discovery.indexOf("export async function getPublicChurchProfile"),
    discovery.indexOf("export async function updateDiscoverySettings"),
  );
  // Both paths return null; neither throws a distinguishing error.
  assert.match(profile, /if \(!parsedSlug\.success\) return null;/);
  assert.match(profile, /if \(!row\) return null;/);
  assert.ok(!profile.includes("not_discoverable"));
});

test("following or joining requires a discoverable church", () => {
  const follow = relationships.slice(
    relationships.indexOf("export async function followChurch"),
    relationships.indexOf("export async function unfollowChurch"),
  );
  assert.match(follow, /if \(!church\.isDiscoverable\)/);
  assert.match(follow, /church_not_found/);

  const join = relationships.slice(
    relationships.indexOf("export async function requestJoin"),
    relationships.indexOf("export async function leaveChurch"),
  );
  assert.match(join, /if \(!church\.isDiscoverable\)/);
});

test("listing a church publicly requires a public handle", () => {
  const update = discovery.slice(discovery.indexOf("export async function updateDiscoverySettings"));
  assert.match(update, /if \(parsed\.data\.isDiscoverable\)/);
  assert.match(update, /Set a public web address/);
});

// ---------------------------------------------------------------------------
// Cache revocation
// ---------------------------------------------------------------------------

test("losing access bumps the version a device compares against", () => {
  assert.match(
    relationships,
    /if \(decision\.to === "blocked" \|\| decision\.to === "left"\)[\s\S]{0,120}bumpAuthorizationVersion/,
  );
  assert.match(claims, /bumpAuthorizationVersion/);
  assert.match(lifecycle, /bumpAuthorizationVersion/);
});

test("withdrawing attendance consent invalidates a cached decision", () => {
  const consent = account.slice(account.indexOf("export async function recordConsent"));
  assert.match(consent, /bumpAuthorizationVersion/);
});

// ---------------------------------------------------------------------------
// Bounded lists
// ---------------------------------------------------------------------------

test("every visitor-facing list is bounded and cursor-paged", () => {
  for (const [name, source] of [
    ["relationships", relationships],
    ["claims", claims],
    ["invitations", invitations],
    ["staff-relationships", staffRelationships],
  ] as const) {
    assert.match(source, /pageSchema\.safeParse/, `${name} unbounded`);
    assert.match(source, /\.limit\(limit \+ 1\)/, `${name} missing page probe`);
    assert.match(source, /order\("id", \{ ascending: true \}\)/, `${name} unstable order`);
    assert.ok(!/\.range\(/.test(source), `${name} uses offset paging`);
  }
});

// ---------------------------------------------------------------------------
// Logging hygiene
// ---------------------------------------------------------------------------

test("no Faithful module logs tokens, contacts, coordinates or People data", () => {
  for (const [name, source] of [
    ["relationships", relationships],
    ["claims", claims],
    ["invitations", invitations],
    ["account", account],
    ["lifecycle", lifecycle],
    ["campuses", campuses],
    ["discovery", discovery],
    ["staff-relationships", staffRelationships],
  ] as const) {
    const logs = source.match(/console\.(log|info|warn|error|debug)\([^)]*\)/g) ?? [];
    assert.equal(logs.length, 0, `${name} logs: ${logs.join(", ")}`);
  }
});

test("no Prompt 4-12 capability was introduced", () => {
  const all = [relationships, claims, invitations, account, lifecycle, campuses, discovery, staffRelationships].join("\n");
  for (const forbidden of [
    "attendance_records",
    "attendance_entries",
    "service_occurrence",
    "geofence_event",
    "device_token",
    "push_token",
    "apns",
    "fcm",
    "stream_recordings",
    "sermons",
    "giving_donations",
    "payment_intent",
  ]) {
    assert.ok(
      !all.toLowerCase().includes(forbidden.toLowerCase()),
      `Prompt 3 must not implement ${forbidden}`,
    );
  }
});
