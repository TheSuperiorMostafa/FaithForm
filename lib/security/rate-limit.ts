import { createAdminClientOrNull } from "@/lib/supabase/admin";

export type RateLimitOptions = {
  limit: number;
  windowMs: number;
};

export type RateLimitResult =
  | { ok: true }
  | { ok: false; retryAfterSeconds: number };

export function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0]?.trim() || "unknown";
  }
  return request.headers.get("x-real-ip")?.trim() || "unknown";
}

export async function checkRateLimit(
  key: string,
  options: RateLimitOptions,
): Promise<RateLimitResult> {
  const admin = createAdminClientOrNull();
  if (!admin) {
    return { ok: true };
  }

  const now = new Date();
  const windowStart = new Date(now.getTime() - (now.getTime() % options.windowMs));

  const { data: existing, error: selectError } = await admin
    .from("api_rate_limits")
    .select("rate_key, window_start, hit_count")
    .eq("rate_key", key)
    .maybeSingle();

  if (selectError) {
    console.error("[rate-limit] select failed:", selectError.message);
    return { ok: true };
  }

  const existingWindow = existing?.window_start
    ? new Date(existing.window_start as string).getTime()
    : null;
  const currentWindow = windowStart.getTime();

  if (!existing || existingWindow !== currentWindow) {
    const { error: upsertError } = await admin.from("api_rate_limits").upsert(
      {
        rate_key: key,
        window_start: windowStart.toISOString(),
        hit_count: 1,
      },
      { onConflict: "rate_key" },
    );

    if (upsertError) {
      console.error("[rate-limit] upsert failed:", upsertError.message);
    }
    return { ok: true };
  }

  const hitCount = (existing.hit_count as number) + 1;

  if (hitCount > options.limit) {
    const retryAfterSeconds = Math.ceil(
      (currentWindow + options.windowMs - now.getTime()) / 1000,
    );
    return { ok: false, retryAfterSeconds: Math.max(retryAfterSeconds, 1) };
  }

  const { error: updateError } = await admin
    .from("api_rate_limits")
    .update({ hit_count: hitCount })
    .eq("rate_key", key);

  if (updateError) {
    console.error("[rate-limit] update failed:", updateError.message);
  }

  return { ok: true };
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
      "Retry-After": String(retryAfterSeconds),
    },
  });
}
