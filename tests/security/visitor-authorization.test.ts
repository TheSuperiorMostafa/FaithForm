import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(path, "utf8");

const relationships = read("lib/faithform/relationships.ts");
const claims = read("lib/faithform/people-claims.ts");
const campuses = read("lib/faithform/campuses.ts");
const discovery = read("lib/faithform/discovery.ts");
const invitations = read("lib/faithform/invitations.ts");
const lifecycle = read("lib/faithform/account-lifecycle.ts");
const deletion = read("lib/faithform/account-deletion.ts");
const account = read("lib/faithform/account.ts");
const settingsActions = read("app/dashboard/settings/faithform-actions.ts");
const claimActions = read("app/dashboard/people/claim-actions.ts");
const staffRelationships = read("lib/faithform/staff-relationships.ts");
const appPeople = read("lib/faithform/app-people.ts");
const appPeopleMigration = read(
  "supabase/migrations/0083_app_members_in_people_and_one_attendance.sql",
);

/** The body of one SQL function in a migration, comments stripped. */
function sqlFunction(sql: string, name: string): string {
  const start = sql.indexOf(`create or replace function public.${name}(`);
  assert.ok(start >= 0, `${name} is not defined`);
  const bodyStart = sql.indexOf("$$", start);
  const bodyEnd = sql.indexOf("$$;", bodyStart + 2);
  return sql
    .slice(bodyStart, bodyEnd)
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");
}

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

test("no FaithForm module ever writes church_users", () => {
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

test("bootstrap reads church_users so dashboard staff see their church in the app", () => {
  const accountService = read("lib/mobile/v1/account-service.ts");
  const sync = accountService.slice(
    accountService.indexOf("async function syncStaffChurchesIntoApp"),
    accountService.indexOf("export async function getBootstrap"),
  );
  assert.match(sync, /from\("church_users"\)/);
  assert.match(sync, /select\("church_id, role"\)/);
  assert.match(sync, /admitStaffAsMember/);
  assert.doesNotMatch(sync, /\.insert\(/);
  assert.doesNotMatch(sync, /\.update\(/);
  assert.doesNotMatch(sync, /\.upsert\(/);
  assert.match(accountService, /await syncStaffChurchesIntoApp/);
  assert.doesNotMatch(relationships, /from\("church_users"\)/);
  assert.match(relationships, /export async function admitStaffAsMember/);
});

test("no FaithForm module writes a People record directly", () => {
  // A new record for someone who joined is made in the database, in the same
  // transaction as its link (`connect_app_member`, 0083). No module here
  // writes `members` itself.
  for (const [name, source] of [
    ["claims", claims],
    ["lifecycle", lifecycle],
    ["deletion", deletion],
    ["relationships", relationships],
    ["invitations", invitations],
    ["app-people", appPeople],
  ] as const) {
    assert.ok(!/from\("members"\)[\s\S]{0,200}\.insert\(/.test(source), `${name} inserts members`);
    assert.ok(!/from\("members"\)[\s\S]{0,200}\.delete\(/.test(source), `${name} deletes members`);
    assert.ok(!/from\("members"\)[\s\S]{0,200}\.update\(/.test(source), `${name} updates members`);
    assert.ok(!/from\("members"\)[\s\S]{0,200}\.upsert\(/.test(source), `${name} upserts members`);
  }
});

test("account deletion never destroys church-owned history", () => {
  for (const table of [
    "members",
    "attendance_records",
    "attendance_entries",
    "attendance_facts",
    "attendance_attempts",
    "giving_donations",
    "giving_donors",
    "sermons",
  ]) {
    assert.ok(!deletion.includes(`from("${table}")`), `deletion touches ${table}`);
  }
  // Exactly two things are ever deleted directly (the Auth user or, for a
  // staff member, the app account row), and the schema's foreign keys decide
  // the rest (pinned in tests/policies/account-deletion-migration.test.ts).
  const deletes = deletion.match(/\.delete\(\)/g) ?? [];
  assert.equal(deletes.length, 1, "a table-by-table delete crept into account deletion");
  assert.match(deletion, /from\("visitor_accounts"\)\.delete\(\)\.eq\("id", accountId\)/);
  assert.match(deletion, /auth\.admin\.deleteUser\(userId, false\)/);
  assert.ok(!lifecycle.includes("processDeletion("), "the old table-by-table deletion is back");
});

test("account deletion reads staff membership and never writes it", () => {
  // The deletion job is the one FaithForm module that must look at
  // church_users: a row there is why a sign-in is kept. Looking is all it
  // may do.
  assert.match(deletion, /table: "church_users", column: "user_id"/);
  assert.match(deletion, /\.from\(dependent\.table\)\s*\.select\(dependent\.column\)/);
  assert.ok(!/from\(dependent\.table\)\s*\.(insert|update|upsert|delete)\(/.test(deletion));
  assert.ok(!deletion.includes('from("church_users")'));
});

// ---------------------------------------------------------------------------
// No automatic linking to an existing person
// ---------------------------------------------------------------------------
//
// Migration 0083 supersedes "a link is only ever created by staff approval"
// with a narrower rule: joining a church links the account to a People record
// *it just created* from its own name. Linking an account to a record that
// already existed still takes a staff member naming that record.

test("in the dashboard, a link is only ever created by an explicit staff approval", () => {
  const inserts = claims.match(/from\("visitor_people_links"\)\s*\.insert\(/g) ?? [];
  assert.equal(inserts.length, 1, "exactly one code path may create a link");
  assert.ok(
    !/from\("visitor_people_links"\)\s*\.(insert|update|upsert)\(/.test(appPeople),
    "app-people must go through the database functions",
  );

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

test("joining links an account only to a People record made for it, from its name", () => {
  const connect = sqlFunction(appPeopleMigration, "connect_app_member");

  // One link insert, and its member is the row inserted just above it.
  const linkInserts = connect.match(/insert into public\.visitor_people_links/g) ?? [];
  assert.equal(linkInserts.length, 1);
  assert.match(
    connect,
    /insert into public\.members \(church_id, first_name, last_name, is_active, source\)[\s\S]*?returning id into v_member_id;\s*insert into public\.visitor_people_links \([\s\S]*?\) values \(\s*p_account_id, p_church_id, v_member_id,/,
  );
  assert.equal((connect.match(/into v_member_id/g) ?? []).length, 1, "v_member_id has one source");

  // Someone by the same name already in People is a question, not an answer.
  assert.match(connect, /public\.person_name_key\(m\.first_name, m\.last_name\) = lower\(v_name\)/);
  assert.match(connect, /insert into public\.visitor_people_claims[\s\S]*?'join'/);

  // Contact details never decide anything, and never reach the church.
  assert.doesNotMatch(connect, /email|phone/i);
  assert.doesNotMatch(sqlFunction(appPeopleMigration, "app_account_name"), /email|phone/i);
});

test("staff answers to app members are single database calls, gated like every claim action", () => {
  for (const [rpc, fn] of [
    ["connect_app_member", "connectAppMember"],
    ["add_people_claim_as_new_person", "addClaimAsNewPerson"],
    ["move_people_link", "moveAppConnection"],
  ] as const) {
    assert.match(appPeople, new RegExp(`export async function ${fn}\\(`));
    assert.match(appPeople, new RegExp(`rpc\\("${rpc}"`));
  }

  for (const action of [
    "approvePeopleClaim",
    "addPeopleClaimAsNewPerson",
    "addAppMemberToPeople",
    "moveAppConnectionToPerson",
    "rejectPeopleClaim",
    "revokePeopleLink",
    "decideVisitorRelationship",
  ]) {
    const start = claimActions.indexOf(`export async function ${action}(`);
    assert.ok(start >= 0, `${action} is missing`);
    const body = claimActions.slice(start, claimActions.indexOf("\n}\n", start));
    assert.match(body, /await requirePeopleAdmin\(\)/, `${action} must require a People admin`);
  }

  // Each database function takes the church explicitly and matches rows on it,
  // so an id from another church finds nothing.
  for (const name of ["add_people_claim_as_new_person", "move_people_link"]) {
    assert.match(sqlFunction(appPeopleMigration, name), /church_id = p_church_id/);
  }
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
  // Bounded to the listing itself. Slicing to end-of-file made this a tripwire
  // on any function added below it, including ones that legitimately look an
  // invitation *up* by hash — which is how every read of the table works.
  const list = invitations.slice(
    invitations.indexOf("export async function listInvitations"),
    invitations.indexOf("export async function revokeInvitation"),
  );
  assert.ok(!list.includes("token_hash"));
});

test("previewing an invitation reads by hash and never spends or returns it", () => {
  const preview = invitations.slice(invitations.indexOf("export async function previewInvitation"));
  // Looked up by hash like every other read, and the hash never comes back out.
  assert.match(preview, /\.eq\("token_hash", hashInvitationToken\(rawToken\)\)/);
  assert.ok(!/return\s*\{[\s\S]{0,200}token/.test(preview));
  // Read-only: no update, no rpc, nothing that could burn a single-use link on
  // a screen the person has not finished yet.
  assert.ok(!preview.includes(".update("));
  // The *call*, not the mention: the doc comment names the consumer it mirrors.
  assert.ok(!/rpc\("consume_visitor_invitation"/.test(preview));
  // The same gates redemption applies, so an expired or revoked link cannot be
  // previewed into a church name.
  for (const gate of ["revoked_at", "expires_at", "used_count", "max_uses"]) {
    assert.ok(preview.includes(gate), `preview must check ${gate}`);
  }
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

test("no FaithForm module logs tokens, contacts, coordinates or People data", () => {
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
