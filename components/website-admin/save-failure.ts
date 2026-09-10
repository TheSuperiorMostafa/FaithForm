/**
 * What to tell someone when an autosave request failed outright, as opposed
 * to the server answering "no".
 *
 * These used to share one message, "It will retry as you keep editing". That
 * was not true of the commonest edit on the Website tab: a new photo is a
 * single change, with no next keystroke to carry a retry, so the photo sat
 * unsaved while the page promised otherwise. Each cause now says what happened
 * and whether waiting will fix it.
 */

export type SaveFailure = {
  message: string;
  /** Whether sending the same edit again, unchanged, can succeed. */
  retry: boolean;
};

export const GIVE_UP_MESSAGE =
  "That change could not be saved. Reload the page and try again.";

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : "";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error ?? "");
}

export function describeSaveFailure(
  error: unknown,
  online: boolean = typeof navigator === "undefined" ? true : navigator.onLine,
): SaveFailure {
  const digest =
    error && typeof error === "object" && "digest" in error
      ? String((error as { digest?: unknown }).digest ?? "")
      : "";

  // The server sent the request somewhere else, which for a signed-in page
  // means the sign-in is gone. Resending cannot help until they sign in again.
  if (digest.startsWith("NEXT_REDIRECT")) {
    return {
      message:
        "You have been signed out, so this change is not saved. Sign in again, then make the change once more.",
      retry: false,
    };
  }

  // A deploy landed while the page was open and the page's save endpoint no
  // longer exists. Only a reload fetches the new one.
  if (
    errorName(error) === "UnrecognizedActionError" ||
    /server action .* was not found on the server/i.test(errorMessage(error))
  ) {
    return {
      message:
        "FaithForm was updated while this page was open. Reload the page, then make this change again.",
      retry: false,
    };
  }

  if (!online) {
    return {
      message: "You are offline. This change will save when the connection comes back.",
      retry: true,
    };
  }

  return {
    message: "That change has not saved yet. Trying again…",
    retry: true,
  };
}
