import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import test from "node:test";

/**
 * The authority rules for QR, short-code and kiosk check-in.
 *
 * Prompt 6 established one and only one way a counted fact may come into
 * existence. Prompt 8 adds three new callers — a scanner, a typed code, and a
 * welcome desk — and every one of them has to be a *caller* of that authority
 * rather than a second one. These sweeps are what makes that structural.
 *
 * Non-vacuity is handled the same way as `checkin-privacy.test.ts`: real file
 * lists with minimum counts, and an injected violation at the end that must
 * make a sweep fail.
 */

const read = (path: string) => readFileSync(path, "utf8");

function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/\/.*$/gm, "")
    .replace(/\/\/.*$/gm, "");
}

function walk(dir: string, extension: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) found.push(...walk(path, extension));
    else if (extname(entry) === extension) found.push(path);
  }
  return found;
}

const migration = read("supabase/migrations/0059_attendance_checkin_sessions.sql");
const signing = read("lib/attendance/v2/signing.ts");
const shortCode = read("lib/attendance/v2/short-code.ts");
const session = read("lib/attendance/v2/checkin-session.ts");
const kioskSession = read("lib/attendance/v2/kiosk-session.ts");
const mobileService = read("lib/mobile/v1/attendance-service.ts");
const checkinRoutes = walk("app/api/checkin", ".ts");

test("the swept sets are real", () => {
  assert.ok(migration.length > 20_000, `migration is only ${migration.length} bytes`);
  assert.ok(checkinRoutes.length >= 6, `only ${checkinRoutes.length} check-in routes`);
  for (const source of [signing, shortCode, session, kioskSession, mobileService]) {
    assert.ok(source.length > 2_000);
  }
});

// ---------------------------------------------------------------------------
// One authority
// ---------------------------------------------------------------------------

/**
 * Finds a *write* to an attendance table, as opposed to a read of one.
 *
 * The distinction matters and an earlier version of this sweep got it wrong:
 * the kiosk search legitimately **reads** `attendance_facts` to show a
 * volunteer that someone is already checked in, and forbidding the table name
 * outright made that a violation. The rule is not "never mention the table" —
 * it is "never create or change a counted fact outside the one command".
 */
function attendanceWrites(source: string): string[] {
  const code = stripComments(source);
  const found: string[] = [];

  for (const table of ["attendance_facts", "attendance_attempts"]) {
    for (const match of code.matchAll(new RegExp(`from\\("${table}"\\)`, "g"))) {
      // A Supabase builder chains the verb after `.from(...)`, so the window
      // just past it is where a write would be.
      const window = code.slice(match.index ?? 0, (match.index ?? 0) + 240);
      for (const verb of [".insert(", ".upsert(", ".update(", ".delete("]) {
        if (window.includes(verb)) found.push(`${table}${verb}`);
      }
    }
    for (const sql of [`insert into public.${table}`, `insert into ${table}`, `update public.${table}`]) {
      if (code.includes(sql)) found.push(sql);
    }
  }
  return found;
}

test("no check-in path writes an attendance fact directly", () => {
  // The rule the whole attendance design rests on. A kiosk-shaped insert, or a
  // QR-shaped one, would be a second authority with its own validation, its own
  // idea of the window, and its own bugs.
  const sources: [string, string][] = [
    ["session", session],
    ["kiosk-session", kioskSession],
    ["mobile-service", mobileService],
    ...checkinRoutes.map((file) => [file, read(file)] as [string, string]),
  ];

  for (const [name, source] of sources) {
    assert.deepEqual(attendanceWrites(source), [], `${name} writes attendance directly`);
  }
});

test("the kiosk may read attendance, and only read it", () => {
  // The read this sweep must not forbid: a volunteer needs to see that someone
  // is already counted, or they tap the same name twice.
  const code = stripComments(kioskSession);
  assert.ok(code.includes('from("attendance_facts")'), "the already-counted read is gone");
  assert.match(code, /\.select\("member_id, status"\)/);
  assert.deepEqual(attendanceWrites(kioskSession), []);
});

test("the kiosk check-in goes through record_attendance and nothing else", () => {
  const code = stripComments(kioskSession);
  assert.match(code, /return recordAttendance\(/);
  assert.match(code, /source: "kiosk"/);
  assert.match(code, /actorType: "kiosk"/);
  // From the session, never from the request. A request naming an occurrence
  // would be a request to check into a different service.
  assert.match(code, /occurrenceId: input\.session\.occurrenceId/);
});

test("migration 0059 creates no path to a counted fact", () => {
  const sql = migration.replace(/--.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
  // The one thing an additive migration must not do here: teach a new function
  // to write attendance. Every new function reads or writes capabilities.
  assert.ok(!/insert\s+into\s+public\.attendance_facts/i.test(sql));
  assert.ok(!/insert\s+into\s+public\.attendance_attempts/i.test(sql));
  assert.ok(!/update\s+public\.attendance_facts/i.test(sql));
});

test("0055 through 0058 are untouched by this prompt", () => {
  // Stated as a rule and enforced as one: the earlier migrations must not have
  // grown a Prompt 8 concept.
  for (const file of [
    "supabase/migrations/0055_attendance_authority.sql",
    "supabase/migrations/0056_attendance_batch.sql",
    "supabase/migrations/0057_attendance_report_totals.sql",
    "supabase/migrations/0058_attendance_detections.sql",
  ]) {
    const sql = read(file);
    for (const prompt8 of [
      "attendance_checkin_sessions",
      "attendance_checkin_codes",
      "attendance_display_pairings",
      "attendance_kiosk_sessions",
      "attendance_qr_scan_redemptions",
    ]) {
      assert.ok(!sql.includes(prompt8), `${file} mentions ${prompt8}`);
    }
  }
});

// ---------------------------------------------------------------------------
// Identity comes from the People link, never from a code
// ---------------------------------------------------------------------------

test("a scanned code resolves a service, never a person", () => {
  const submit = mobileService.slice(mobileService.indexOf("export async function submitAttempt"));
  const code = stripComments(submit);

  // The People link is the gate, and it is resolved from the authenticated
  // account — not from anything the code carried.
  assert.match(code, /resolveSelfCheckInMember\(account\.id, churchId, admin\)/);
  assert.match(code, /if \(!link\.ok\) return reject/);

  // And nothing matches a person by a contact detail or a device.
  for (const forbidden of ["by_email", "byEmail", "byPhone", "deviceId", "matchByName"]) {
    assert.ok(!code.includes(forbidden), `submitAttempt matches identity by ${forbidden}`);
  }
});

test("the occurrence comes out of the code, not out of the request", () => {
  const submit = mobileService.slice(mobileService.indexOf("export async function submitAttempt"));
  const code = stripComments(submit);

  // A client that could name the occurrence could scan the 9am code and have
  // it counted against the 11am service.
  assert.match(code, /occurrenceId = redemption\.resolved\.occurrenceId/);
  assert.match(code, /source === "qr"/);
});

test("the kiosk search returns three fields and cannot be widened", () => {
  const code = stripComments(kioskSession);

  // Exactly the columns a check-in desk needs. No email, no phone, no address,
  // no notes, no giving — none of it selected, so none of it can leak through
  // a serialisation mistake.
  assert.match(code, /\.select\("id, first_name, last_name"\)/);
  for (const forbidden of ["email", "phone", "address", "notes", "birth", "household"]) {
    assert.ok(!code.includes(`"${forbidden}`), `the kiosk search selects ${forbidden}`);
  }

  // The anti-browsing controls, all four.
  assert.match(code, /MIN_SEARCH_LENGTH = 3/);
  assert.match(code, /MAX_SEARCH_RESULTS = 8/);
  assert.match(code, /if \(query\.length < MIN_SEARCH_LENGTH\) return \{ people: \[\], truncated: false \}/);
  // Prefix, not substring: `%son%` would surface every Johnson from three
  // characters.
  assert.ok(!code.includes("%${escape("), "the search matches a substring");
  assert.match(code, /\$\{escape\(parts\[0\]\)\}%/);
  // And the LIKE metacharacters are escaped, or `%` alone matches everyone.
  assert.match(code, /replace\(\/\(\[\\\\%_\]\)\/g/);
});

test("a kiosk credential reaches one occurrence and confers no role", () => {
  const code = stripComments(kioskSession);
  // What a resolved kiosk is: an occurrence, a church, a campus. No user id, no
  // role, no session, and nothing that could administer anything.
  const type = code.slice(code.indexOf("type KioskSession"), code.indexOf("// ----", code.indexOf("type KioskSession")));
  for (const forbidden of ["userId", "role", "isAdmin", "accessToken", "serviceRole"]) {
    assert.ok(!type.includes(forbidden), `KioskSession carries ${forbidden}`);
  }
  assert.match(type, /occurrenceId: string/);
  assert.match(type, /churchId: string/);
});

// ---------------------------------------------------------------------------
// A displayed code is multi-use
// ---------------------------------------------------------------------------

test("nothing consumes a rotating code on first use", () => {
  // **The Prompt 6 behaviour this replaces.** A global nonce lock meant the
  // first person to scan the projector took the code and everyone else in the
  // room was told it had already been used.
  const sql = migration.replace(/--.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");

  const redeem = sql.slice(sql.indexOf("function public.redeem_attendance_short_code"));
  const body = redeem.slice(0, redeem.indexOf("$$;"));
  assert.ok(!/update\s+public\.attendance_checkin_codes/i.test(body),
    "resolving a short code marks it used");

  // The per-account redemption index, which is what replaced the global one.
  assert.match(
    sql,
    /attendance_qr_scan_redemptions_account_idx[\s\S]{0,160}\(service_occurrence_id, account_id, nonce\)/,
  );
});

test("the old globally-consuming path is gone from the codebase", () => {
  // `consumeQrNonce` refused a second redemption of a displayed code. Nothing
  // may call it, and it no longer exists.
  const allLib = walk("lib", ".ts");
  assert.ok(allLib.length > 40, `only ${allLib.length} lib files walked`);

  for (const file of allLib) {
    const code = stripComments(read(file));
    assert.ok(!code.includes("consumeQrNonce"), `${file} still calls consumeQrNonce`);
    assert.ok(!code.includes("attendance/v2/qr"), `${file} imports the removed qr module`);
  }
});

test("qr_replayed is retained for history but nothing produces it", () => {
  const results = read("lib/attendance/v2/results.ts");
  // Attempt rows already written with this reason must stay readable.
  assert.ok(results.includes('"qr_replayed"'));

  // But no production path may emit it any more.
  for (const file of [...walk("lib", ".ts"), ...walk("app/api", ".ts")]) {
    if (file.endsWith("results.ts")) continue;
    const code = stripComments(read(file));
    assert.ok(!code.includes("qr_replayed"), `${file} still produces qr_replayed`);
  }
});

// ---------------------------------------------------------------------------
// Codes are short-lived, and no permanent code exists
// ---------------------------------------------------------------------------

test("rotation is bounded at both ends and cannot be made permanent", () => {
  // A static printed code would let someone check in from home indefinitely,
  // which is the whole reason rotation exists.
  assert.match(migration, /rotation_seconds integer not null default 30/);
  assert.match(migration, /check \(rotation_seconds between 15 and 120\)/);

  const code = stripComments(session);
  assert.match(code, /MAX_ROTATION_SECONDS = 120/);
  assert.match(code, /Math\.min\(\s*MAX_ROTATION_SECONDS/);

  // Every session has a hard bound derived from the occurrence's own window.
  assert.match(migration, /expires_at timestamptz not null/);
  assert.match(migration, /bound := occ\.checkin_closes_at_utc/);
});

test("a capability's expiry is inside the signed body, not alongside it", () => {
  const code = stripComments(session);
  // `e` is signed, so a holder cannot extend it. An expiry carried outside the
  // signature would be a suggestion.
  assert.match(code, /mintCapability\("checkin\.qr", \{[\s\S]{0,200}e: acceptUntil/);
  assert.match(code, /if \(typeof body\.e !== "number" \|\| body\.e <= nowSeconds\(\)\)/);
});

test("a token alone is not enough — the session is re-checked every time", () => {
  const code = stripComments(session);
  // A signature cannot be revoked. This is the half that "stop the display"
  // acts on, and it is consulted on every redemption.
  assert.match(code, /resolveScannedToken[\s\S]{0,1200}resolve_attendance_checkin_session/);
  assert.match(code, /verifyDisplayCapability[\s\S]{0,1400}resolve_attendance_checkin_session/);
});

// ---------------------------------------------------------------------------
// Keys, hashes and domain separation
// ---------------------------------------------------------------------------

test("nothing that a person types is stored in the clear", () => {
  const sql = migration.replace(/--.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
  // Only hashes reach the database. A copy of it yields no working code.
  for (const column of ["code_hash", "pairing_code_hash", "credential_hash"]) {
    assert.ok(sql.includes(column), `${column} is missing`);
  }
  for (const forbidden of ["code text not null,", "credential text", "pairing_code text"]) {
    assert.ok(!sql.includes(forbidden), `${forbidden} stores a plaintext value`);
  }
});

test("stored hashes are keyed, because a typed code is short", () => {
  const code = stripComments(signing);
  // A 31-bit code under a plain digest is exhaustible from a leaked table in
  // seconds. The pepper is not in the database.
  assert.match(code, /export function keyedHash\([\s\S]{0,300}createHmac\("sha256", subKey\(type, key\.material\)\)/);
  assert.ok(!/createHash\("sha256"\)\.update\(code/.test(code));
});

test("every capability type derives its own sub-key", () => {
  const code = stripComments(signing);
  assert.match(code, /function subKey\(type: CapabilityType, material: string\): Buffer \{\s*return createHmac\("sha256", material\)\.update\(`\$\{DOMAIN\}\|\$\{type\}`\)/);
  // The issuer and audience are inside the derivation string, so a token from
  // another deployment or another product never verifies here.
  assert.match(code, /const DOMAIN = "faithform\.faithful\.attendance\.v1"/);
  // And nothing signs with the master key directly.
  assert.ok(
    !/createHmac\("sha256", key\.material\)\.update\(payload/.test(code),
    "something signs with the master key",
  );
});

test("only the current key may mint, and an unknown key id is refused", () => {
  const code = stripComments(signing);
  assert.match(code, /mintable: true/);
  assert.match(code, /mintable: false/);
  assert.match(code, /function mintingKey\(\)[\s\S]{0,140}find\(\(key\) => key\.mintable\)/);
  assert.match(code, /if \(!key\) return \{ ok: false, reason: "unknown_key" \}/);
});

test("verification refuses before it parses, and compares in constant time", () => {
  const code = stripComments(signing);
  // Shape, then key, then signature, then contents. Nothing inside the payload
  // is read until the signature over it has been proven.
  const verify = code.slice(code.indexOf("export function verifyCapability"));
  const signatureCheck = verify.indexOf("timingSafeEqual");
  const parse = verify.indexOf("JSON.parse");
  assert.ok(signatureCheck > 0 && parse > signatureCheck, "the body is parsed before the signature");
  assert.match(verify, /actual\.length !== expected\.length \|\| !timingSafeEqual/);
});

test("a weak key fails closed rather than falling back", () => {
  const code = stripComments(signing);
  assert.match(code, /if \(trimmed\.length < MIN_KEY_LENGTH\) return null/);
  assert.match(code, /if \(trimmed\.startsWith\("replace-me"\)\) return null/);
  // No default, no constant, no unsigned mode.
  assert.ok(!/\|\|\s*"dev-/.test(code), "there is a development fallback key");
});

// ---------------------------------------------------------------------------
// The alphabet is the same on all three platforms
// ---------------------------------------------------------------------------

test("the short-code alphabet has not drifted between server, iOS and Android", () => {
  // Drift would let one client refuse a code the server would have accepted,
  // which reads to a person as a broken code rather than a broken app.
  const expected = "BCDFGHJKLMNPQRTVWXY3479";

  assert.match(shortCode, new RegExp(`SHORT_CODE_ALPHABET = "${expected}"`));
  assert.match(shortCode, /SHORT_CODE_LENGTH = 7/);

  const swift = read("apps/faithful-ios/Sources/FaithfulKit/Attendance/QrScanning.swift");
  assert.match(swift, new RegExp(`alphabet = "${expected}"`));
  assert.match(swift, /length = 7/);

  const kotlin = read(
    "apps/faithful-android/core/attendance/src/main/kotlin/io/faithform/faithful/attendance/QrScanning.kt",
  );
  assert.match(kotlin, new RegExp(`ALPHABET = "${expected}"`));
  assert.match(kotlin, /LENGTH = 7/);

  // The pairing codes draw from the same alphabet, for the same reason.
  assert.match(session, new RegExp(`alphabet = "${expected}"`));
  assert.match(kioskSession, new RegExp(`alphabet = "${expected}"`));
});

// ---------------------------------------------------------------------------
// Rate limits and uniform errors
// ---------------------------------------------------------------------------

test("every typed-code path spends an atomic budget", () => {
  const service = stripComments(mobileService);
  assert.match(service, /SHORT_CODE_BUDGET = \{ limit: 10, windowMs: 5 \* 60 \* 1000 \}/);
  assert.match(service, /const throttled = await throttleCodeAttempt\(account\.id, input\)/);
  // The limiter is `consume_api_rate_limit`, which settles the count inside one
  // SQL statement rather than reading and then writing.
  const limiter = stripComments(read("lib/security/rate-limit.ts"));
  assert.match(limiter, /rpc\("consume_api_rate_limit"/);

  const http = stripComments(read("lib/attendance/v2/checkin-http.ts"));
  assert.match(http, /export async function throttleTypedCode/);
  for (const route of ["app/api/checkin/display/pair/route.ts", "app/api/checkin/kiosk/pair/route.ts"]) {
    assert.match(stripComments(read(route)), /await throttleTypedCode\(request,/);
  }
});

test("a rate-limit key never carries the code itself", () => {
  const service = stripComments(mobileService);
  // The limiter hashes and stores what it is given, so a raw code must not
  // reach it.
  assert.match(service, /`attendance:code:\$\{typed \? "typed" : "scan"\}:\$\{accountId\}`/);
  assert.ok(!/checkRateLimit\([^)]*shortCode/.test(service));
  assert.ok(!/checkRateLimit\([^)]*qrToken/.test(service));
});

test("every typed-code failure reads identically", () => {
  const service = stripComments(mobileService);
  // Unknown, expired, malformed and belonging-to-a-stopped-display collapse to
  // one reason. Telling someone which they hit tells them whether they guessed
  // a real code.
  assert.match(service, /if \(typed\) return reason === "unavailable" \? "internal_error" : "short_code_invalid"/);

  const routes = ["app/api/checkin/display/pair/route.ts", "app/api/checkin/kiosk/pair/route.ts"];
  for (const route of routes) {
    const code = stripComments(read(route));
    const errors = [...code.matchAll(/error: "([a-z_]+)"/g)].map((m) => m[1]);
    // Exactly two: one refusal for everything, and a throttle.
    assert.deepEqual([...new Set(errors)].sort(), ["invalid", "throttled"], route);
  }
});

test("an expired and an unknown pairing code are indistinguishable in SQL too", () => {
  const sql = migration.replace(/--.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
  const fn = sql.slice(sql.indexOf("function public.redeem_attendance_display_pairing"));
  const body = fn.slice(0, fn.indexOf("$$;"));
  // One reason for unknown, spent, and expired: the conditional update makes
  // all three miss identically.
  const reasons = [...body.matchAll(/select false, '([a-z_]+)'/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(reasons)].sort(), ["invalid", "malformed"]);
});

// ---------------------------------------------------------------------------
// The projector holds nothing but a display capability
// ---------------------------------------------------------------------------

test("no check-in route accepts a dashboard session as an alternative", () => {
  for (const route of checkinRoutes) {
    const code = stripComments(read(route));
    for (const forbidden of ["getChurchAuth", "requireChurchAdmin", "createClient(", "supabase.auth"]) {
      assert.ok(!code.includes(forbidden), `${route} accepts a dashboard session via ${forbidden}`);
    }
  }
});

test("the display and kiosk cookies are narrowly scoped", () => {
  const http = stripComments(read("lib/attendance/v2/checkin-http.ts"));
  assert.match(http, /const COOKIE_PATH = "\/api\/checkin"/);
  assert.match(http, /httpOnly: true/);
  assert.match(http, /sameSite: "strict"/);
  assert.match(http, /secure: process\.env\.NODE_ENV === "production"/);
});

test("the projector page reads nothing on the server", () => {
  // Server-rendering anything sensitive would embed it in HTML that sits on a
  // screen at the front of a room.
  for (const page of ["app/checkin/display/page.tsx", "app/checkin/kiosk/page.tsx"]) {
    const code = stripComments(read(page));
    for (const forbidden of ["cookies(", "createAdminClient", "getChurchAuth", "await "]) {
      assert.ok(!code.includes(forbidden), `${page} does server work via ${forbidden}`);
    }
    assert.match(code, /robots: \{ index: false, follow: false \}/);
  }
});

// ---------------------------------------------------------------------------
// Proof a sweep bites
// ---------------------------------------------------------------------------

test("the direct-write sweep fails on an injected violation", () => {
  // A green sweep that cannot fail is not evidence. This injects a real direct
  // insert into the real text of a real source file and requires the real sweep
  // to catch it.
  //
  // The injection is not written back to the working tree. `node --test` runs
  // test files in parallel, several of them read these same sources, and a
  // mid-flight injection is visible to all of them — a race that produced a
  // one-in-eight failure elsewhere in this suite. The sweep reads content, so
  // it never needed a file on disk to begin with.
  const target = "lib/attendance/v2/kiosk-session.ts";
  const original = readFileSync(target, "utf8");

  assert.deepEqual(attendanceWrites(original), [], "already failing before injection");

  const injected = original.replace(
    "export async function kioskCheckIn(",
    "async function leak() {\n" +
      '  await createAdminClient().from("attendance_facts").insert({ id: "x" });\n' +
      "}\n\nexport async function kioskCheckIn(",
  );
  assert.notEqual(injected, original, `the injection did not change ${target}`);

  assert.deepEqual(
    attendanceWrites(injected),
    ["attendance_facts.insert("],
    "the sweep did not catch a direct fact insert",
  );

  // The file on disk was never touched.
  assert.equal(readFileSync(target, "utf8"), original);
  assert.deepEqual(attendanceWrites(readFileSync(target, "utf8")), []);
});

test("a read of an attendance table is not mistaken for a write", () => {
  // The counterpart risk: a sweep that fired on the already-counted read would
  // be a permanent false positive, and would eventually be deleted rather than
  // fixed.
  const readOnly = `const { data } = await admin.from("attendance_facts").select("member_id, status");`;
  assert.deepEqual(attendanceWrites(readOnly), []);

  const write = `await admin.from("attendance_facts").insert({ member_id: id });`;
  assert.deepEqual(attendanceWrites(write), ["attendance_facts.insert("]);
});
