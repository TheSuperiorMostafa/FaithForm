import type { SupabaseClient } from "@supabase/supabase-js";
import { google } from "googleapis";
import { getGoogleAuthClient } from "@/lib/integrations/google-oauth";
import {
  buildMailMessage,
  type MailAttachment,
  type MailMessageInput,
} from "@/lib/integrations/mime-message";

function toBase64Url(value: string): string {
  return Buffer.from(value, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export type GmailAttachment = MailAttachment;

/** Where a church finds the draft. Gmail has no link to a single draft. */
export const GMAIL_DRAFTS_URL = "https://mail.google.com/mail/u/0/#drafts";

/**
 * The weekly email in the base64url form drafts.create takes. The message
 * itself comes from the shared builder, the same one iCloud Mail drafts use.
 *
 * Exported for testing — `createGmailDraft` is the supported entry point.
 */
export function buildMimeMessage(input: MailMessageInput) {
  return toBase64Url(buildMailMessage(input));
}

export async function createGmailDraft(
  churchId: string,
  input: MailMessageInput,
  supabase?: SupabaseClient,
): Promise<{ draftId: string; draftUrl: string }> {
  const auth = await getGoogleAuthClient(churchId, supabase);
  const gmail = google.gmail({ version: "v1", auth });

  const raw = buildMimeMessage(input);

  const { data } = await gmail.users.drafts.create({
    userId: "me",
    requestBody: { message: { raw } },
  });

  return {
    draftId: data.id ?? "",
    draftUrl: GMAIL_DRAFTS_URL,
  };
}

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

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** @deprecated Use weekly announcement drafts via createGmailDraft instead. */
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

  return createGmailDraft(
    churchId,
    {
      subject: `Announcement: ${input.title}`,
      bodyHtml: bodyParts.join(""),
    },
    supabase,
  );
}
