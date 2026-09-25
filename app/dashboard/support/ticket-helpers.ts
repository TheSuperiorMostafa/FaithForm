import type { StatusTone } from "@/components/ui/status-badge";

/**
 * Small, pure rules for the Help page, kept apart from the server action so
 * they can be tested on their own.
 */

export const SUPPORT_SUBJECT_MAX = 200;
const DERIVED_SUBJECT_MAX = 80;

/** How quickly we answer. Must match the public page at app/support/page.tsx. */
export const SUPPORT_RESPONSE_TIME = "within two business days";

export const HELP_PAGE_TITLE = "Help";
export const HELP_PAGE_DESCRIPTION = `Ask us anything. A real person at FaithForm answers ${SUPPORT_RESPONSE_TIME}.`;

/**
 * The subject is optional: when it is left empty, the first line of the
 * message stands in for it, trimmed to a readable length.
 */
export function deriveTicketSubject(subject: string, body: string): string {
  const given = subject.replace(/\s+/g, " ").trim();
  if (given) return given.slice(0, SUPPORT_SUBJECT_MAX);

  const firstLine =
    body
      .split(/\r?\n/)
      .map((line) => line.replace(/\s+/g, " ").trim())
      .find(Boolean) ?? "";
  if (!firstLine) return "";
  if (firstLine.length <= DERIVED_SUBJECT_MAX) return firstLine;
  const cut = firstLine.slice(0, DERIVED_SUBJECT_MAX - 1);
  const atWord = cut.replace(/\s+\S*$/, "");
  return `${(atWord.length > 20 ? atWord : cut).trimEnd()}…`;
}

/**
 * The dashboard page someone was on when they asked for help, so we can see
 * what they saw. Only a dashboard path is kept: no other site, no query
 * string, nothing long.
 */
export function sanitizeFromPath(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const value = raw.trim();
  if (!value.startsWith("/dashboard")) return null;
  if (value.startsWith("//")) return null;
  const path = value.split(/[?#]/)[0] ?? "";
  if (!/^\/dashboard(\/[A-Za-z0-9._~\-/[\]()]*)?$/.test(path)) return null;
  if (path.startsWith("/dashboard/support")) return null;
  return path.slice(0, 200);
}

/** The note appended to a ticket so our team knows where the question came from. */
export function withFromPath(body: string, fromPath: string | null): string {
  if (!fromPath) return body;
  return `${body}\n\n(Sent from ${fromPath})`;
}

export type SupportTicketStatus = "open" | "in_progress" | "resolved";

/**
 * Plain words for a ticket's state, from the church's side:
 * - Closed once we have marked it resolved.
 * - Answered when the last word in the thread is ours.
 * - We're on it otherwise: we have it and haven't replied yet (or they have
 *   written back).
 */
export function supportTicketStatus(ticket: {
  status: SupportTicketStatus;
  comments: ReadonlyArray<{ authorRole: string }>;
}): { label: string; tone: StatusTone } {
  if (ticket.status === "resolved") return { label: "Closed", tone: "neutral" };
  const last = ticket.comments[ticket.comments.length - 1];
  if (last?.authorRole === "platform") return { label: "Answered", tone: "done" };
  return { label: "We're on it", tone: "working" };
}
