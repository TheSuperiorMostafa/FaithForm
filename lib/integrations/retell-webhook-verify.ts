import { createHmac, timingSafeEqual } from "crypto";

const SIGNATURE_PATTERN = /^v=(\d+),d=(.*)$/;

export function verifyRetellWebhook(
  rawBody: string,
  signature: string | null,
  apiKey: string | undefined,
): boolean {
  if (!signature || !apiKey?.trim()) return false;

  const match = SIGNATURE_PATTERN.exec(signature.trim());
  if (!match) return false;

  const timestamp = Number.parseInt(match[1] ?? "", 10);
  const digest = match[2] ?? "";
  if (!Number.isFinite(timestamp) || !digest) return false;

  const ageMs = Math.abs(Date.now() - timestamp);
  if (ageMs > 5 * 60 * 1000) return false;

  const expected = createHmac("sha256", apiKey)
    .update(`${rawBody}${timestamp}`)
    .digest("hex");

  try {
    const a = Buffer.from(digest);
    const b = Buffer.from(expected);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
