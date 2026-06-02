import type { SupabaseClient } from "@supabase/supabase-js";
import { google } from "googleapis";
import { getGoogleAuthClient } from "@/lib/integrations/google-oauth";

function formatWhen(startAt: string, endAt: string | null): string {
  const start = new Date(startAt);
  const opts: Intl.DateTimeFormatOptions = {
    weekday: "long",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  };
  const startStr = start.toLocaleString(undefined, opts);
  if (!endAt) return startStr;
  const end = new Date(endAt);
  const endStr = end.toLocaleString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  return `${startStr} – ${endStr}`;
}

function buildMimeMessage(input: {
  to?: string;
  subject: string;
  bodyText: string;
}) {
  const lines = [
    "Content-Type: text/html; charset=utf-8",
    "MIME-Version: 1.0",
    input.to ? `To: ${input.to}` : "",
    `Subject: ${input.subject}`,
    "",
    input.bodyText.replace(/\n/g, "<br>"),
  ].filter(Boolean);

  const message = lines.join("\r\n");
  return Buffer.from(message)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export async function createAnnouncementGmailDraft(
  churchId: string,
  input: {
    title: string;
    location: string;
    startAt: string;
    endAt: string | null;
    notes?: string;
  },
  supabase?: SupabaseClient,
): Promise<{ draftId: string; draftUrl: string }> {
  const auth = await getGoogleAuthClient(churchId, supabase);
  const gmail = google.gmail({ version: "v1", auth });

  const when = formatWhen(input.startAt, input.endAt);
  const bodyParts = [
    `<p><strong>${escapeHtml(input.title)}</strong></p>`,
    `<p><strong>When:</strong> ${escapeHtml(when)}</p>`,
  ];
  if (input.location) {
    bodyParts.push(`<p><strong>Where:</strong> ${escapeHtml(input.location)}</p>`);
  }
  if (input.notes?.trim()) {
    bodyParts.push(`<p>${escapeHtml(input.notes.trim())}</p>`);
  }

  const raw = buildMimeMessage({
    subject: `Announcement: ${input.title}`,
    bodyText: bodyParts.join(""),
  });

  const { data } = await gmail.users.drafts.create({
    userId: "me",
    requestBody: { message: { raw } },
  });

  const draftId = data.id ?? "";
  const draftUrl = "https://mail.google.com/mail/u/0/#drafts";

  return { draftId, draftUrl };
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
