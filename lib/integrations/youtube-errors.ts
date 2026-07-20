const LIVE_STREAMING_NOT_ENABLED = "liveStreamingNotEnabled";

export function isYouTubeLiveStreamingNotEnabledError(error: unknown): boolean {
  const message = extractYouTubeErrorMessage(error).toLowerCase();
  if (message.includes("not enabled for live streaming")) return true;

  const reasons = extractYouTubeErrorReasons(error);
  return reasons.includes(LIVE_STREAMING_NOT_ENABLED);
}

export function formatYouTubeLiveError(error: unknown): string {
  if (isYouTubeLiveStreamingNotEnabledError(error)) {
    return [
      "This YouTube channel is not enabled for live streaming yet.",
      "Verify your phone at youtube.com/verify, open YouTube Studio → Go live to enable it, then wait up to 24 hours if this is your first time.",
    ].join(" ");
  }

  const message = extractYouTubeErrorMessage(error).trim();
  return message || "YouTube live setup failed.";
}

function extractYouTubeErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (typeof error === "object" && error !== null) {
    const nested = error as {
      message?: string;
      response?: { data?: { error?: { message?: string } } };
    };
    return (
      nested.response?.data?.error?.message ??
      nested.message ??
      ""
    );
  }

  return "";
}

function extractYouTubeErrorReasons(error: unknown): string[] {
  if (typeof error !== "object" || error === null) return [];

  const nested = error as {
    response?: {
      data?: {
        error?: {
          errors?: Array<{ reason?: string }>;
        };
      };
    };
  };

  return (nested.response?.data?.error?.errors ?? [])
    .map((entry) => entry.reason?.trim())
    .filter((reason): reason is string => Boolean(reason));
}
