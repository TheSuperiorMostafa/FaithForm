/**
 * A US tax ID (EIN) is nine digits, written 12-3456789. People type it with
 * spaces, without the dash, or with the dash in the wrong place; all of those
 * are the same number, so they are accepted and stored one way.
 */
export function normalizeEin(input: string | null | undefined):
  | { ok: true; value: string | null }
  | { ok: false; error: string } {
  const trimmed = (input ?? "").trim();
  if (!trimmed) return { ok: true, value: null };
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length !== 9 || /[^0-9\s-]/.test(trimmed)) {
    return {
      ok: false,
      error: "A tax ID (EIN) is 9 digits, like 12-3456789. Check the number and try again.",
    };
  }
  return { ok: true, value: `${digits.slice(0, 2)}-${digits.slice(2)}` };
}
