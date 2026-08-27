import type { SupabaseClient } from "@supabase/supabase-js";
import { google } from "googleapis";
import { getGoogleAuthClient } from "@/lib/integrations/google-oauth";

/** RFC 2047 encoded words must stay under 76 chars including the wrapper. */
const ENCODED_WORD_PAYLOAD_BYTES = 42;

function isPrintableAscii(value: string): boolean {
  return /^[\x20-\x7E]*$/.test(value);
}

/**
 * Splits on code points (never mid-character) into chunks whose UTF-8 encoding
 * fits one encoded word.
 */
function chunkByUtf8Bytes(value: string, maxBytes: number): string[] {
  const chunks: string[] = [];
  let current = "";
  let currentBytes = 0;

  for (const char of value) {
    const charBytes = Buffer.byteLength(char, "utf8");
    if (currentBytes + charBytes > maxBytes && current) {
      chunks.push(current);
      current = "";
      currentBytes = 0;
    }
    current += char;
    currentBytes += charBytes;
  }

  if (current) chunks.push(current);
  return chunks.length > 0 ? chunks : [""];
}

/**
 * Prepares a value for a mail header.
 *
 * Strips CR/LF (a template-authored subject must never be able to inject extra
 * headers) and RFC 2047 encodes anything non-ASCII — the default subject alone
 * contains an em dash, and week labels contain en dashes, which are illegal as
 * raw bytes in a header.
 */
function encodeHeaderValue(value: string): string {
  const sanitized = value.replace(/[\r\n]+/g, " ").trim();

  if (isPrintableAscii(sanitized)) return sanitized;

  return chunkByUtf8Bytes(sanitized, ENCODED_WORD_PAYLOAD_BYTES)
    .map((chunk) => `=?UTF-8?B?${Buffer.from(chunk, "utf8").toString("base64")}?=`)
    // Continuation lines are folded with CRLF + a single space.
    .join("\r\n ");
}

function toBase64Url(value: string): string {
  return Buffer.from(value, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export type GmailAttachment = {
  fileName: string;
  mimeType: string;
  content: Buffer;
};

/** Base64 bodies are wrapped at 76 columns per RFC 2045. */
function base64Body(content: Buffer): string {
  return content.toString("base64").match(/.{1,76}/g)?.join("\r\n") ?? "";
}

/**
 * A filename is quoted inside the Content-Disposition header, so a quote or a
 * newline in it would end the parameter early and let the rest be read as
 * header syntax. Non-ASCII names are RFC 2047 encoded like any other value.
 */
function encodeFileName(name: string): string {
  return encodeHeaderValue(name.replace(/"/g, "'"));
}

/** Exported for testing — `createGmailDraft` is the supported entry point. */
export function buildMimeMessage(input: {
  to?: string;
  subject: string;
  bodyHtml: string;
  attachments?: GmailAttachment[];
}) {
  const attachments = input.attachments ?? [];

  const headers = ["MIME-Version: 1.0"];
  const to = input.to?.trim();

  // The body is base64 so 8-bit UTF-8 (dashes, accents, emoji) survives intact.
  const htmlBody = base64Body(Buffer.from(input.bodyHtml, "utf8"));

  if (attachments.length === 0) {
    headers.push(
      'Content-Type: text/html; charset="UTF-8"',
      "Content-Transfer-Encoding: base64",
    );
    if (to) headers.push(`To: ${encodeHeaderValue(to)}`);
    headers.push(`Subject: ${encodeHeaderValue(input.subject)}`);

    // The blank line between headers and body is mandatory — without it the
    // body is parsed as another header and the draft arrives empty.
    return toBase64Url(`${headers.join("\r\n")}\r\n\r\n${htmlBody}`);
  }

  // A boundary must not appear anywhere in the parts it separates. This one is
  // built from the content itself, so it cannot collide with a file that
  // happens to contain a boundary-looking string.
  const digest = attachments
    .reduce(
      (hash, attachment) => hash + attachment.content.length + attachment.fileName.length,
      input.bodyHtml.length,
    )
    .toString(36);
  const boundary = `faithform-${digest}-${attachments.length}-boundary`;

  headers.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);
  if (to) headers.push(`To: ${encodeHeaderValue(to)}`);
  headers.push(`Subject: ${encodeHeaderValue(input.subject)}`);

  const parts = [
    [
      `--${boundary}`,
      'Content-Type: text/html; charset="UTF-8"',
      "Content-Transfer-Encoding: base64",
      "",
      htmlBody,
    ].join("\r\n"),
  ];

  for (const attachment of attachments) {
    const name = encodeFileName(attachment.fileName);
    parts.push(
      [
        `--${boundary}`,
        `Content-Type: ${attachment.mimeType}; name="${name}"`,
        "Content-Transfer-Encoding: base64",
        `Content-Disposition: attachment; filename="${name}"`,
        "",
        base64Body(attachment.content),
      ].join("\r\n"),
    );
  }

  const message = `${headers.join("\r\n")}\r\n\r\n${parts.join("\r\n")}\r\n--${boundary}--`;

  return toBase64Url(message);
}

export async function createGmailDraft(
  churchId: string,
  input: {
    to?: string;
    subject: string;
    bodyHtml: string;
    attachments?: GmailAttachment[];
  },
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
    draftUrl: "https://mail.google.com/mail/u/0/#drafts",
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
