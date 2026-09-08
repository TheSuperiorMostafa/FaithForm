import { escapeHtml } from "@/lib/email/escape-html";
import { getCanonicalSiteUrl } from "@/lib/site-url";

/**
 * The one FaithForm email shell, and the blocks every message is built from.
 *
 * ## Why content is structured rather than written as HTML
 *
 * Six modules each hand-rolled their own document, which is how they drifted:
 * two golds (#C5A059 and #C9A227), two borders, `#ffffff` and `#FFFFFF`, and
 * not one of them ever showed the logo. Worse, none sent a plain-text part, so
 * every message arrived as HTML-only — which spam filters weigh against you,
 * and which leaves screen readers and text-mode clients with whatever the
 * client can scrape.
 *
 * So callers describe *what the email says*, not how it looks, and this module
 * renders both parts from that one description. The HTML and the text cannot
 * disagree, because they are two projections of the same blocks.
 *
 * ## Why the markup looks like 1999
 *
 * Because Outlook renders with Word. Tables with `role="presentation"`,
 * every style inline, no flexbox, no grid, no external stylesheet, and a VML
 * fallback so the button is a button rather than a bare link. `<style>` in the
 * head is stripped by Gmail's clipping and by several corporate gateways, so
 * nothing that matters may live there — the media query is a progressive
 * enhancement for phones and nothing depends on it.
 */

/** Straight from tailwind.config.ts — the same navy and gold the app uses. */
export const BRAND = {
  navy: "#002D5F",
  gold: "#C5A059",
  cream: "#F8F7F4",
  white: "#FFFFFF",
  ink: "#1F2937",
  body: "#374151",
  muted: "#6B7280",
  faint: "#9CA3AF",
  border: "#E5E7EB",
} as const;

const FONT_STACK =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif";

/** Serif for the wordmark only, matching the dashboard's heading face. */
const HEADING_STACK = "Georgia,'Times New Roman',serif";

/**
 * Whose email this is.
 *
 * Most messages are from FaithForm and use the default. Donation receipts are
 * not: a gift was made to a church, and the receipt has to look like it came
 * from that church, with its name, its colours and its own logo. Forcing our
 * navy onto it would misattribute the relationship.
 */
export type EmailBrand = {
  name: string;
  /** Header band. */
  primary: string;
  /** Call-to-action button. */
  accent: string;
  /**
   * Absolute https URL to a square logo, or null for a wordmark on its own.
   * Never a relative path — an email has no origin to resolve one against.
   */
  logoUrl?: string | null;
};

export type EmailBlock =
  | { kind: "paragraph"; text: string }
  | { kind: "subheading"; text: string }
  | { kind: "button"; label: string; url: string }
  /** A label/value row — receipts, ticket metadata, contact submissions. */
  | { kind: "detail"; label: string; value: string }
  /** Someone else's words, set apart from ours. */
  | { kind: "quote"; text: string }
  /** Small print: expiry notices, "you can ignore this", link fallbacks. */
  | { kind: "muted"; text: string }
  | { kind: "list"; items: string[] }
  /**
   * A boxed panel for the one thing the reader came for — a temporary
   * password, a receipt total. `mono` sets a value in a fixed-pitch face so a
   * credential can be transcribed without guessing at l versus 1.
   */
  | {
      kind: "callout";
      title: string;
      rows: { label: string; value: string; mono?: boolean }[];
    }
  | { kind: "divider" };

export type EmailDocument = {
  /** Subject-adjacent; also the browser title in "view in browser" contexts. */
  title: string;
  /**
   * The grey line the inbox shows after the subject. Without one, clients
   * scrape the first text in the document — which is the logo's alt text.
   */
  preheader: string;
  heading: string;
  blocks: EmailBlock[];
  /** Closing line under the divider. Defaults to the product signature. */
  footerNote?: string;
  /** Defaults to FaithForm's own navy and gold. */
  brand?: EmailBrand;
  /** The last grey line. Defaults to the staff-facing explanation. */
  permissionNote?: string;
};

export type RenderedEmail = { html: string; text: string };

function faithformBrand(): EmailBrand {
  return {
    name: "FaithForm",
    primary: BRAND.navy,
    accent: BRAND.gold,
    // Absolute, and a real PNG rather than the 1024px JPEG the app ships:
    // an email client downloads this every open, over whatever connection the
    // reader happens to be on.
    logoUrl: `${getCanonicalSiteUrl()}/email/faithform-logo-96.png`,
  };
}

/**
 * A button that survives Outlook.
 *
 * Word's renderer ignores padding on an anchor, so a styled `<a>` collapses to
 * underlined text. The VML rectangle behind it is what keeps the shape; every
 * other client skips the conditional comment and sees the anchor.
 */
function renderButton(label: string, url: string, accent: string): string {
  const safeLabel = escapeHtml(label);
  const safeUrl = escapeHtml(url);

  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px;">
  <tr>
    <td align="center" bgcolor="${accent}" style="border-radius:10px;">
      <!--[if mso]>
      <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${safeUrl}" style="height:52px;v-text-anchor:middle;width:280px;" arcsize="19%" stroke="f" fillcolor="${accent}">
        <w:anchorlock/>
        <center style="color:#ffffff;font-family:${FONT_STACK};font-size:16px;font-weight:bold;">${safeLabel}</center>
      </v:roundrect>
      <![endif]-->
      <!--[if !mso]><!-- -->
      <a href="${safeUrl}" style="display:inline-block;padding:16px 32px;font-family:${FONT_STACK};font-size:16px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:10px;background-color:${accent};">${safeLabel}</a>
      <!--<![endif]-->
    </td>
  </tr>
</table>`;
}

function renderBlock(block: EmailBlock, brand: EmailBrand): string {
  switch (block.kind) {
    case "paragraph":
      return `<p style="margin:0 0 18px;font-family:${FONT_STACK};font-size:16px;line-height:1.6;color:${BRAND.body};">${escapeHtml(block.text)}</p>`;

    case "subheading":
      return `<h2 style="margin:28px 0 12px;font-family:${FONT_STACK};font-size:17px;font-weight:700;line-height:1.4;color:${brand.primary};">${escapeHtml(block.text)}</h2>`;

    case "button":
      return renderButton(block.label, block.url, brand.accent);

    case "detail":
      return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 10px;">
  <tr>
    <td style="font-family:${FONT_STACK};font-size:14px;line-height:1.5;color:${BRAND.muted};padding:0 12px 0 0;white-space:nowrap;vertical-align:top;">${escapeHtml(block.label)}</td>
    <td style="font-family:${FONT_STACK};font-size:14px;line-height:1.5;color:${BRAND.ink};font-weight:600;vertical-align:top;">${escapeHtml(block.value)}</td>
  </tr>
</table>`;

    case "quote":
      return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 20px;">
  <tr>
    <td style="border-left:3px solid ${brand.accent};padding:4px 0 4px 16px;font-family:${FONT_STACK};font-size:15px;line-height:1.6;color:${BRAND.body};white-space:pre-wrap;">${escapeHtml(block.text)}</td>
  </tr>
</table>`;

    case "muted":
      // `word-break` so a pasted fallback URL cannot widen the card on a phone.
      return `<p style="margin:0 0 12px;font-family:${FONT_STACK};font-size:13px;line-height:1.6;color:${BRAND.faint};word-break:break-word;">${escapeHtml(block.text)}</p>`;

    case "list":
      return `<ul style="margin:0 0 20px;padding-left:22px;font-family:${FONT_STACK};font-size:16px;line-height:1.6;color:${BRAND.body};">
${block.items.map((item) => `  <li style="margin:0 0 6px;">${escapeHtml(item)}</li>`).join("\n")}
</ul>`;

    case "callout":
      return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 24px;border:1px solid ${BRAND.border};border-radius:10px;background-color:${BRAND.cream};">
  <tr>
    <td style="padding:20px 24px;">
      <p style="margin:0 0 14px;font-family:${FONT_STACK};font-size:12px;font-weight:700;color:${brand.primary};text-transform:uppercase;letter-spacing:0.06em;">${escapeHtml(block.title)}</p>
${block.rows
  .map(
    (row) =>
      `      <p style="margin:0 0 4px;font-family:${FONT_STACK};font-size:13px;color:${BRAND.muted};">${escapeHtml(row.label)}</p>
      <p style="margin:0 0 14px;font-family:${row.mono ? "'SFMono-Regular',Consolas,'Liberation Mono',Menlo,monospace" : FONT_STACK};font-size:${row.mono ? "20px" : "16px"};font-weight:700;${row.mono ? "letter-spacing:1px;" : ""}color:${BRAND.ink};">${escapeHtml(row.value)}</p>`,
  )
  .join("\n")}
    </td>
  </tr>
</table>`;

    case "divider":
      return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr><td style="border-top:1px solid ${BRAND.border};font-size:0;line-height:0;height:1px;">&nbsp;</td></tr></table>`;
  }
}

const DEFAULT_FOOTER =
  "FaithForm — church management that gives your staff their week back.";

export function renderEmail(doc: EmailDocument): RenderedEmail {
  return { html: renderHtml(doc), text: renderText(doc) };
}

function renderHtml(doc: EmailDocument): string {
  const brand = doc.brand ?? faithformBrand();
  const body = doc.blocks.map((block) => renderBlock(block, brand)).join("\n");
  const footerNote = doc.footerNote ?? DEFAULT_FOOTER;
  const permissionNote =
    doc.permissionNote ??
    "You received this because someone at your church uses FaithForm.";
  const site = getCanonicalSiteUrl();

  // A logo is optional: a church that has not uploaded one gets its name set
  // in the wordmark alone, which is better than a broken image icon.
  //
  // The absolute-URL check is here rather than at the call site because an
  // email has no origin to resolve a relative path against —
  // "/church-logos/x.png" is a broken image in every inbox on earth. Enforcing
  // it in the one place that writes the tag means no caller can reintroduce
  // it. http is tolerated only so a local build still previews its own logo;
  // every real send resolves to the https canonical origin.
  const safeLogo =
    brand.logoUrl && /^https?:\/\//i.test(brand.logoUrl) ? brand.logoUrl : null;
  const logoCell = safeLogo
    ? `<td style="padding-right:12px;vertical-align:middle;">
                    <img src="${escapeHtml(safeLogo)}" width="44" height="44" alt="" style="display:block;width:44px;height:44px;border:0;border-radius:10px;" />
                  </td>`
    : "";

  return `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" lang="en">
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="x-apple-disable-message-reformatting" />
  <meta name="color-scheme" content="light" />
  <meta name="supported-color-schemes" content="light" />
  <title>${escapeHtml(doc.title)}</title>
  <!--[if mso]>
  <noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript>
  <![endif]-->
  <style>
    /* Progressive enhancement only — every client that drops this still gets
       a correct email, because the layout is inline and table-based. */
    @media only screen and (max-width:600px) {
      .ff-card { width:100% !important; border-radius:0 !important; }
      .ff-pad { padding:28px 24px !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;width:100%;background-color:${BRAND.cream};-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
  <!-- Inbox preview line. Hidden in the body, read by the client's list view. -->
  <div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">${escapeHtml(doc.preheader)}</div>
  <!-- Zero-width joiners stop clients padding the preview with body copy. -->
  <div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">&#8204;&#8204;&#8204;&#8204;&#8204;&#8204;&#8204;&#8204;&#8204;&#8204;&#8204;&#8204;&#8204;&#8204;&#8204;&#8204;&#8204;&#8204;&#8204;&#8204;</div>

  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:${BRAND.cream};">
    <tr>
      <td align="center" style="padding:32px 12px;">

        <table role="presentation" class="ff-card" cellpadding="0" cellspacing="0" border="0" width="600" style="width:600px;max-width:600px;background-color:${BRAND.white};border-radius:14px;overflow:hidden;box-shadow:0 2px 12px rgba(0,45,95,0.07);">

          <tr>
            <td align="center" bgcolor="${brand.primary}" style="background-color:${brand.primary};padding:28px 24px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  ${logoCell}
                  <td style="vertical-align:middle;">
                    <span style="font-family:${HEADING_STACK};font-size:26px;font-weight:700;color:${BRAND.white};letter-spacing:-0.5px;">${escapeHtml(brand.name)}</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td class="ff-pad" style="padding:36px 40px 32px;">
              <h1 style="margin:0 0 20px;font-family:${FONT_STACK};font-size:23px;font-weight:700;line-height:1.35;color:${brand.primary};">${escapeHtml(doc.heading)}</h1>
${body}
            </td>
          </tr>

          <tr>
            <td class="ff-pad" style="padding:0 40px 32px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr><td style="border-top:1px solid ${BRAND.border};font-size:0;line-height:0;height:1px;">&nbsp;</td></tr></table>
              <p style="margin:20px 0 0;font-family:${FONT_STACK};font-size:13px;line-height:1.6;color:${BRAND.faint};">${escapeHtml(footerNote)}</p>
              <p style="margin:8px 0 0;font-family:${FONT_STACK};font-size:13px;line-height:1.6;color:${BRAND.faint};">
                <a href="${escapeHtml(site)}" style="color:${BRAND.muted};text-decoration:underline;">faithform.io</a>
              </p>
            </td>
          </tr>

        </table>

        <p style="margin:20px 0 0;font-family:${FONT_STACK};font-size:12px;line-height:1.5;color:${BRAND.faint};max-width:600px;">
          ${escapeHtml(permissionNote)}
        </p>

      </td>
    </tr>
  </table>
</body>
</html>`;
}

/**
 * The plain-text part, from the same blocks.
 *
 * Not a nicety: an HTML-only message scores worse with spam filters, and is
 * what a text-mode or accessibility client is left to guess at. Because it is
 * generated here rather than written by hand, it cannot fall behind the HTML.
 */
function renderText(doc: EmailDocument): string {
  const lines: string[] = [doc.heading, "=".repeat(Math.min(doc.heading.length, 60)), ""];

  for (const block of doc.blocks) {
    switch (block.kind) {
      case "paragraph":
        lines.push(block.text, "");
        break;
      case "subheading":
        lines.push(block.text.toUpperCase(), "");
        break;
      case "button":
        lines.push(`${block.label}: ${block.url}`, "");
        break;
      case "detail":
        lines.push(`${block.label}: ${block.value}`);
        break;
      case "quote":
        lines.push(
          block.text
            .split("\n")
            .map((line) => `> ${line}`)
            .join("\n"),
          "",
        );
        break;
      case "muted":
        lines.push(block.text, "");
        break;
      case "list":
        lines.push(...block.items.map((item) => `  - ${item}`), "");
        break;
      case "callout":
        lines.push(block.title.toUpperCase());
        lines.push(...block.rows.map((row) => `  ${row.label}: ${row.value}`), "");
        break;
      case "divider":
        lines.push("---", "");
        break;
    }
  }

  lines.push("", doc.footerNote ?? DEFAULT_FOOTER, getCanonicalSiteUrl());

  // Collapse the runs of blank lines the detail rows leave behind.
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
