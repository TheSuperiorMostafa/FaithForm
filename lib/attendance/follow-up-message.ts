import {
  FOLLOW_UP_TEMPLATE_COUNT,
  normalizeFollowUpTemplates,
  pickFollowUpMessage,
  validateFollowUpTemplates,
} from "@/lib/sms/follow-up-messages";

/**
 * The text a pastor sees before sending, and may reword for one send.
 *
 * The church's saved messages (Settings) are chosen by how many Sundays in a
 * row someone has missed. For one send the pastor can write a single message
 * instead; it goes to everyone picked, with `[Name]` replaced by each person's
 * first name. It is checked by the same rules as the saved messages (not
 * empty, not too long, has `[Name]`) and is never saved over them.
 *
 * Pure, so the page previews exactly what the server will send.
 */

export const NAME_PLACEHOLDER = "[Name]";

export type FollowUpOverrideResult = { ok: true; message: string } | { ok: false; error: string };

/** The saved-message rules, applied to one message. */
export function validateFollowUpOverride(message: string): FollowUpOverrideResult {
  const result = validateFollowUpTemplates(Array.from({ length: FOLLOW_UP_TEMPLATE_COUNT }, () => message));
  if (!result.ok) {
    // The shared validator names which of the five saved messages is wrong
    // ("1st absence: …"); there is only one here.
    return { ok: false, error: result.error.replace(/^[^:]+:\s*/, "").replace(/^./, (c) => c.toUpperCase()) };
  }
  return { ok: true, message: result.templates[0] };
}

/** One message with `[Name]` replaced, exactly as `pickFollowUpMessage` does it. */
export function personalizeFollowUpMessage(template: string, firstName: string): string {
  return pickFollowUpMessage(firstName, 1, [template]);
}

/** Which saved message someone gets: 1 for a first miss, up to the last one. */
export function templateIndexFor(consecutiveAbsent: number): number {
  return Math.min(Math.max(consecutiveAbsent, 1), FOLLOW_UP_TEMPLATE_COUNT) - 1;
}

export type MessageGroup = {
  index: number;
  template: string;
  /** How many of the chosen people get this message. */
  count: number;
  /** Who the preview is shown for. */
  sampleFirstName: string;
  preview: string;
};

/** The saved messages the chosen people will get, most common first. */
export function groupFollowUpMessages(
  recipients: { firstName: string; consecutiveAbsent: number }[],
  templates: readonly string[],
): MessageGroup[] {
  const normalized = normalizeFollowUpTemplates(templates);
  const groups = new Map<number, MessageGroup>();
  for (const recipient of recipients) {
    const index = templateIndexFor(recipient.consecutiveAbsent);
    const existing = groups.get(index);
    if (existing) {
      existing.count += 1;
      continue;
    }
    groups.set(index, {
      index,
      template: normalized[index],
      count: 1,
      sampleFirstName: recipient.firstName,
      preview: pickFollowUpMessage(recipient.firstName, recipient.consecutiveAbsent, normalized),
    });
  }
  return Array.from(groups.values()).sort((a, b) => b.count - a.count || a.index - b.index);
}

/** "missed 1 Sunday" / "missed 3 Sundays in a row" / "missed 5 or more Sundays in a row". */
export function describeTemplateAudience(index: number): string {
  const weeks = index + 1;
  if (weeks === 1) return "missed one Sunday";
  if (weeks >= FOLLOW_UP_TEMPLATE_COUNT) return `missed ${weeks} or more Sundays in a row`;
  return `missed ${weeks} Sundays in a row`;
}
