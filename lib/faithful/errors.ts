/**
 * Stable domain errors for the Faithful visitor surface.
 *
 * The codes are the contract. Prompt 4 maps them to a versioned wire format,
 * so they must stay meaningful to a native client that cannot read English:
 * `blocked` and `not_discoverable` are different situations even though both
 * render as "you can't join this church".
 */
export const VISITOR_ERROR_CODES = [
  "unauthenticated",
  "account_missing",
  "account_inactive",
  "church_not_found",
  "not_discoverable",
  "invalid_input",
  "invitation_invalid",
  "invitation_expired",
  "invitation_revoked",
  "invitation_exhausted",
  "invitation_wrong_purpose",
  "invitation_wrong_church",
  "blocked",
  "forbidden",
  "conflict",
  "already_linked",
  "member_already_claimed",
  "claim_not_found",
  "relationship_not_found",
  "invalid_transition",
  "unsupported_dependent_claim",
  "rate_limited",
  "unavailable",
] as const;

export type VisitorErrorCode = (typeof VISITOR_ERROR_CODES)[number];

export class VisitorError extends Error {
  readonly code: VisitorErrorCode;

  constructor(code: VisitorErrorCode, message?: string) {
    super(message ?? code);
    this.name = "VisitorError";
    this.code = code;
  }
}

export type VisitorResult<T> =
  | { ok: true; data: T }
  | { ok: false; code: VisitorErrorCode; message: string };

export function fail<T>(
  code: VisitorErrorCode,
  message?: string,
): VisitorResult<T> {
  return { ok: false, code, message: message ?? code };
}

export function succeed<T>(data: T): VisitorResult<T> {
  return { ok: true, data };
}

/**
 * Errors thrown by domain services carry a code; anything else is a bug and is
 * reported as `unavailable` rather than leaking a driver message to a client.
 */
export function toVisitorResult<T>(error: unknown): VisitorResult<T> {
  if (error instanceof VisitorError) {
    return fail(error.code, error.message);
  }
  return fail("unavailable", "Something went wrong.");
}
