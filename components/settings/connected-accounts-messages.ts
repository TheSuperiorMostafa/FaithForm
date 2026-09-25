/**
 * What a person reads after connecting an account. The OAuth callbacks hand
 * back short codes (`missing_code`, `access_denied`) or, worse, a raw error
 * from Google or Facebook, so none of that is ever shown as is.
 */

export type AccountId = "google" | "apple" | "youtube" | "facebook";

export const ACCOUNT_IDS: readonly AccountId[] = ["google", "apple", "youtube", "facebook"];

export const ACCOUNT_NAMES: Record<AccountId, string> = {
  google: "Google",
  apple: "iCloud Calendar",
  youtube: "YouTube",
  facebook: "Facebook Page",
};

const CONNECTED: Record<AccountId, string> = {
  google:
    "Google is connected. Announcements can fill in from your calendar, and the weekly email is drafted in Gmail.",
  apple: "iCloud Calendar is connected. Announcements can fill in from it.",
  youtube: "YouTube is connected. Your services can stream to your channel.",
  facebook: "Your Facebook Page is connected.",
};

const SUCCESS_PARAM: Record<string, AccountId> = {
  google_connected: "google",
  apple_connected: "apple",
  youtube_connected: "youtube",
  facebook_connected: "facebook",
};

const KNOWN_ERRORS: Record<string, string> = {
  access_denied:
    "Nothing was connected because permission wasn't given. When you're ready, choose Connect and then Allow.",
  missing_code: "The sign-in didn't finish, so nothing was connected. Please try again.",
  invalid_state:
    "That sign-in took too long or was already used. Nothing was connected. Please start again from this page.",
  session_mismatch:
    "You came back signed in to FaithForm as someone else, so nothing was connected. Sign in as yourself and try again.",
};

const GENERIC_ERROR =
  "We couldn't connect that account. Nothing was changed. Please try again. If it keeps happening, contact FaithForm support.";

/** A plain sentence for any `integration_error` value, never the raw code. */
export function describeAccountError(code: string | null | undefined): string {
  const key = (code ?? "").trim().toLowerCase();
  return KNOWN_ERRORS[key] ?? GENERIC_ERROR;
}

export type AccountNotice = {
  kind: "success" | "error";
  message: string;
  /** Which row to show it beside; null means "above the list". */
  account: AccountId | null;
};

type ParamReader = { get(name: string): string | null };

function isAccountId(value: string | null): value is AccountId {
  return value !== null && (ACCOUNT_IDS as readonly string[]).includes(value);
}

/**
 * Reads the result of an OAuth round trip from the URL. Settings adds
 * `account=<id>` to the address it asks to come back to, so an error can be
 * shown beside the row it belongs to.
 */
export function readAccountNotice(params: ParamReader): AccountNotice | null {
  for (const [param, account] of Object.entries(SUCCESS_PARAM)) {
    if (params.get(param)) {
      return { kind: "success", message: CONNECTED[account], account };
    }
  }
  const error = params.get("integration_error");
  if (error) {
    const account = params.get("account");
    return {
      kind: "error",
      message: describeAccountError(error),
      account: isAccountId(account) ? account : null,
    };
  }
  return null;
}

/** What stops working, said before anyone disconnects. */
export const DISCONNECT_CONSEQUENCES: Record<AccountId, string> = {
  google:
    "Announcements stop filling in from your Google Calendar, and the weekly email is no longer drafted in Gmail. You can connect again at any time.",
  apple:
    "Announcements stop filling in from your iCloud calendar, and Apple Mail drafts stop too. You can connect again at any time.",
  youtube:
    "Your services stop streaming to your YouTube channel. Recordings already there stay. You can connect again at any time.",
  facebook:
    "Announcements stop posting to your Facebook Page, and services stop streaming there. Posts already there stay. You can connect again at any time.",
};

/** Where an OAuth connect should return to, tagged with the row it is for. */
export function accountReturnTo(account: AccountId): string {
  return `/dashboard/settings?tab=accounts&account=${account}`;
}
