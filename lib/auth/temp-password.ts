/**
 * Words a church admin can read down the phone without spelling anything.
 * Deliberately short, unambiguous, and free of look-alike pairs.
 */
const WORDS = [
  "Anchor",
  "Beacon",
  "Bridge",
  "Candle",
  "Chapel",
  "Compass",
  "Garden",
  "Harbor",
  "Harvest",
  "Lantern",
  "Meadow",
  "Morning",
  "Orchard",
  "Pillar",
  "Prairie",
  "River",
  "Shelter",
  "Steeple",
  "Summit",
  "Sunrise",
  "Timber",
  "Village",
  "Willow",
  "Window",
] as const;

/** Flag on `auth.users.user_metadata` that forces the set-password screen. */
export const MUST_CHANGE_PASSWORD_KEY = "must_change_password";

/**
 * Web Crypto rather than `node:crypto` — `mustChangePassword` below is read by
 * middleware, which runs on the Edge runtime and cannot load Node built-ins.
 * Rejection sampling keeps the distribution flat instead of modulo-biased.
 */
function randomBelow(bound: number): number {
  const limit = Math.floor(0xffffffff / bound) * bound;
  const buffer = new Uint32Array(1);
  let value: number;
  do {
    crypto.getRandomValues(buffer);
    value = buffer[0];
  } while (value >= limit);
  return value % bound;
}

/**
 * A temporary password an admin hands to a new teammate.
 *
 * Two words plus four digits — long enough to be a real password, plain enough
 * to be dictated in a hallway, and thrown away the first time they sign in.
 */
export function generateTempPassword(): string {
  const first = WORDS[randomBelow(WORDS.length)];
  let second = WORDS[randomBelow(WORDS.length)];
  while (second === first) {
    second = WORDS[randomBelow(WORDS.length)];
  }
  const digits = String(1000 + randomBelow(9000));
  return `${first}-${second}-${digits}`;
}

/** Minimum we accept when someone replaces their temporary password. */
export const MIN_PASSWORD_LENGTH = 8;

export function validateNewPassword(
  password: string,
  confirmation: string,
): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (password !== confirmation) {
    return "Both passwords must match.";
  }
  return null;
}

export function mustChangePassword(
  metadata: Record<string, unknown> | null | undefined,
): boolean {
  return metadata?.[MUST_CHANGE_PASSWORD_KEY] === true;
}
