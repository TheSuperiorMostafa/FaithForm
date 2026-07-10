export const DEFAULT_FOLLOW_UP_TEMPLATES = [
  "Hey [Name], we missed you at service this week! Hope everything is okay. We'd love to see you next Sunday.",
  "Hi [Name]! Just wanted to reach out — you've been on our hearts. We missed you this week and hope to see you soon.",
  "[Name], we noticed you weren't with us again this week. You're always welcome back — we'd love to see you Sunday.",
  "Hey [Name], the community isn't the same without you. Hoping all is well and we'll see you soon!",
  "Hi [Name]! We care about you and just wanted to check in. We miss having you with us and hope to see you next week.",
] as const;

export const FOLLOW_UP_TEMPLATE_COUNT = DEFAULT_FOLLOW_UP_TEMPLATES.length;

export const FOLLOW_UP_TEMPLATE_LABELS = [
  "1st absence",
  "2nd consecutive absence",
  "3rd consecutive absence",
  "4th consecutive absence",
  "5th+ consecutive absence",
] as const;

const NAME_PLACEHOLDER = "[Name]";
const MAX_MESSAGE_LENGTH = 480;

export function pickFollowUpMessage(
  firstName: string,
  consecutiveAbsent: number,
  templates: readonly string[] = DEFAULT_FOLLOW_UP_TEMPLATES,
): string {
  const normalized = normalizeFollowUpTemplates(templates);
  const index = Math.min(Math.max(consecutiveAbsent, 1), normalized.length) - 1;
  const template = normalized[index];
  const name = firstName.trim() || "there";
  return template.includes(NAME_PLACEHOLDER)
    ? template.replaceAll(NAME_PLACEHOLDER, name)
    : `${template} ${name}`.trim();
}

export function normalizeFollowUpTemplates(
  templates: readonly string[] | null | undefined,
): string[] {
  const source =
    templates && templates.length > 0
      ? templates
      : [...DEFAULT_FOLLOW_UP_TEMPLATES];

  return Array.from({ length: FOLLOW_UP_TEMPLATE_COUNT }, (_, index) => {
    const value = source[index]?.trim();
    return value || DEFAULT_FOLLOW_UP_TEMPLATES[index];
  });
}

export function validateFollowUpTemplates(
  templates: string[],
): { ok: true; templates: string[] } | { ok: false; error: string } {
  if (templates.length !== FOLLOW_UP_TEMPLATE_COUNT) {
    return {
      ok: false,
      error: `Provide exactly ${FOLLOW_UP_TEMPLATE_COUNT} follow-up messages.`,
    };
  }

  const normalized: string[] = [];

  for (let index = 0; index < templates.length; index++) {
    const message = templates[index]?.trim() ?? "";
    const label = FOLLOW_UP_TEMPLATE_LABELS[index];

    if (!message) {
      return { ok: false, error: `${label}: message cannot be empty.` };
    }

    if (message.length > MAX_MESSAGE_LENGTH) {
      return {
        ok: false,
        error: `${label}: keep messages under ${MAX_MESSAGE_LENGTH} characters.`,
      };
    }

    if (!message.includes(NAME_PLACEHOLDER)) {
      return {
        ok: false,
        error: `${label}: include ${NAME_PLACEHOLDER} where the member's first name should appear.`,
      };
    }

    normalized.push(message);
  }

  return { ok: true, templates: normalized };
}

export function parseFollowUpTemplatesFromDb(
  value: unknown,
): string[] | null {
  if (!Array.isArray(value)) return null;
  const strings = value.filter((item): item is string => typeof item === "string");
  if (strings.length === 0) return null;
  return normalizeFollowUpTemplates(strings);
}
