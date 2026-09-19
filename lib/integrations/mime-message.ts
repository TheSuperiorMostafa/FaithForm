/**
 * The weekly announcement email as one finished RFC 5322 message.
 *
 * Gmail and iCloud Mail both take a draft as a whole message: Gmail through
 * drafts.create, iCloud through IMAP APPEND. Both are built here, by the same
 * code, so a church sees the same email whichever mailbox it lands in. The
 * only difference is the envelope (see `MailEnvelope`).
 */

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

export type MailAttachment = {
  fileName: string;
  mimeType: string;
  content: Buffer;
};

export type MailMessageInput = {
  to?: string;
  subject: string;
  bodyHtml: string;
  attachments?: MailAttachment[];
};

/**
 * Headers a mail provider normally stamps on a draft itself.
 *
 * Gmail adds From, Date and Message-ID when it stores a draft, so the Gmail
 * message goes without them. IMAP APPEND stores the bytes exactly as sent, and
 * a draft with no date sorts strangely in Apple Mail and has no sender to
 * default to, so the iCloud message carries them.
 */
export type MailEnvelope = {
  from: string;
  date: Date;
  messageId: string;
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

/** RFC 5322 date-time, in UTC: `Fri, 18 Sep 2026 12:00:00 +0000`. */
export function formatMailDate(date: Date): string {
  return date.toUTCString().replace(/GMT$/, "+0000");
}

/** The envelope's header lines, in the order mail clients write them. */
export function envelopeHeaderLines(envelope: MailEnvelope): string[] {
  return [
    `From: ${encodeHeaderValue(envelope.from)}`,
    `Date: ${formatMailDate(envelope.date)}`,
    `Message-ID: ${encodeHeaderValue(envelope.messageId)}`,
  ];
}

/**
 * The raw message, CRLF line endings throughout.
 *
 * Without an envelope this is exactly what the Gmail draft has always been.
 * With one, the envelope's lines come first and nothing else changes, which
 * is what keeps the two providers' drafts the same email.
 */
export function buildMailMessage(
  input: MailMessageInput,
  envelope?: MailEnvelope,
): string {
  const attachments = input.attachments ?? [];

  const headers = [
    ...(envelope ? envelopeHeaderLines(envelope) : []),
    "MIME-Version: 1.0",
  ];
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
    return `${headers.join("\r\n")}\r\n\r\n${htmlBody}`;
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

  return `${headers.join("\r\n")}\r\n\r\n${parts.join("\r\n")}\r\n--${boundary}--`;
}
