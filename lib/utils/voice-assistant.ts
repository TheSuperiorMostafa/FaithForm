export function formatCallDuration(seconds: number | null): string {
  if (seconds == null || seconds <= 0) return "—";
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (mins === 0) return `${secs}s`;
  return `${mins}m ${secs}s`;
}

export function maskPhoneNumber(number: string | null): string {
  if (!number) return "Unknown caller";
  const digits = number.replace(/\D/g, "");
  if (digits.length < 4) return number;
  return `••• ••• ${digits.slice(-4)}`;
}

/**
 * PRODUCT DECISION PENDING: should church admins see a caller's full number?
 *
 * Numbers are masked for everyone today. Flipping this one constant to `true`
 * shows church admins the full number and a "Call back" button on every call.
 * Nobody else ever sees a full number, and the masking happens on the server,
 * so a masked number never reaches the browser.
 */
export const SHOW_FULL_CALLER_NUMBER_TO_ADMINS = false;

export type CallerContact = {
  /** What the page shows: a full number, or "Caller ending in 0123". */
  label: string;
  /** Digits to dial, only when this viewer may see the full number. */
  dial: string | null;
};

/** "+15025550123" → "(502) 555-0123"; anything else is left as written. */
export function formatPhoneNumber(number: string): string {
  const digits = number.replace(/\D/g, "");
  const national = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (national.length === 10) {
    return `(${national.slice(0, 3)}) ${national.slice(3, 6)}-${national.slice(6)}`;
  }
  return number.trim();
}

/**
 * The caller as this viewer may see them. Decide this on the server and send
 * only the result to the page, never the raw number.
 */
export function callerContactForViewer(
  number: string | null,
  viewer: { isAdmin: boolean },
  showFullToAdmins: boolean = SHOW_FULL_CALLER_NUMBER_TO_ADMINS,
): CallerContact {
  const raw = number?.trim() ?? "";
  const digits = raw.replace(/\D/g, "");
  if (!raw || digits.length < 4) {
    return { label: raw || "Unknown caller", dial: null };
  }
  if (showFullToAdmins && viewer.isAdmin && digits.length >= 7) {
    return {
      label: formatPhoneNumber(raw),
      dial: `${raw.startsWith("+") ? "+" : ""}${digits}`,
    };
  }
  return { label: `Caller ending in ${digits.slice(-4)}`, dial: null };
}

/**
 * "Today, 3:05 PM", "Yesterday, 9:12 AM" or "Mon, Sep 1, 3:05 PM". `now` is
 * a parameter so the wording can be tested.
 */
export function formatCallTime(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const time = date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000);
  if (days === 0) return `Today, ${time}`;
  if (days === 1) return `Yesterday, ${time}`;
  const day = date.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    ...(date.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}),
  });
  return `${day}, ${time}`;
}
