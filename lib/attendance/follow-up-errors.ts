/**
 * Why a follow-up text didn't go out, in words a pastor can act on.
 *
 * `attendance_entries.follow_up_error` and the log's `error` column keep the
 * raw text from the texting service (a Twilio response body, an SMS gateway
 * code) so staff can debug a failure. None of that is shown on a page: this
 * turns it into one of a few plain reasons.
 *
 * Pure and dependency-free, so client components can use it.
 */

/** Stored when the church has no texting phone of its own yet. */
const NOT_CONNECTED = /no texting phone is connected|sms is not configured|not configured/i;

export type FollowUpFailureReason =
  | "not_connected"
  | "no_phone"
  | "bad_number"
  | "opted_out"
  | "cannot_receive"
  | "busy"
  | "unknown";

export const FOLLOW_UP_FAILURE_TEXT: Record<FollowUpFailureReason, string> = {
  not_connected: "Not sent: texting isn't set up for your church yet",
  no_phone: "Not sent: no phone number on file",
  bad_number: "Not sent: the phone number doesn't look right",
  opted_out: "Not sent: they've asked not to get texts",
  cannot_receive: "Not sent: that number can't get texts",
  busy: "Not sent: too many texts at once. Try again later",
  unknown: "Not sent: the text couldn't be delivered",
};

export function followUpFailureReason(raw: string | null | undefined): FollowUpFailureReason | null {
  const text = (raw ?? "").trim();
  if (!text) return null;
  if (NOT_CONNECTED.test(text)) return "not_connected";
  if (/no phone( number)? on file/i.test(text)) return "no_phone";
  // Twilio 21610: the recipient replied STOP.
  if (/21610|unsubscribed|opted[ -]?out|\bstop\b|blacklist|blocked/i.test(text)) return "opted_out";
  // Twilio 21614 / 30006: not a mobile number, or a landline.
  if (/21614|30006|landline|not a (valid )?mobile|cannot receive|unreachable/i.test(text)) {
    return "cannot_receive";
  }
  // Twilio 21211 / 21217: not a valid phone number.
  if (/21211|21217|invalid (phone|number|'to')|not a valid phone|invalid phone number on file/i.test(text)) {
    return "bad_number";
  }
  if (/429|rate|too many|throttl|queue/i.test(text)) return "busy";
  return "unknown";
}

/** The plain sentence for a stored error, or null when there was none. */
export function describeFollowUpFailure(raw: string | null | undefined): string | null {
  const reason = followUpFailureReason(raw);
  return reason ? FOLLOW_UP_FAILURE_TEXT[reason] : null;
}
