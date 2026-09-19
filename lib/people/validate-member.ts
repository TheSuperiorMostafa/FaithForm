import { formatUsPhoneDisplay, toE164 } from "@/lib/sms/phone";

export type MemberInput = {
  firstName: string;
  lastName?: string;
  phone?: string;
  email?: string;
};

export type ValidatedMemberInput = {
  firstName: string;
  /** Empty string when unknown — the column is NOT NULL, and "" reads as "no last name". */
  lastName: string;
  phone: string | null;
  email: string | null;
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateMemberInput(
  input: MemberInput,
): { ok: true; data: ValidatedMemberInput } | { ok: false; error: string } {
  const firstName = input.firstName.trim();
  const lastName = input.lastName?.trim() ?? "";
  const phoneRaw = input.phone?.trim() ?? "";
  const emailRaw = input.email?.trim() ?? "";

  if (!firstName) {
    return { ok: false, error: "First name is required." };
  }

  let phone: string | null = null;
  if (phoneRaw) {
    const normalized = toE164(phoneRaw);
    if (!normalized) {
      return {
        ok: false,
        error: "Enter a valid phone number, like 123-456-7890.",
      };
    }
    phone = normalized;
  }

  let email: string | null = null;
  if (emailRaw) {
    if (!EMAIL_PATTERN.test(emailRaw)) {
      return { ok: false, error: "Enter a valid email address." };
    }
    email = emailRaw.toLowerCase();
  }

  return {
    ok: true,
    data: { firstName, lastName, phone, email },
  };
}

export function formatPhoneDisplay(phone: string | null | undefined): string | null {
  return formatUsPhoneDisplay(phone);
}
