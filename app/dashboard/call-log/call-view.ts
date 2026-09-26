import {
  describeCallFollowUp,
  describeCallScore,
  type CallFollowUpTone,
} from "@/lib/utils/call-score";
import {
  callerContactForViewer,
  formatCallDuration,
  formatPhoneNumber,
} from "@/lib/utils/voice-assistant";
import type { PhoneCallRow } from "@/types/voice-assistant";

export const CALL_LOG_TITLE = "Phone Calls";
export const CALL_LOG_DESCRIPTION =
  "Calls your phone assistant answered.";

/**
 * What the church's Phone Calls page needs about one call, and nothing more.
 *
 * Built on the server so the caller's raw number never reaches the browser
 * unless this viewer is allowed to see it (`callerContactForViewer`). The
 * assistant's score and rubric stay out of it: those are FaithForm's to read.
 */
export type CallListItem = {
  id: string;
  callerLabel: string;
  /** Present only when this viewer may see and dial the full number. */
  dial: string | null;
  /** The caller's full number, formatted; church admins only. */
  callerNumber: string | null;
  calledAt: string;
  duration: string;
  /** "What they wanted", in the summary's words. */
  summary: string | null;
  needsCallBack: boolean;
  urgent: boolean;
  handled: boolean;
  handledAt: string | null;
  statusLabel: string;
  statusTone: CallFollowUpTone;
  hasRecording: boolean;
  hasTranscript: boolean;
};

export function toCallListItem(
  call: PhoneCallRow,
  handledAt: string | null,
  viewer: { isAdmin: boolean },
): CallListItem {
  const contact = callerContactForViewer(call.caller_number, viewer);
  const followUp = describeCallFollowUp(call, handledAt);
  return {
    id: call.id,
    callerLabel: contact.label,
    dial: contact.dial,
    callerNumber: fullCallerNumber(call.caller_number, viewer),
    calledAt: call.called_at,
    duration: formatCallDuration(call.duration_seconds),
    summary: describeCallScore(call).summary,
    needsCallBack: followUp.needsCallBack,
    urgent: followUp.urgent,
    handled: followUp.handled,
    handledAt,
    statusLabel: followUp.label,
    statusTone: followUp.tone,
    hasRecording: Boolean(call.recording_url),
    hasTranscript: Boolean(call.transcript?.trim()),
  };
}

/**
 * The full number shown beside the call time on the Phone Calls list. Only
 * church admins get it, and it is decided here on the server, so other
 * viewers never receive the number at all.
 */
function fullCallerNumber(number: string | null, viewer: { isAdmin: boolean }): string | null {
  const raw = number?.trim() ?? "";
  if (!viewer.isAdmin || raw.replace(/\D/g, "").length < 7) return null;
  return formatPhoneNumber(raw);
}

/** The same row with the raw number removed, for staff-only client views. */
export function withoutCallerNumber(call: PhoneCallRow): PhoneCallRow {
  return { ...call, caller_number: null };
}
