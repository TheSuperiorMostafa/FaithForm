import assert from "node:assert/strict";
import test from "node:test";

import { renderAnnouncementEmail } from "@/lib/email/announcement-template";
import { buildMimeMessage } from "@/lib/integrations/gmail";
import {
  extensionForMimeType,
  isAllowedAttachmentType,
  sanitizeAttachmentName,
} from "@/lib/announcements/attachments";

function decodeRaw(raw: string): string {
  return Buffer.from(
    raw.replace(/-/g, "+").replace(/_/g, "/"),
    "base64",
  ).toString("utf8");
}

function decodeBase64Section(section: string): string {
  return Buffer.from(section.replace(/\r\n/g, ""), "base64").toString("utf8");
}

const render = (body: string) =>
  renderAnnouncementEmail({
    subjectTemplate: "Weekly announcements — [Week]",
    bodyTemplate: body,
    weekLabel: "Aug 24",
    churchName: "Grace Community Church",
    events: [],
  }).bodyHtml;

// --- Links in the template -------------------------------------------------

test("a bare URL becomes a link", () => {
  const html = render("Sign up at https://grace.org/retreat\n\n[Events]");
  assert.equal(
    html.includes('<a href="https://grace.org/retreat">https://grace.org/retreat</a>'),
    true,
  );
});

test("a www address gets a scheme so the link actually opens", () => {
  const html = render("See www.grace.org for details.\n\n[Events]");
  assert.equal(html.includes('<a href="https://www.grace.org">www.grace.org</a>'), true);
});

test("markdown link syntax renders as a titled link", () => {
  const html = render("[Register here](https://grace.org/signup)\n\n[Events]");
  assert.equal(
    html.includes('<a href="https://grace.org/signup">Register here</a>'),
    true,
  );
  assert.equal(html.includes("[Register here]"), false);
});

test("a query string survives the trip to the href", () => {
  // The text was escaped before linking, so `&` had already become `&amp;`.
  // The href must carry a single level of escaping — `&amp;` decodes back to
  // `&` — and never the double-escaped `&amp;amp;`, which would send the
  // reader to a different page than the one written.
  const html = render("https://grace.org/e?a=1&b=2\n\n[Events]");
  assert.equal(html.includes('href="https://grace.org/e?a=1&amp;b=2"'), true);
  assert.equal(html.includes("&amp;amp;"), false);
});

test("sentence punctuation stays out of the link", () => {
  const html = render("Details at https://grace.org/retreat.\n\n[Events]");
  assert.equal(
    html.includes('<a href="https://grace.org/retreat">https://grace.org/retreat</a>.'),
    true,
  );
});

test("a javascript: URL is left as plain text", () => {
  const html = render("[click](javascript:alert(1))\n\n[Events]");
  assert.equal(html.includes("<a href"), false);
  assert.equal(html.includes("javascript:alert(1)"), true);
});

test("angle brackets in ordinary prose still survive as text", () => {
  // The template is authored in a plain textarea, and this was the reason it
  // was escaped wholesale in the first place.
  const html = render("RSVP by <date> please.\n\n[Events]");
  assert.equal(html.includes("&lt;date&gt;"), true);
});

test("a link's own text is not rewritten a second time", () => {
  const html = render("[https://grace.org](https://grace.org/real)\n\n[Events]");
  assert.equal(html.includes('<a href="https://grace.org/real">https://grace.org</a>'), true);
  // One anchor, not an anchor nested inside another.
  assert.equal(html.match(/<a href=/g)?.length, 1);
});

// --- Attachments in the MIME message ---------------------------------------

test("a message with no attachments stays a simple html part", () => {
  const raw = decodeRaw(
    buildMimeMessage({ subject: "Hello", bodyHtml: "<p>Hi</p>" }),
  );
  assert.equal(raw.includes('Content-Type: text/html; charset="UTF-8"'), true);
  assert.equal(raw.includes("multipart/mixed"), false);
});

test("an attachment turns the message into multipart/mixed", () => {
  const raw = decodeRaw(
    buildMimeMessage({
      to: "team@grace.org",
      subject: "Weekly announcements",
      bodyHtml: "<p>This week</p>",
      attachments: [
        {
          fileName: "bulletin.pdf",
          mimeType: "application/pdf",
          content: Buffer.from("%PDF-1.4 fake"),
        },
      ],
    }),
  );

  const boundary = raw.match(/boundary="([^"]+)"/)?.[1];
  assert.ok(boundary, "a boundary is declared");

  assert.equal(raw.includes("Content-Type: multipart/mixed"), true);
  assert.equal(
    raw.includes('Content-Disposition: attachment; filename="bulletin.pdf"'),
    true,
  );
  // The closing delimiter is what tells a mail client the message ended.
  assert.equal(raw.trimEnd().endsWith(`--${boundary}--`), true);

  const parts = raw.split(`--${boundary}`);
  // Preamble, html part, attachment part, closing delimiter.
  assert.equal(parts.length, 4);

  const attachmentPart = parts[2]!;
  const encoded = attachmentPart.split("\r\n\r\n")[1] ?? "";
  assert.equal(decodeBase64Section(encoded), "%PDF-1.4 fake");
});

test("the html body survives intact alongside an attachment", () => {
  const raw = decodeRaw(
    buildMimeMessage({
      subject: "Weekly announcements",
      bodyHtml: "<p>Coffee — 4:00–5:00PM</p>",
      attachments: [
        {
          fileName: "flyer.png",
          mimeType: "image/png",
          content: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
        },
      ],
    }),
  );

  const boundary = raw.match(/boundary="([^"]+)"/)![1]!;
  const htmlPart = raw.split(`--${boundary}`)[1]!;
  const encoded = htmlPart.split("\r\n\r\n")[1] ?? "";
  assert.equal(decodeBase64Section(encoded), "<p>Coffee — 4:00–5:00PM</p>");
});

test("a filename cannot smuggle extra headers", () => {
  const raw = decodeRaw(
    buildMimeMessage({
      subject: "Weekly announcements",
      bodyHtml: "<p>Hi</p>",
      attachments: [
        {
          fileName: 'a".pdf\r\nBcc: someone@example.com',
          mimeType: "application/pdf",
          content: Buffer.from("x"),
        },
      ],
    }),
  );

  assert.equal(/^Bcc:/m.test(raw), false);
});

// --- What may be attached --------------------------------------------------

test("documents and images are allowed, executables are not", () => {
  assert.equal(isAllowedAttachmentType("application/pdf"), true);
  assert.equal(isAllowedAttachmentType("image/png"), true);
  assert.equal(isAllowedAttachmentType("application/x-msdownload"), false);
  assert.equal(isAllowedAttachmentType("text/html"), false);
});

test("a filename is stripped of path separators and control characters", () => {
  assert.equal(
    sanitizeAttachmentName("../../etc/passwd", "pdf"),
    "..-..-etc-passwd.pdf",
  );
  assert.equal(sanitizeAttachmentName("bulletin.pdf", "pdf"), "bulletin.pdf");
  assert.equal(sanitizeAttachmentName("   ", "pdf"), "attachment.pdf");
  assert.equal(sanitizeAttachmentName("notes", "txt"), "notes.txt");
});

test("an extension is derived from the declared type", () => {
  assert.equal(extensionForMimeType("application/pdf"), "pdf");
  assert.equal(extensionForMimeType("image/jpeg"), "jpg");
  assert.equal(extensionForMimeType("application/unknown"), "bin");
});
