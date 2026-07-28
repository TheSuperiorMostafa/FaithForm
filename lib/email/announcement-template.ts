import { formatDateTimeRange } from "@/lib/queries/announcements";

export const ANNOUNCEMENT_EMAIL_SUBJECT_PLACEHOLDER = "[Week]";
export const ANNOUNCEMENT_EMAIL_BODY_PLACEHOLDERS = {
  week: "[Week]",
  churchName: "[ChurchName]",
  events: "[Events]",
} as const;

export const DEFAULT_ANNOUNCEMENT_EMAIL_SUBJECT =
  "Weekly announcements — [Week]";

export const DEFAULT_ANNOUNCEMENT_EMAIL_BODY = `Hi team,

Here are this week's events:

[Events]

Thank you!`;

export type WeeklyEmailEvent = {
  title: string;
  location: string;
  startAt: string;
  endAt: string | null;
  notes?: string;
};

export type AnnouncementEmailTemplate = {
  subject: string;
  body: string;
  to: string | null;
  weeklyEmailEnabled: boolean;
};

export function normalizeAnnouncementEmailTemplate(
  input: Partial<AnnouncementEmailTemplate> | null | undefined,
): AnnouncementEmailTemplate {
  const subject = input?.subject?.trim() || DEFAULT_ANNOUNCEMENT_EMAIL_SUBJECT;
  const body = input?.body?.trim() || DEFAULT_ANNOUNCEMENT_EMAIL_BODY;
  const to = input?.to?.trim() || null;

  return {
    subject,
    body,
    to,
    weeklyEmailEnabled: input?.weeklyEmailEnabled ?? true,
  };
}

export function validateAnnouncementEmailTemplate(
  subject: string,
  body: string,
  to: string | null,
): { ok: true } | { ok: false; error: string } {
  if (!subject.trim()) {
    return { ok: false, error: "Email subject cannot be empty." };
  }
  if (!subject.includes(ANNOUNCEMENT_EMAIL_SUBJECT_PLACEHOLDER)) {
    return {
      ok: false,
      error: `Subject must include ${ANNOUNCEMENT_EMAIL_SUBJECT_PLACEHOLDER}.`,
    };
  }
  if (!body.trim()) {
    return { ok: false, error: "Email body cannot be empty." };
  }
  if (!body.includes(ANNOUNCEMENT_EMAIL_BODY_PLACEHOLDERS.events)) {
    return {
      ok: false,
      error: `Body must include ${ANNOUNCEMENT_EMAIL_BODY_PLACEHOLDERS.events}.`,
    };
  }
  if (to && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
    return { ok: false, error: "Recipient email address is invalid." };
  }
  return { ok: true };
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function formatWeeklyEmailEventBlock(
  event: WeeklyEmailEvent,
  timeZone?: string | null,
): string {
  const when = formatDateTimeRange(event.startAt, event.endAt, timeZone);
  const lines = [event.title, when];
  if (event.location.trim()) lines.push(event.location.trim());
  if (event.notes?.trim()) lines.push(event.notes.trim());
  return lines.join("\n");
}

export function formatEventsHtml(
  events: WeeklyEmailEvent[],
  timeZone?: string | null,
): string {
  if (events.length === 0) {
    return "<p><em>No upcoming events this week.</em></p>";
  }

  return events
    .map((event) => {
      const when = formatDateTimeRange(event.startAt, event.endAt, timeZone);
      const parts = [`<p><strong>${escapeHtml(event.title)}</strong></p>`];
      parts.push(`<p><strong>When:</strong> ${escapeHtml(when)}</p>`);
      if (event.location.trim()) {
        parts.push(
          `<p><strong>Where:</strong> ${escapeHtml(event.location.trim())}</p>`,
        );
      }
      if (event.notes?.trim()) {
        parts.push(`<p>${escapeHtml(event.notes.trim())}</p>`);
      }
      return parts.join("");
    })
    .join("");
}

export function formatEventsPlain(
  events: WeeklyEmailEvent[],
  timeZone?: string | null,
): string {
  if (events.length === 0) return "No upcoming events this week.";
  return events
    .map((event) => formatWeeklyEmailEventBlock(event, timeZone))
    .join("\n\n");
}

function plainTextToHtml(text: string): string {
  return text
    .split(/\n{2,}/)
    .filter((paragraph) => paragraph.trim().length > 0)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, "<br>")}</p>`)
    .join("");
}


/**
 * Fills the church's template and returns the pieces a mail message needs:
 * `bodyHtml` for the Gmail draft, and `bodyText` as the plain-text equivalent
 * for any sender that wants a text alternative.
 */
export function renderAnnouncementEmail(input: {
  subjectTemplate: string;
  bodyTemplate: string;
  weekLabel: string;
  churchName: string;
  events: WeeklyEmailEvent[];
  /** IANA timezone for the church — required for correctness in cron runs. */
  timeZone?: string | null;
}): { subject: string; bodyHtml: string; bodyText: string } {
  const eventsPlain = formatEventsPlain(input.events, input.timeZone);
  const eventsHtml = formatEventsHtml(input.events, input.timeZone);

  const subject = input.subjectTemplate
    .replaceAll(ANNOUNCEMENT_EMAIL_SUBJECT_PLACEHOLDER, input.weekLabel)
    .replaceAll(
      ANNOUNCEMENT_EMAIL_BODY_PLACEHOLDERS.churchName,
      input.churchName,
    );

  // Everything except [Events] is substituted first; [Events] is handled
  // separately because it is the one placeholder with two representations.
  const filled = input.bodyTemplate
    .replaceAll(ANNOUNCEMENT_EMAIL_BODY_PLACEHOLDERS.week, input.weekLabel)
    .replaceAll(
      ANNOUNCEMENT_EMAIL_BODY_PLACEHOLDERS.churchName,
      input.churchName,
    );

  const bodyText = filled.replaceAll(
    ANNOUNCEMENT_EMAIL_BODY_PLACEHOLDERS.events,
    eventsPlain,
  );

  // Split on the placeholder and splice the rendered event HTML between the
  // authored segments. Substituting text first and then swapping it back out
  // for HTML loses the formatting once the surrounding template is escaped, and
  // breaks outright if an event title happens to repeat elsewhere in the body.
  //
  // The template is always treated as plain text: the settings editor is a
  // plain textarea documenting only [Week] / [ChurchName] / [Events], so angle
  // brackets in ordinary prose ("RSVP by <date>") must survive as text rather
  // than being guessed at as markup.
  const bodyHtml = filled
    .split(ANNOUNCEMENT_EMAIL_BODY_PLACEHOLDERS.events)
    .map(plainTextToHtml)
    .join(eventsHtml);

  return { subject, bodyHtml, bodyText };
}
