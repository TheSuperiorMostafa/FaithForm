export function toE164(phone: string | null | undefined): string | null {
  if (!phone?.trim()) return null;
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (phone.trim().startsWith("+") && digits.length >= 10) return `+${digits}`;
  return null;
}

/**
 * Formats a US number while it is typed: `123`, `123-456`, `123-456-7890`.
 *
 * Only digits survive, a leading country code 1 is dropped once the rest is
 * long enough to be a full number, and anything past ten digits is cut off so
 * a paste of "+1 (502) 555-0100" lands as "502-555-0100". Input that starts
 * with "+" and is not +1 is an international number and is left alone —
 * `toE164` accepts it as written.
 */
export function formatUsPhoneInput(raw: string): string {
  const trimmed = raw.trimStart();
  if (trimmed.startsWith("+") && !trimmed.startsWith("+1")) return raw;

  let digits = raw.replace(/\D/g, "");
  if (digits.length > 10 && digits.startsWith("1")) digits = digits.slice(1);
  digits = digits.slice(0, 10);

  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
}

/** A stored number (E.164 or anything else) as `123-456-7890` when it is a US number. */
export function formatUsPhoneDisplay(phone: string | null | undefined): string | null {
  if (!phone?.trim()) return null;
  const digits = phone.replace(/\D/g, "");
  const national =
    digits.length === 11 && digits.startsWith("1")
      ? digits.slice(1)
      : digits.length === 10
        ? digits
        : null;
  if (!national) return phone;
  return `${national.slice(0, 3)}-${national.slice(3, 6)}-${national.slice(6)}`;
}
