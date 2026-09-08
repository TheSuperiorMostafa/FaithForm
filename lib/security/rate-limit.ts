import { createHmac } from "crypto";
import { createAdminClientOrNull } from "@/lib/supabase/admin";

export type RateLimitOptions = {
  limit: number;
  windowMs: number;
};

/**
 * `limited` means the caller really did exceed the allowance. `unavailable`
 * means the limiter itself could not answer, and the request is refused
 * because failing open on a login endpoint is worse than failing closed.
 *
 * The distinction exists because callers were telling people "too many
 * attempts" for both. A broken limiter then presents exactly as a permanent
 * lockout: every browser, every account, no attempt count that could explain
 * it, and nothing in the product that says otherwise.
 */
export type RateLimitResult =
  | { ok: true }
  | { ok: false; reason: "limited" | "unavailable"; retryAfterSeconds: number };

/**
 * Forwarded headers are accepted only when the deployment explicitly declares
 * a trusted proxy (Vercel does this by setting VERCEL=1). Direct deployments
 * otherwise share an "untrusted" signal until the operator configures the
 * proxy, which is safer than accepting a spoofable client header.
 */
export function getClientIp(request: Request): string {
  const trustProxy =
    process.env.VERCEL === "1" || process.env.TRUST_PROXY_HEADERS === "true";
  if (!trustProxy) return "untrusted";

  const vercel = request.headers.get("x-vercel-forwarded-for")?.trim();
  if (vercel) return vercel.split(",")[0]?.trim() || "unknown";
  const forwarded = request.headers.get("x-forwarded-for")?.trim();
  if (forwarded) return forwarded.split(",")[0]?.trim() || "unknown";
  return request.headers.get("x-real-ip")?.trim() || "unknown";
}

function rateLimitSecret(): string {
  const secret = process.env.RATE_LIMIT_KEY_SECRET?.trim();
  if (process.env.NODE_ENV === "production") {
    if (!secret || secret.length < 32 || secret.startsWith("replace-me")) {
      throw new Error("Rate limiting is unavailable.");
    }
    return secret;
  }
  return secret || "dev-only-rate-limit-key-secret";
}

export function hashRateLimitKey(key: string, secret?: string): string {
  return createHmac("sha256", secret ?? rateLimitSecret())
    .update(key)
    .digest("base64url");
}

export async function checkRateLimit(
  key: string,
  options: RateLimitOptions,
): Promise<RateLimitResult> {
  if (
    !Number.isInteger(options.limit) ||
    options.limit < 1 ||
    !Number.isInteger(options.windowMs) ||
    options.windowMs < 1000
  ) {
    console.error("[rate-limit] called with invalid options", options);
    return { ok: false, reason: "unavailable", retryAfterSeconds: 60 };
  }

  const admin = createAdminClientOrNull();
  if (!admin) {
    console.error(
      "[rate-limit] no service-role client: every rate-limited route now refuses",
    );
    return { ok: false, reason: "unavailable", retryAfterSeconds: 60 };
  }

  let hashedKey: string;
  try {
    hashedKey = hashRateLimitKey(key);
  } catch (err) {
    console.error(
      "[rate-limit] RATE_LIMIT_KEY_SECRET is missing or rejected: every rate-limited route now refuses",
      err,
    );
    return { ok: false, reason: "unavailable", retryAfterSeconds: 60 };
  }

  const windowSeconds = Math.ceil(options.windowMs / 1000);
  const { data, error } = await admin.rpc("consume_api_rate_limit", {
    p_rate_key: hashedKey,
    p_limit: options.limit,
    p_window_seconds: windowSeconds,
  });

  if (error || !data?.[0]) {
    console.error(
      "[rate-limit] consume_api_rate_limit did not answer: every rate-limited route now refuses",
      error,
    );
    return { ok: false, reason: "unavailable", retryAfterSeconds: 60 };
  }

  const result = data[0] as {
    allowed: boolean;
    retry_after_seconds: number;
  };
  if (result.allowed) return { ok: true };
  return {
    ok: false,
    reason: "limited",
    retryAfterSeconds: Math.max(1, result.retry_after_seconds || 1),
  };
}

export async function assertRateLimit(
  key: string,
  options: RateLimitOptions,
): Promise<RateLimitResult> {
  return checkRateLimit(key, options);
}

export function rateLimitResponse(retryAfterSeconds: number): Response {
  return new Response(JSON.stringify({ error: "Too many requests" }), {
    status: 429,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "Retry-After": String(retryAfterSeconds),
    },
  });
}
