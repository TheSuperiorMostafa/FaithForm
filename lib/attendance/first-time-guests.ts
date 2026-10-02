/**
 * First-time guests on the Sunday count sheet.
 *
 * A checkbox when someone is added marks them for this Sunday only
 * (`attendance_entries.is_first_time_guest`). After save, the sheet can text
 * the church phone with their names, and text each guest who left a number.
 *
 * Pure helpers live here so the page previews exactly what the server sends.
 */

export const GUEST_NAME_PLACEHOLDER = "[Name]";
export const GUEST_CHURCH_PLACEHOLDER = "[Church]";

const MAX_MESSAGE_LENGTH = 480;

export type FirstTimeGuest = {
  memberId: string;
  firstName: string;
  lastName: string;
  phone: string | null;
};

export type GuestMessageResult =
  | { ok: true; message: string }
  | { ok: false; error: string };

/** Default welcome text: one person, their first name and the church name. */
export function defaultWelcomeMessage(churchName: string): string {
  const church = churchName.trim() || "our church";
  return `Hi ${GUEST_NAME_PLACEHOLDER}, welcome to ${church}! We're glad you joined us today. We hope to see you again soon.`;
}

/** One editable welcome message: must include [Name], may include [Church]. */
export function validateWelcomeMessage(message: string): GuestMessageResult {
  const trimmed = message.trim();
  if (!trimmed) {
    return { ok: false, error: "Write a short welcome message." };
  }
  if (trimmed.length > MAX_MESSAGE_LENGTH) {
    return { ok: false, error: `Keep messages under ${MAX_MESSAGE_LENGTH} characters.` };
  }
  if (!trimmed.includes(GUEST_NAME_PLACEHOLDER)) {
    return {
      ok: false,
      error: `Include ${GUEST_NAME_PLACEHOLDER} where each guest's first name should appear.`,
    };
  }
  return { ok: true, message: trimmed };
}

export function personalizeWelcomeMessage(
  template: string,
  firstName: string,
  churchName: string,
): string {
  const name = firstName.trim() || "friend";
  const church = churchName.trim() || "our church";
  return template
    .replaceAll(GUEST_NAME_PLACEHOLDER, name)
    .replaceAll(GUEST_CHURCH_PLACEHOLDER, church);
}

/** Default pastor text: one message listing every first-time guest. */
export function defaultPastorMessage(
  serviceDateLabel: string,
  guests: FirstTimeGuest[],
): string {
  const lines = guests.map((guest) => {
    const name = `${guest.firstName} ${guest.lastName}`.trim() || guest.firstName;
    const phone = guest.phone?.trim();
    return phone ? `• ${name} — ${phone}` : `• ${name}`;
  });
  const heading =
    guests.length === 1
      ? `1 first-time guest on ${serviceDateLabel}:`
      : `${guests.length} first-time guests on ${serviceDateLabel}:`;
  return [heading, ...lines, "", "Please welcome them."].join("\n");
}

/** Pastor message is one text to the church phone — no [Name] required. */
export function validatePastorMessage(message: string): GuestMessageResult {
  const trimmed = message.trim();
  if (!trimmed) {
    return { ok: false, error: "Write a short message for the pastor." };
  }
  if (trimmed.length > MAX_MESSAGE_LENGTH) {
    return { ok: false, error: `Keep messages under ${MAX_MESSAGE_LENGTH} characters.` };
  }
  return { ok: true, message: trimmed };
}

export function guestDisplayName(guest: Pick<FirstTimeGuest, "firstName" | "lastName">): string {
  return `${guest.firstName} ${guest.lastName}`.trim() || guest.firstName;
}
