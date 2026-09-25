import {
  describeCallFollowUp,
  describeCallScore,
  type CallFollowUpTone,
} from "@/lib/utils/call-score";
import {
  callerContactForViewer,
  formatCallDuration,
} from "@/lib/utils/voice-assistant";
import type { PhoneCallRow } from "@/types/voice-assistant";

export const CALL_LOG_TITLE = "Phone Calls";
export const CALL_LOG_DESCRIPTION =
  "Calls your phone assistant answered, and who needs a call back.";

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

/** The same row with the raw number removed, for staff-only client views. */
export function withoutCallerNumber(call: PhoneCallRow): PhoneCallRow {
  return { ...call, caller_number: null };
}
