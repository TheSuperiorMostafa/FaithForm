import type { StatusTone } from "@/components/ui/status-badge";
import type { RecordingPhase } from "@/lib/stream/recording-model";

/**
 * How the dashboard presents a recording's state: badge tone, which filter it
 * belongs to, and the one next thing to do about it.
 *
 * The *words* come from `recordingPhase()` in `recording-model.ts`, the single
 * mapping from a recording row to the canonical vocabulary (Live · Processing
 * · Ready to publish · Published … · Not published · Problem). This file only
 * ever looks at `phase`, so a label can never drift from its colour or its
 * button.
 */

/** The member app's name, everywhere a church reads it. */
export const MEMBER_APP = "FaithForm app";

export const RECORDINGS_HREF = "/dashboard/live-streaming/recordings";
export const GO_LIVE_HREF = "/dashboard/live-streaming";

export function recordingHref(id: string): string {
  return `${RECORDINGS_HREF}/${encodeURIComponent(id)}`;
}

export function recordingTone(phase: RecordingPhase): StatusTone {
  switch (phase) {
    case "recording":
      return "live";
    case "preparing":
      return "working";
    case "ready_to_publish":
      return "ready";
    case "published":
      return "done";
    case "needs_attention":
      return "attention";
    case "unpublished":
    case "deleted":
      return "neutral";
  }
}

/** Something the church has to do: publish it, or look at a problem. */
export function needsAction(phase: RecordingPhase): boolean {
  return phase === "ready_to_publish" || phase === "needs_attention";
}

/** Still changing on its own; the page refreshes itself while any exist. */
export function isStillChanging(phase: RecordingPhase): boolean {
  return phase === "recording" || phase === "preparing";
}

export type RecordingNextAction = { label: string; href: string };

export function recordingNextAction(
  recording: { id: string; phase: { phase: RecordingPhase } },
  isAdmin: boolean,
): RecordingNextAction | null {
  const href = recordingHref(recording.id);
  switch (recording.phase.phase) {
    case "recording":
      return { label: "Go to Live", href: GO_LIVE_HREF };
    case "preparing":
      return null;
    case "ready_to_publish":
      return isAdmin
        ? { label: "Review & publish", href }
        : { label: "Review", href };
    case "needs_attention":
      return { label: "Fix problem", href };
    case "published":
      return { label: "View details", href };
    case "unpublished":
      return { label: "Review", href };
    case "deleted":
      return null;
  }
}

/** One sentence saying where members find a published recording. */
export function publishedWhereSentence(where: { app: boolean; website: boolean }): string {
  if (where.app && where.website) {
    return `Members see it in the ${MEMBER_APP} under Services, and anyone can watch it on your church website.`;
  }
  if (where.app) return `Members see it in the ${MEMBER_APP} under Services.`;
  if (where.website) return `It's on your church website. It isn't in the ${MEMBER_APP}.`;
  return "It isn't showing anywhere yet.";
}

// ---------------------------------------------------------------------------
// Filters on the Recordings tab
// ---------------------------------------------------------------------------

export type RecordingFilter = "all" | "needs-action" | "published" | "series";

export const RECORDING_FILTERS: Array<{ key: RecordingFilter; label: string }> = [
  { key: "all", label: "All" },
  { key: "needs-action", label: "Needs action" },
  { key: "published", label: "Published" },
  { key: "series", label: "Series" },
];

export function parseRecordingFilter(value: string | string[] | undefined): RecordingFilter {
  const raw = Array.isArray(value) ? value[0] : value;
  return RECORDING_FILTERS.some((filter) => filter.key === raw) ? (raw as RecordingFilter) : "all";
}

export function recordingFilterHref(filter: RecordingFilter): string {
  return filter === "all" ? RECORDINGS_HREF : `${RECORDINGS_HREF}?show=${filter}`;
}

export function filterRecordings<T extends { phase: { phase: RecordingPhase } }>(
  recordings: T[],
  filter: RecordingFilter,
): T[] {
  switch (filter) {
    case "needs-action":
      return recordings.filter((recording) => needsAction(recording.phase.phase));
    case "published":
      return recordings.filter((recording) => recording.phase.phase === "published");
    default:
      return recordings;
  }
}

/** "1 recording ready to publish", "3 recordings ready to publish". */
export function readyToPublishHeadline(count: number): string {
  return count === 1 ? "1 recording ready to publish" : `${count} recordings ready to publish`;
}
