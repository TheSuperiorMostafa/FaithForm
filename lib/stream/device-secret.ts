import { createHash, randomBytes, randomInt, timingSafeEqual } from "crypto";

function getPepper(): string {
  const pepper =
    process.env.STREAM_DEVICE_SECRET_PEPPER?.trim() ??
    process.env.INTEGRATION_OAUTH_STATE_SECRET?.trim();
  if (!pepper) {
    throw new Error(
      "Missing STREAM_DEVICE_SECRET_PEPPER or INTEGRATION_OAUTH_STATE_SECRET",
    );
  }
  return pepper;
}

export function hashStreamSecret(value: string): string {
  return createHash("sha256")
    .update(`${getPepper()}:${value}`)
    .digest("hex");
}

export function verifyStreamSecret(
  provided: string | null | undefined,
  expectedHash: string | null | undefined,
): boolean {
  if (!provided || !expectedHash) return false;
  const providedHash = hashStreamSecret(provided);
  try {
    const a = Buffer.from(providedHash);
    const b = Buffer.from(expectedHash);
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export function generateDeviceSecret(): string {
  return randomBytes(32).toString("base64url");
}

export function generatePairingCode(): string {
  return String(randomInt(100000, 1000000));
}
