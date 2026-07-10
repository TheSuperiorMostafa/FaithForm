import { timingSafeEqual } from "crypto";

export function compareSecret(provided: string | null, expected: string | undefined): boolean {
  if (!provided || !expected) return false;

  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;

  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
