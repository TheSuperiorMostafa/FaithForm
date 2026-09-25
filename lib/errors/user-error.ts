/**
 * Turns anything a server action can fail with into a sentence a pastor can
 * act on. Raw database, Stripe, Twilio and HTTP text never reaches the page:
 * the detail goes to the server log, the person gets what happened, whether
 * their work was kept, and what to do next.
 *
 * Use at every `return { error }` boundary:
 *
 *   if (error) return { ok: false, error: toUserError(error, "We couldn't save this person.") };
 *
 * The fallback should name the thing that failed. Known cases (duplicates,
 * permissions, missing rows, network) get a more specific sentence.
 */

type ErrorLike = {
  message?: unknown;
  code?: unknown;
  status?: unknown;
  details?: unknown;
};

const TRY_AGAIN = "Please try again. If it keeps happening, contact FaithForm support.";

/** Errors whose message was written for people, so it can be shown as is. */
export class UserFacingError extends Error {
  readonly userFacing = true;
  constructor(message: string) {
    super(message);
    this.name = "UserFacingError";
  }
}

export function isUserFacingError(error: unknown): error is UserFacingError {
  return (
    error instanceof UserFacingError ||
    (typeof error === "object" && error !== null && (error as { userFacing?: unknown }).userFacing === true)
  );
}

function codeOf(error: ErrorLike): string {
  return typeof error.code === "string" ? error.code : "";
}

function messageOf(error: unknown): string {
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && typeof (error as ErrorLike).message === "string") {
    return (error as ErrorLike).message as string;
  }
  return "";
}

/** A specific sentence for failures we recognise, or null. */
function knownFailure(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const e = error as ErrorLike;
  const code = codeOf(e);
  const message = messageOf(error).toLowerCase();

  // Postgres / PostgREST
  if (code === "23505" || message.includes("duplicate key")) {
    return "That already exists. Check the list, it may have been added already.";
  }
  if (code === "23503" || message.includes("foreign key")) {
    return "This is still connected to something else, so it can't be changed yet.";
  }
  if (code === "42501" || message.includes("row-level security") || message.includes("permission denied")) {
    return "You don't have permission to do that. Ask a church admin for access.";
  }
  if (code === "PGRST116") {
    return "We couldn't find that. It may have been removed. Refresh the page and try again.";
  }
  if (code === "23514" || code === "22P02" || code === "22001") {
    return "Something in the form isn't in the right format. Check your entries and try again.";
  }
  if (e.status === 429 || message.includes("rate limit") || message.includes("too many requests")) {
    return "That was a lot of requests at once. Wait a minute, then try again.";
  }
  if (
    message.includes("fetch failed") ||
    message.includes("network") ||
    message.includes("timed out") ||
    message.includes("timeout") ||
    message.includes("econnreset")
  ) {
    return `We couldn't reach the server. Nothing was changed. ${TRY_AGAIN}`;
  }
  return null;
}

/**
 * The one function every action uses to report a failure.
 *
 * @param error    Whatever was caught or returned (Supabase error, Error, string, unknown).
 * @param fallback What failed, in plain words ("We couldn't save this person.").
 */
export function toUserError(error: unknown, fallback: string): string {
  if (isUserFacingError(error)) return error.message;

  const known = knownFailure(error);
  if (error) {
    // Keep the engineering detail where engineers look for it.
    console.error("[faithform]", fallback, error);
  }
  if (known) return known;
  const base = fallback.trim().replace(/\s*$/, "");
  return /[.!?]$/.test(base) ? `${base} ${TRY_AGAIN}` : `${base}. ${TRY_AGAIN}`;
}

/** For client code: a thrown fetch/response failure, kept human. */
export function describeRequestFailure(fallback: string): string {
  return `${fallback.replace(/[.!?]$/, "")}. ${TRY_AGAIN}`;
}
