import { Resend } from "resend";

import { renderEmail } from "@/lib/email/layout";

/**
 * The doorbell for a member's safety report.
 *
 * A report is already recorded for the church's own moderators, and mirrored
 * to the chat provider's flags. What was missing is us: App Store guideline
 * 1.2 asks the developer — not only the community that hosts the content — to
 * act on reports of objectionable content, and /terms now says we do so within
 * 24 hours. A church whose moderators are asleep cannot make that true on its
 * own, so every report rings here as well.
 *
 * What is *not* in the mail: the reporter's name, the reported person's name,
 * the message text, and anything else that identifies a member. A safety
 * inbox does not need them to act — the report id opens the record — and this
 * mail travels further than the record does. The church, the reason and the
 * ids are enough to find it and to judge how urgent it is.
 *
 * Failure is swallowed, like the rest of our mail: the report row is committed
 * before this runs, and a Resend outage must never turn a received report into
 * an error the person reporting abuse sees.
 */

/** The mailbox safety reports ring, defaulting to the one support runs on. */
function safetyRecipients(): string[] {
  const configured =
    process.env.SAFETY_NOTIFY_EMAIL?.trim() || process.env.SUPPORT_NOTIFY_EMAIL?.trim();
  if (configured) {
    return configured
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
  }
  return ["support@faithform.io"];
}

export type SafetyReportEmailParams = {
  /** The church the conversation belongs to, for triage. */
  churchSlug: string;
  /** "message" or "user". */
  reportType: string;
  /** One of REPORT_REASONS. */
  reason: string;
  /** Whether the reported message carried attachments. */
  hasAttachments: boolean;
  /** The conversation, so the record can be found. */
  channelCid: string;
  messageId: string | null;
};

export async function sendSafetyReportNotification(
  params: SafetyReportEmailParams,
): Promise<{ emailed: boolean }> {
  const apiKey = process.env.RESEND_API_KEY;
  const to = safetyRecipients();
  if (!apiKey || to.length === 0) {
    console.log("[FaithForm] Safety report notification not sent: email is not configured.");
    return { emailed: false };
  }

  const subject = `Safety report (${params.reason}) in ${params.churchSlug}`;
  const content = renderEmail({
    title: subject,
    preheader: `A ${params.reportType} was reported in ${params.churchSlug}.`,
    heading: "A member reported content",
    blocks: [
      { kind: "detail", label: "Church", value: params.churchSlug },
      { kind: "detail", label: "Reported", value: params.reportType },
      { kind: "detail", label: "Reason", value: params.reason },
      { kind: "detail", label: "Conversation", value: params.channelCid },
      ...(params.messageId
        ? [{ kind: "detail" as const, label: "Message", value: params.messageId }]
        : []),
      ...(params.hasAttachments
        ? [{ kind: "detail" as const, label: "Attachments", value: "Yes" }]
        : []),
      {
        kind: "paragraph",
        text: "Open the church's moderation queue to read the report and act on it. Objectionable content is removed, and the person who posted it removed, within 24 hours of the report.",
      },
    ],
    footerNote: "FaithForm safety",
    permissionNote: "You received this because you handle FaithForm safety reports.",
  });

  try {
    const { error } = await new Resend(apiKey).emails.send({
      from: `FaithForm Safety <${process.env.SUPPORT_FROM_EMAIL?.trim() || "support@faithform.io"}>`,
      to,
      subject,
      html: content.html,
      text: content.text,
    });
    if (error) {
      console.error("[FaithForm] Safety report notification Resend error:", error);
      return { emailed: false };
    }
    return { emailed: true };
  } catch (error) {
    console.error("[FaithForm] Safety report notification failed:", error);
    return { emailed: false };
  }
}
