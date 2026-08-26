import { createHmac } from "node:crypto";

import { derivedValue, keyedHash, keyedHashCandidates } from "@/lib/attendance/v2/signing";

/**
 * The rotating short code shown beside the QR.
 *
 * It exists because a camera is not universally available: a cracked lens, a
 * denied permission, a phone too old for the scanner, a person who cannot hold
 * a device steady, or simply someone who would rather type. None of those people
 * should be told to find a staff member.
 *
 * It is the same capability as the QR beside it, in a form a person can read
 * aloud — same session, same rotation window, same nonce, same expiry. It is
 * **not** a weaker fallback with a longer life, because a longer-lived code is
 * exactly the remote-attendance hole rotation exists to close.
 */

/**
 * The alphabet.
 *
 * Every classic confusion pair is broken by removing one side rather than by
 * hoping a font distinguishes them, because the code is read off a projector at
 * distance by someone who is not looking for trouble:
 *
 *   `0`/`O` — both removed.   `1`/`I` — both removed (`L` survives alone).
 *   `2`/`Z` — both removed.   `5`/`S` — both removed.
 *   `6`/`G` — `6` removed.    `8`/`B` — `8` removed.
 *   `U`/`V` — `U` removed.
 *
 * Vowels are gone as a consequence, which has a second benefit worth stating:
 * without `A`, `E`, `I`, `O` or `U` the generator cannot accidentally produce a
 * word, and a church does not have to explain one on a screen at the front of a
 * sanctuary.
 *
 * 23 characters is 4.52 bits each.
 */
export const SHORT_CODE_ALPHABET = "BCDFGHJKLMNPQRTVWXY3479";

/**
 * Seven characters — about 31.6 bits, roughly 3.4 billion codes.
 *
 * Six would have been 27 bits. That is enough against a rate-limited attacker
 * guessing *one* church's current code, but not comfortable against the other
 * question: with many churches displaying at once, what is the chance a blind
 * guess lands on somebody's live code? Seven puts that back where it belongs
 * even at large scale. Eight was rejected as harder to read from the back of a
 * room than the security gain justified.
 */
export const SHORT_CODE_LENGTH = 7;

/** Displayed as `XXX-XXXX`. The separator is cosmetic and stripped on input. */
export const SHORT_CODE_GROUPS = [3, 4] as const;

/**
 * Derives the code for one rotation window.
 *
 * **Deterministic**, so two browser tabs, a reload, and a poll that arrives late
 * all produce the same characters without any of them storing or asking. The
 * randomness comes from the key, which is not in the database and never leaves
 * the server.
 *
 * `attempt` exists only for the rare case where a derived code collides with a
 * live code from another session. The database refuses that — a typed code must
 * resolve to exactly one session — and the caller retries with the next attempt.
 */
export function deriveShortCode(
  sessionId: string,
  windowIndex: number,
  attempt = 0,
): string | null {
  const seed = derivedValue("shortcode", `${sessionId}|${windowIndex}|${attempt}`, 32);
  if (!seed) return null;

  // Rejection sampling rather than modulo. 256 is not a multiple of 23, so
  // `byte % 23` would make the first three characters of the alphabet very
  // slightly more likely than the rest — a small bias, but a free one to avoid
  // and an awkward one to defend.
  const limit = 256 - (256 % SHORT_CODE_ALPHABET.length);
  let material = Buffer.from(seed, "base64url");
  let round = 0;
  const characters: string[] = [];

  while (characters.length < SHORT_CODE_LENGTH) {
    for (const byte of material) {
      if (byte >= limit) continue;
      characters.push(SHORT_CODE_ALPHABET[byte % SHORT_CODE_ALPHABET.length]);
      if (characters.length === SHORT_CODE_LENGTH) break;
    }

    if (characters.length === SHORT_CODE_LENGTH) break;

    // Vanishingly unlikely with 32 bytes and a 1.2% rejection rate, but a loop
    // that can run out of material and silently return a short code would be a
    // real bug. Extend deterministically instead.
    round += 1;
    if (round > 8) return null;
    material = createHmac("sha256", material).update(`extend|${round}`).digest();
  }

  return characters.join("");
}

/** `BCD4G7J` becomes `BCD-4G7J`. Presentation only. */
export function formatShortCode(code: string): string {
  const groups: string[] = [];
  let offset = 0;
  for (const size of SHORT_CODE_GROUPS) {
    groups.push(code.slice(offset, offset + size));
    offset += size;
  }
  const remainder = code.slice(offset);
  if (remainder) groups.push(remainder);
  return groups.filter(Boolean).join("-");
}

/**
 * Normalises what a person typed.
 *
 * Case is folded and separators are dropped, because nobody should fail for
 * typing a space. **Nothing is substituted.** There is no `O` → `0` table here
 * and there deliberately never will be: every character a substitution table
 * would map is already absent from the alphabet, so a substitution could only
 * turn one person's typo into a *different valid code* — quietly checking them
 * into the wrong service instead of telling them to look again.
 *
 * Returns `null` for anything that is not exactly one code.
 */
export function normalizeShortCode(input: string | null | undefined): string | null {
  if (typeof input !== "string") return null;
  // Bounded before any work: a megabyte of "B" is not a code.
  if (input.length > 64) return null;

  const stripped = input.toUpperCase().replace(/[\s‐-―-]/g, "");
  if (stripped.length !== SHORT_CODE_LENGTH) return null;

  for (const character of stripped) {
    if (!SHORT_CODE_ALPHABET.includes(character)) return null;
  }
  return stripped;
}

/**
 * The stored hash for a code. Keyed, because the code is short enough that a
 * plain digest of one is reversible by exhaustion.
 */
export function hashShortCode(code: string): string | null {
  return keyedHash("shortcode", code);
}

/** Every hash a stored code could have, so a rotation has a grace period. */
export function shortCodeHashCandidates(code: string): string[] {
  return keyedHashCandidates("shortcode", code);
}

/**
 * The candidate hashes to offer the database when claiming a window.
 *
 * The array is ordered, and the database takes the first that does not collide
 * with a live code elsewhere. Four attempts is far more headroom than the
 * collision probability needs; the point is that the display shows *no* short
 * code rather than one belonging to another church.
 */
export function shortCodeCandidatesForWindow(
  sessionId: string,
  windowIndex: number,
  attempts = 4,
): { codes: string[]; hashes: string[] } {
  const codes: string[] = [];
  const hashes: string[] = [];

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const code = deriveShortCode(sessionId, windowIndex, attempt);
    if (!code) break;
    const hash = hashShortCode(code);
    if (!hash) break;
    codes.push(code);
    hashes.push(hash);
  }

  return { codes, hashes };
}
