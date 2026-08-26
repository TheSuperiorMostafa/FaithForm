import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

process.env.ATTENDANCE_QR_SECRET =
  "attendance-qr-secret-that-is-at-least-32-bytes-long";

import {
  CAPABILITY_TYPES,
  MAX_TOKEN_LENGTH,
  checkinSigningStatus,
  derivedValue,
  keyedHash,
  keyedHashCandidates,
  mintCapability,
  packUuid,
  unpackUuid,
  verifyCapability,
} from "@/lib/attendance/v2/signing";
import {
  SHORT_CODE_ALPHABET,
  SHORT_CODE_LENGTH,
  deriveShortCode,
  formatShortCode,
  normalizeShortCode,
  shortCodeCandidatesForWindow,
} from "@/lib/attendance/v2/short-code";
import { windowIndexFor } from "@/lib/attendance/v2/checkin-session";
import {
  generateKioskCredential,
  hashKioskCredential,
  kioskHashesMatch,
} from "@/lib/attendance/v2/kiosk";
import {
  ATTENDANCE_OUTCOMES,
  ATTENDANCE_REASONS,
  displayMessageFor,
  mobileCodeForAttendanceReason,
  type AttendanceReason,
} from "@/lib/attendance/v2/results";

const CHURCH = "11111111-1111-4111-8111-111111111111";
const OCCURRENCE = "22222222-2222-4222-8222-222222222222";
const SESSION = "55555555-5555-4555-8555-555555555555";

// ---------------------------------------------------------------------------
// Signed capabilities
//
// Prompt 6 signed a fifteen-minute QR with one unversioned key and no notion of
// what the signature was *for*. Every property that file was asserted to have is
// asserted here of what replaced it, plus the three it never had: key versions,
// domain separation, and a rotation grace.
// ---------------------------------------------------------------------------

test("a capability round-trips and is bound to its session and occurrence", () => {
  const token = mintCapability("checkin.qr", {
    v: 2,
    s: packUuid(SESSION),
    o: packUuid(OCCURRENCE),
    w: 100,
    n: "abc",
    e: 9_999_999_999,
  })!;

  const verified = verifyCapability<Record<string, string>>("checkin.qr", token);
  assert.ok(verified.ok);
  assert.equal(verified.ok && unpackUuid(verified.body.s), SESSION);
  assert.equal(verified.ok && unpackUuid(verified.body.o), OCCURRENCE);
});

test("a capability contains no secret and no People data", () => {
  const token = mintCapability("checkin.qr", {
    v: 2, s: packUuid(SESSION), o: packUuid(OCCURRENCE), w: 1, n: "abc", e: 9_999_999_999,
  })!;
  const raw = Buffer.from(token.split(".")[2], "base64url").toString("utf8");

  assert.ok(!raw.includes(process.env.ATTENDANCE_QR_SECRET!));
  for (const forbidden of ["member", "email", "phone", "name", "account", "lat", "lon"]) {
    assert.ok(!raw.toLowerCase().includes(forbidden), `capability leaks ${forbidden}`);
  }
});

test("a token minted for one purpose never verifies as another", () => {
  // **The property Prompt 6 had no way to express.** A display capability and a
  // check-in token are signed under sub-keys derived from different labels, so
  // presenting one as the other fails at the signature — not at a claim check
  // that someone could forget to write.
  const display = mintCapability("checkin.display", {
    v: 2, s: packUuid(SESSION), o: packUuid(OCCURRENCE), c: packUuid(CHURCH), e: 9_999_999_999,
  })!;

  assert.equal(verifyCapability("checkin.display", display).ok, true);
  const crossed = verifyCapability("checkin.qr", display);
  assert.equal(crossed.ok, false);
  assert.equal(crossed.ok === false && crossed.reason, "bad_signature");
});

test("every declared capability type is separately keyed", () => {
  const tokens = new Map<string, string>();
  for (const type of CAPABILITY_TYPES) {
    const token = mintCapability(type, { v: 2, x: "same-body-every-time" });
    if (token) tokens.set(type, token);
  }
  assert.ok(tokens.size >= 5);

  // Identical bodies, different signatures — which is what proves the sub-keys
  // are genuinely distinct rather than the same key with a label attached.
  const signatures = new Set([...tokens.values()].map((token) => token.split(".")[3]));
  assert.equal(signatures.size, tokens.size);

  for (const [mintedAs, token] of tokens) {
    for (const type of CAPABILITY_TYPES) {
      if (type === mintedAs) continue;
      assert.equal(
        verifyCapability(type, token).ok,
        false,
        `${mintedAs} verified as ${type}`,
      );
    }
  }
});

test("a tampered body fails before any of its contents are trusted", () => {
  const token = mintCapability("checkin.qr", {
    v: 2, s: packUuid(SESSION), o: packUuid(OCCURRENCE), w: 1, n: "abc", e: 9_999_999_999,
  })!;
  const [format, keyId, payload, signature] = token.split(".");

  const forged = Buffer.from(
    JSON.stringify({
      t: "checkin.qr", v: 2,
      s: packUuid("44444444-4444-4444-8444-444444444444"),
      o: packUuid(OCCURRENCE), w: 1, n: "abc", e: 9_999_999_999,
    }),
    "utf8",
  ).toString("base64url");

  assert.equal(
    verifyCapability("checkin.qr", `${format}.${keyId}.${forged}.${signature}`).ok,
    false,
  );

  const flipped = `${signature[0] === "A" ? "B" : "A"}${signature.slice(1)}`;
  assert.equal(
    verifyCapability("checkin.qr", `${format}.${keyId}.${payload}.${flipped}`).ok,
    false,
  );
});

test("malformed input is refused rather than parsed", () => {
  for (const bad of [
    "", "nodot", "a.b.c", "FF1..x.y", "x".repeat(MAX_TOKEN_LENGTH + 1),
    "FF2.abc.def.ghi", null, undefined,
  ]) {
    assert.equal(
      verifyCapability("checkin.qr", bad as string).ok,
      false,
      String(bad).slice(0, 12),
    );
  }
});

test("a weak, placeholder, or absent key refuses to sign at all", () => {
  const original = process.env.ATTENDANCE_QR_SECRET;
  const body = { v: 2, s: packUuid(SESSION), o: packUuid(OCCURRENCE), w: 1, n: "a", e: 1 };

  for (const bad of ["too-short", "replace-me-with-a-real-secret-value-here"]) {
    process.env.ATTENDANCE_QR_SECRET = bad;
    assert.equal(mintCapability("checkin.qr", body), null, bad);
    assert.equal(keyedHash("shortcode", "BCDFGHJ"), null, bad);
    assert.equal(checkinSigningStatus().configured, false, bad);
  }

  delete process.env.ATTENDANCE_QR_SECRET;
  assert.equal(mintCapability("checkin.qr", body), null);
  // And verification refuses rather than accepting anything.
  assert.equal(verifyCapability("checkin.qr", "FF1.a.b.c").ok, false);

  process.env.ATTENDANCE_QR_SECRET = original;
  assert.equal(checkinSigningStatus().configured, true);
});

// ---------------------------------------------------------------------------
// Key rotation
// ---------------------------------------------------------------------------

test("a token survives a rotation while the previous key is still installed", () => {
  const original = process.env.ATTENDANCE_QR_SECRET!;
  const body = {
    v: 2, s: packUuid(SESSION), o: packUuid(OCCURRENCE), w: 1, n: "abc", e: 9_999_999_999,
  };

  const beforeRotation = mintCapability("checkin.qr", body)!;
  const oldKeyId = checkinSigningStatus().activeKeyId;

  // Rotate: yesterday's key moves to the grace slot, a new one takes over.
  process.env.ATTENDANCE_QR_SECRET_PREVIOUS = original;
  process.env.ATTENDANCE_QR_SECRET = "a-completely-different-attendance-key-value-32";

  const status = checkinSigningStatus();
  assert.equal(status.inRotation, true);
  assert.equal(status.acceptedKeyIds.length, 2);
  assert.notEqual(status.activeKeyId, oldKeyId);

  // The code already on the projector keeps working.
  assert.equal(verifyCapability("checkin.qr", beforeRotation).ok, true);
  // And new codes are minted under the new key.
  const afterRotation = mintCapability("checkin.qr", body)!;
  assert.equal(afterRotation.split(".")[1], status.activeKeyId);

  // Removing the grace slot ends the grace, which is what makes rotation
  // finish rather than accumulate keys forever.
  delete process.env.ATTENDANCE_QR_SECRET_PREVIOUS;
  const stale = verifyCapability("checkin.qr", beforeRotation);
  assert.equal(stale.ok, false);
  assert.equal(stale.ok === false && stale.reason, "unknown_key");

  process.env.ATTENDANCE_QR_SECRET = original;
});

test("a key id reveals nothing about the key", () => {
  const status = checkinSigningStatus();
  const secret = process.env.ATTENDANCE_QR_SECRET!;
  assert.ok(status.activeKeyId);
  assert.ok(!secret.includes(status.activeKeyId!));
  assert.ok(!status.activeKeyId!.includes(secret.slice(0, 8)));
  assert.ok(status.activeKeyId!.length <= 12);
});

test("a stored hash resolves under the previous key during the grace", () => {
  const original = process.env.ATTENDANCE_QR_SECRET!;
  const stored = keyedHash("shortcode", "BCD4G7J")!;

  process.env.ATTENDANCE_QR_SECRET_PREVIOUS = original;
  process.env.ATTENDANCE_QR_SECRET = "a-completely-different-attendance-key-value-32";

  const candidates = keyedHashCandidates("shortcode", "BCD4G7J");
  assert.equal(candidates.length, 2);
  // Current key first — the common case is one index probe, not two.
  assert.notEqual(candidates[0], stored);
  assert.equal(candidates[1], stored);

  delete process.env.ATTENDANCE_QR_SECRET_PREVIOUS;
  process.env.ATTENDANCE_QR_SECRET = original;
});

// ---------------------------------------------------------------------------
// Rotation windows
// ---------------------------------------------------------------------------

test("the rotation window is epoch-aligned, so two displays agree without talking", () => {
  // The property the whole display design rests on: a second tab, a reload and
  // a late poll all land on the same window because none of them chose it.
  assert.equal(windowIndexFor(1_800_000_000, 30), windowIndexFor(1_800_000_029, 30));
  assert.notEqual(windowIndexFor(1_800_000_029, 30), windowIndexFor(1_800_000_030, 30));
  assert.equal(windowIndexFor(1_800_000_000, 30), 60_000_000);
});

test("the QR nonce is a function of the session and window, not of chance", () => {
  const first = derivedValue("checkin.qr", `${SESSION}|100`, 12);
  const again = derivedValue("checkin.qr", `${SESSION}|100`, 12);
  const next = derivedValue("checkin.qr", `${SESSION}|101`, 12);
  const other = derivedValue("checkin.qr", `${OCCURRENCE}|100`, 12);

  assert.equal(first, again, "a re-poll would have rotated the code early");
  assert.notEqual(first, next);
  assert.notEqual(first, other);
});

test("a nonce is unpredictable without the key", () => {
  const original = process.env.ATTENDANCE_QR_SECRET!;
  const underOneKey = derivedValue("checkin.qr", `${SESSION}|100`, 12);

  process.env.ATTENDANCE_QR_SECRET = "a-completely-different-attendance-key-value-32";
  assert.notEqual(derivedValue("checkin.qr", `${SESSION}|100`, 12), underOneKey);

  process.env.ATTENDANCE_QR_SECRET = original;
});

test("packed identifiers survive the round trip and reject anything else", () => {
  assert.equal(unpackUuid(packUuid(SESSION)!), SESSION);
  assert.equal(packUuid(SESSION)!.length, 22);
  // Anything that is not exactly 22 base64url characters is refused. Note what
  // is *not* claimed: 22 valid characters always decode to some uuid, because
  // they are just sixteen bytes. That is fine — the session id lives inside a
  // signed body, so nobody gets to choose it, and whether it names a real
  // session is settled by the database lookup rather than by its shape.
  for (const bad of [
    "", "not-a-uuid", "z".repeat(21), "z".repeat(23),
    packUuid(SESSION)!.slice(0, 21), "!!!!!!!!!!!!!!!!!!!!!!",
  ]) {
    assert.equal(unpackUuid(bad), null, bad.slice(0, 10));
  }
  assert.equal(packUuid("nope"), null);
  assert.equal(packUuid(""), null);
});

// ---------------------------------------------------------------------------
// Short codes
// ---------------------------------------------------------------------------

test("the alphabet removes every confusable pair", () => {
  // One side of each pair is gone, rather than both sides being kept and a
  // font being trusted to distinguish them on a projector.
  for (const excluded of ["0", "O", "1", "I", "2", "Z", "5", "S", "6", "8", "U"]) {
    assert.ok(
      !SHORT_CODE_ALPHABET.includes(excluded),
      `${excluded} is confusable and should not be in the alphabet`,
    );
  }
  // No vowels, so the generator cannot produce a word.
  for (const vowel of ["A", "E", "I", "O", "U"]) {
    assert.ok(!SHORT_CODE_ALPHABET.includes(vowel), `${vowel} allows words`);
  }
  assert.equal(new Set(SHORT_CODE_ALPHABET).size, SHORT_CODE_ALPHABET.length);
  // 23 characters over 7 positions is about 31.6 bits.
  assert.ok(Math.log2(SHORT_CODE_ALPHABET.length ** SHORT_CODE_LENGTH) > 31);
});

test("a short code is derived, stable, and distinct per window", () => {
  const code = deriveShortCode(SESSION, 100)!;
  assert.equal(code.length, SHORT_CODE_LENGTH);
  assert.equal(deriveShortCode(SESSION, 100), code);
  assert.notEqual(deriveShortCode(SESSION, 101), code);
  assert.notEqual(deriveShortCode(OCCURRENCE, 100), code);
  for (const character of code) assert.ok(SHORT_CODE_ALPHABET.includes(character));
});

test("a collision retry produces a different code, deterministically", () => {
  const first = deriveShortCode(SESSION, 100, 0);
  const second = deriveShortCode(SESSION, 100, 1);
  assert.notEqual(first, second);
  assert.equal(deriveShortCode(SESSION, 100, 1), second);

  const { codes, hashes } = shortCodeCandidatesForWindow(SESSION, 100);
  assert.equal(codes.length, 4);
  assert.equal(new Set(codes).size, 4);
  assert.equal(new Set(hashes).size, 4);
  assert.equal(codes[0], first);
});

test("character selection is unbiased", () => {
  // Rejection sampling rather than modulo. A biased generator would make the
  // first few characters of the alphabet measurably more common, which is a
  // small but free loss of entropy.
  const counts = new Map<string, number>();
  for (let window = 0; window < 3000; window += 1) {
    for (const character of deriveShortCode(SESSION, window)!) {
      counts.set(character, (counts.get(character) ?? 0) + 1);
    }
  }
  assert.equal(counts.size, SHORT_CODE_ALPHABET.length);

  const expected = (3000 * SHORT_CODE_LENGTH) / SHORT_CODE_ALPHABET.length;
  for (const [character, count] of counts) {
    assert.ok(
      Math.abs(count - expected) < expected * 0.25,
      `${character} appeared ${count} times, expected about ${Math.round(expected)}`,
    );
  }
});

test("typing is forgiving about case and separators and nothing else", () => {
  const code = deriveShortCode(SESSION, 100)!;
  const formatted = formatShortCode(code);

  assert.equal(normalizeShortCode(formatted), code);
  assert.equal(normalizeShortCode(code.toLowerCase()), code);
  assert.equal(normalizeShortCode(` ${formatted} `), code);
  assert.equal(normalizeShortCode(formatted.replace("-", "\u2014")), code);
});

test("no substitution table turns a typo into a different valid code", () => {
  // Every character a substitution table would map is already absent from the
  // alphabet, so mapping one could only mean silently checking someone into a
  // service they did not choose.
  for (const attempt of ["OOOOOOO", "1111111", "SSSSSSS", "AAAAAAA", "ZZZZZZZ"]) {
    assert.equal(normalizeShortCode(attempt), null, attempt);
  }
});

test("anything that is not exactly one code is refused", () => {
  const code = deriveShortCode(SESSION, 100)!;
  for (const bad of [
    "", "BCD", code + "B", "%", "BCD-4G7J-BCD", "B".repeat(200), null, undefined,
  ]) {
    assert.equal(normalizeShortCode(bad as string), null, String(bad).slice(0, 12));
  }
});

test("a stored code hash is keyed, not a plain digest", () => {
  const code = deriveShortCode(SESSION, 100)!;
  const hash = keyedHash("shortcode", code)!;

  assert.match(hash, /^[0-9a-f]{64}$/);
  assert.ok(!hash.includes(code));

  // The point of the key: a plain SHA-256 of a 31-bit code is exhaustible from
  // a leaked table in seconds. This must not equal one.
  assert.notEqual(hash, createHash("sha256").update(code).digest("hex"));
});

// ---------------------------------------------------------------------------
// Kiosk credentials
// ---------------------------------------------------------------------------

test("kiosk credentials are high-entropy and never repeat", () => {
  const credentials = new Set<string>();
  for (let i = 0; i < 200; i++) credentials.add(generateKioskCredential());
  assert.equal(credentials.size, 200);
  assert.ok(generateKioskCredential().length >= 43);
});

test("only the hash is suitable for storage", () => {
  const credential = generateKioskCredential();
  const hash = hashKioskCredential(credential);

  assert.equal(hash, hashKioskCredential(credential));
  assert.notEqual(hash, credential);
  assert.match(hash, /^[0-9a-f]{64}$/);
  assert.ok(!hash.includes(credential));
});

test("hash comparison is length-safe", () => {
  const hash = hashKioskCredential("a");
  assert.equal(kioskHashesMatch(hash, hashKioskCredential("a")), true);
  assert.equal(kioskHashesMatch(hash, hashKioskCredential("b")), false);
  assert.equal(kioskHashesMatch(hash, hash.slice(0, 40)), false);
});

// ---------------------------------------------------------------------------
// Result vocabulary
// ---------------------------------------------------------------------------

test("every reason maps to a mobile error code", () => {
  for (const reason of ATTENDANCE_REASONS) {
    const code = mobileCodeForAttendanceReason(reason);
    assert.ok(code.length > 0, `${reason} has no mapping`);
  }
  // An unmapped reason degrades safely rather than leaking its name.
  assert.equal(
    mobileCodeForAttendanceReason("some_future_reason" as AttendanceReason),
    "internal_error",
  );
});

test("already-counted is a success, not an error", () => {
  assert.equal(mobileCodeForAttendanceReason("already_counted"), "ok");
  assert.equal(mobileCodeForAttendanceReason("ok"), "ok");
  assert.equal(mobileCodeForAttendanceReason("awaiting_dwell"), "ok");
  assert.ok(ATTENDANCE_OUTCOMES.includes("already_counted"));
});

test("a failed location attempt never says why", () => {
  // Telling someone they were "42 m outside" is a hint for anyone trying to
  // spoof it, so both failures read identically.
  assert.equal(
    displayMessageFor("outside_region"),
    displayMessageFor("insufficient_accuracy"),
  );

  for (const reason of ATTENDANCE_REASONS) {
    const message = displayMessageFor(reason);
    assert.ok(message.length > 0, `${reason} has no message`);
    for (const leak of ["metre", "meter", "radius", "coordinate", "latitude", "accuracy of"]) {
      assert.ok(
        !message.toLowerCase().includes(leak),
        `message for ${reason} leaks "${leak}"`,
      );
    }
  }
});

test("a member-tenant mismatch is reported generically", () => {
  // Confirming that a member id was wrong *for this tenant* would be a probe.
  assert.equal(mobileCodeForAttendanceReason("member_not_in_church"), "forbidden");
});

test("consent states are distinguishable to the caller but not to a prober", () => {
  assert.equal(mobileCodeForAttendanceReason("consent_required"), "forbidden");
  assert.equal(mobileCodeForAttendanceReason("consent_revoked"), "forbidden");
  // The person sees the same actionable sentence either way.
  assert.equal(
    displayMessageFor("consent_required"),
    displayMessageFor("consent_revoked"),
  );
});
