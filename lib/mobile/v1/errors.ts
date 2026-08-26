/**
 * The mobile error vocabulary.
 *
 * These codes are the contract. A native client switches on them, so they are
 * append-only: a code may be added in a minor release, but never renamed,
 * repurposed, or removed without a new API version.
 *
 * Every code maps to exactly one HTTP status so a client that only understands
 * status can still behave sanely, and so a client that understands codes never
 * has to guess what a 409 meant.
 */
export const MOBILE_ERROR_CODES = {
  // 400 — the request itself is wrong
  invalid_request: 400,
  invalid_cursor: 400,
  missing_idempotency_key: 400,
  payload_too_large: 413,

  // 401 / 403 — who you are, and what that allows
  unauthenticated: 401,
  session_expired: 401,
  forbidden: 403,
  blocked: 403,
  account_inactive: 403,

  // 404 — including "you may not know this exists"
  not_found: 404,

  // 409 — state conflicts
  conflict: 409,
  already_linked: 409,
  idempotency_key_reused: 409,

  // 410 — gone for good
  invitation_expired: 410,
  client_version_unsupported: 410,

  // 412 / 428 — precondition and concurrency
  stale_version: 412,

  // 429 — slow down
  rate_limited: 429,

  // 5xx — our fault
  unavailable: 503,
  internal_error: 500,
} as const;

export type MobileErrorCode = keyof typeof MOBILE_ERROR_CODES;

export const MOBILE_ERROR_CODE_LIST = Object.keys(
  MOBILE_ERROR_CODES,
) as MobileErrorCode[];

export function statusForCode(code: MobileErrorCode): number {
  return MOBILE_ERROR_CODES[code];
}

/**
 * Whether retrying the identical request could plausibly succeed. Clients use
 * this instead of hard-coding a status list, so retry policy stays a server
 * decision.
 */
export function isRetryable(code: MobileErrorCode): boolean {
  return code === "rate_limited" || code === "unavailable" || code === "internal_error";
}

export class MobileError extends Error {
  readonly code: MobileErrorCode;
  readonly status: number;
  /** Field-level detail. Never contains a value the caller did not send. */
  readonly fields?: { field: string; issue: string }[];
  readonly retryAfterSeconds?: number;

  constructor(
    code: MobileErrorCode,
    message: string,
    options?: {
      fields?: { field: string; issue: string }[];
      retryAfterSeconds?: number;
    },
  ) {
    super(message);
    this.name = "MobileError";
    this.code = code;
    this.status = statusForCode(code);
    this.fields = options?.fields;
    this.retryAfterSeconds = options?.retryAfterSeconds;
  }
}

/**
 * Maps a Prompt 3 domain error code onto the mobile vocabulary.
 *
 * Kept as an explicit table rather than a passthrough: the domain vocabulary is
 * free to grow for FaithForm's own reasons, and a code that has no mobile
 * meaning must degrade to something safe rather than leak an internal name.
 */
const DOMAIN_TO_MOBILE: Record<string, MobileErrorCode> = {
  unauthenticated: "unauthenticated",
  account_missing: "not_found",
  account_inactive: "account_inactive",
  church_not_found: "not_found",
  not_discoverable: "not_found",
  invalid_input: "invalid_request",
  invitation_invalid: "not_found",
  invitation_expired: "invitation_expired",
  invitation_revoked: "invitation_expired",
  invitation_exhausted: "invitation_expired",
  invitation_wrong_purpose: "forbidden",
  invitation_wrong_church: "forbidden",
  blocked: "blocked",
  forbidden: "forbidden",
  conflict: "conflict",
  already_linked: "already_linked",
  member_already_claimed: "conflict",
  claim_not_found: "not_found",
  relationship_not_found: "not_found",
  invalid_transition: "conflict",
  unsupported_dependent_claim: "forbidden",
  rate_limited: "rate_limited",
  unavailable: "unavailable",
};

export function mobileCodeForDomainCode(domainCode: string): MobileErrorCode {
  return DOMAIN_TO_MOBILE[domainCode] ?? "internal_error";
}
