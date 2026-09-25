/**
 * Plain-language wording for what Supabase Auth says when sign-in or sign-up
 * is refused. Its own text ("Invalid login credentials", "User already
 * registered", "Email not confirmed") was being shown to pastors verbatim.
 *
 * Pure and copy-only: nothing here decides whether someone may sign in. The
 * callers keep every guard, rate limit and redirect exactly as they were and
 * only swap the sentence they return. Throttling is translated separately (and
 * first) by `describeAuthError` in `./actions.ts`, so rate-limit wording is
 * never replaced by these.
 */

type AuthErrorLike = { message?: unknown; code?: unknown; status?: unknown } | null | undefined;

function parts(error: AuthErrorLike): { text: string; code: string } {
  const message = typeof error?.message === "string" ? error.message : "";
  const code = typeof error?.code === "string" ? error.code : "";
  return { text: message.toLowerCase(), code: code.toLowerCase() };
}

function isNetworkFailure(text: string): boolean {
  return /fetch failed|network|failed to fetch|timed out|timeout|econn/.test(text);
}

export const WRONG_PASSWORD_MESSAGE =
  "That email and password don't match. Try again, or email yourself a sign-in link instead.";

/** Sign-in with a password was refused. */
export function signInErrorMessage(error: AuthErrorLike): string {
  const { text, code } = parts(error);

  if (code === "invalid_credentials" || text.includes("invalid login credentials")) {
    return WRONG_PASSWORD_MESSAGE;
  }
  if (code === "email_not_confirmed" || text.includes("email not confirmed")) {
    return "You haven't confirmed your email yet. Open the confirmation email we sent you, or email yourself a sign-in link.";
  }
  if (code === "user_banned" || text.includes("banned")) {
    return "This account can't sign in right now. Ask your church admin or FaithForm support for help.";
  }
  if (isNetworkFailure(text)) {
    return "We couldn't reach FaithForm just now. Check your internet connection and try again.";
  }
  return "We couldn't sign you in. Please try again, or email yourself a sign-in link.";
}

/** Sending a sign-in link by email was refused. */
export function signInLinkErrorMessage(error: AuthErrorLike): string {
  const { text, code } = parts(error);

  if (code === "email_address_invalid" || text.includes("invalid format") || text.includes("invalid email")) {
    return "That email address doesn't look right. Check it and try again.";
  }
  if (code === "signup_disabled" || code === "otp_disabled" || text.includes("signups not allowed")) {
    return "We couldn't find a FaithForm account for that email. Check the address, or set up your church first.";
  }
  if (isNetworkFailure(text)) {
    return "We couldn't reach FaithForm just now. Check your internet connection and try again.";
  }
  return "We couldn't send your sign-in link. Please try again in a minute.";
}

/** Whether a sign-up refusal means the email already has an account. */
export function isAlreadyRegistered(error: AuthErrorLike): boolean {
  const { text, code } = parts(error);
  return (
    code === "user_already_exists" ||
    code === "email_exists" ||
    text.includes("already") ||
    text.includes("registered")
  );
}

export const ALREADY_REGISTERED_MESSAGE =
  "You already have an account with this email. Sign in instead, or reset your password from the sign-in page.";

/** Creating an account was refused for a reason other than "already exists". */
export function signUpErrorMessage(error: AuthErrorLike, minPasswordLength: number): string {
  const { text, code } = parts(error);

  if (code === "weak_password" || text.includes("password should") || text.includes("weak password")) {
    return `Choose a stronger password: at least ${minPasswordLength} characters, and not a common word.`;
  }
  if (code === "email_address_invalid" || text.includes("invalid format") || text.includes("invalid email")) {
    return "That email address doesn't look right. Check it and try again.";
  }
  if (code === "signup_disabled" || text.includes("signups not allowed")) {
    return "New accounts can't be created right now. Please contact FaithForm support.";
  }
  if (isNetworkFailure(text)) {
    return "We couldn't reach FaithForm just now. Check your internet connection and try again.";
  }
  return "We couldn't create your account. Please try again in a minute.";
}
