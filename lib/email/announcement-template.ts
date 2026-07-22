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

export function formatWeeklyEmailEventBlock(event: WeeklyEmailEvent): string {
  const when = formatDateTimeRange(event.startAt, event.endAt);
  const lines = [event.title, when];
  if (event.location.trim()) lines.push(event.location.trim());
  if (event.notes?.trim()) lines.push(event.notes.trim());
  return lines.join("\n");
}

export function formatEventsHtml(events: WeeklyEmailEvent[]): string {
  if (events.length === 0) {
    return "<p><em>No upcoming events this week.</em></p>";
  }

  return events
    .map((event) => {
      const when = formatDateTimeRange(event.startAt, event.endAt);
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

export function formatEventsPlain(events: WeeklyEmailEvent[]): string {
  if (events.length === 0) return "No upcoming events this week.";
  return events.map((event) => formatWeeklyEmailEventBlock(event)).join("\n\n");
}

function plainTextToHtml(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

export function renderAnnouncementEmail(input: {
  subjectTemplate: string;
  bodyTemplate: string;
  weekLabel: string;
  churchName: string;
  events: WeeklyEmailEvent[];
}): { subject: string; bodyHtml: string } {
  const eventsPlain = formatEventsPlain(input.events);
  const eventsHtml = formatEventsHtml(input.events);

  const subject = input.subjectTemplate
    .replaceAll(ANNOUNCEMENT_EMAIL_SUBJECT_PLACEHOLDER, input.weekLabel)
    .replaceAll(
      ANNOUNCEMENT_EMAIL_BODY_PLACEHOLDERS.churchName,
      input.churchName,
    );

  let body = input.bodyTemplate
    .replaceAll(ANNOUNCEMENT_EMAIL_BODY_PLACEHOLDERS.week, input.weekLabel)
    .replaceAll(
      ANNOUNCEMENT_EMAIL_BODY_PLACEHOLDERS.churchName,
      input.churchName,
    )
    .replaceAll(ANNOUNCEMENT_EMAIL_BODY_PLACEHOLDERS.events, eventsPlain);

  const bodyHtml = body.includes("<")
    ? body.replaceAll(eventsPlain, eventsHtml)
    : plainTextToHtml(body);

  return { subject, bodyHtml };
}
