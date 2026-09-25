import { toUserError } from "@/lib/errors/user-error";

/**
 * Livestream failures in plain words.
 *
 * The stream libraries throw engineering messages ("Stream credentials are
 * missing.", Postgres text, YouTube API bodies). A few of them describe a
 * situation the church can actually fix, so they get a specific sentence;
 * everything else goes through `toUserError`, which logs the detail and shows
 * a friendly fallback.
 */
const KNOWN_STREAM_FAILURES: Array<[RegExp, string]> = [
  [
    /broadcast is already in progress/i,
    "A service is already live. End it on the Go live tab before starting another one.",
  ],
  [
    /no active broadcast to end/i,
    "There's no live service to end. It may have ended already. Refresh the page to check.",
  ],
  [
    /stream credentials are (missing|not configured)|stream is not configured/i,
    "Streaming isn't set up for this church yet. Open the Setup tab to connect your streaming software.",
  ],
  [
    /stream event not found/i,
    "We couldn't find that service. It may have been cancelled. Refresh the page and try again.",
  ],
  [/invalid or expired pairing code/i, "That pairing code has expired. Create a new one and try again."],
  [
    /destination urls must/i,
    "That streaming address isn't in the right format. Check it and try again.",
  ],
];

function messageOf(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  return "";
}

export function humanizeStreamError(error: unknown, fallback: string): string {
  const message = messageOf(error);
  for (const [pattern, sentence] of KNOWN_STREAM_FAILURES) {
    if (pattern.test(message)) {
      console.error("[stream]", fallback, message);
      return sentence;
    }
  }
  return toUserError(error, fallback);
}

export type SyndicatedPlatform = "youtube" | "facebook";

const PLATFORM_NAMES: Record<SyndicatedPlatform, string> = {
  youtube: "YouTube",
  facebook: "Facebook",
};

/**
 * What a church is told after renaming a live service. The platforms' own
 * error text is never shown: it is written for developers, and "youtube:
 * invalidTitle" helps nobody on a Sunday morning.
 */
export function renameOutcomeMessage(failed: SyndicatedPlatform[]): string {
  const unique = Array.from(new Set(failed)).filter((platform) => platform in PLATFORM_NAMES);
  if (unique.length === 0) return "Title updated everywhere.";
  const names = unique.map((platform) => PLATFORM_NAMES[platform]);
  const who = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  const keeps = names.length === 1 ? "It will keep the old one." : "They will keep the old one.";
  return `Title updated in FaithForm. ${who} didn't accept the new title. ${keeps}`;
}

/** Scheduled-service states in the canonical Service vocabulary. */
export type ServiceStatus = "scheduled" | "live" | "ended" | "cancelled";

export function serviceStatusLabel(status: string): string {
  switch (status) {
    case "scheduled":
      return "Upcoming";
    case "live":
      return "Live";
    case "ended":
      return "Ended";
    case "cancelled":
      return "Cancelled";
    default:
      return "Upcoming";
  }
}
