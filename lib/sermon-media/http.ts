import "server-only";

import { NextResponse } from "next/server";

import { ClipRuleError, type ClipRow } from "@/lib/sermon-media/clips";
import { requireRecordingAccess, type RecordingAccess } from "@/lib/sermon-media/access";
import { createAdminClient } from "@/lib/supabase/admin";
import { assertRateLimit } from "@/lib/security/rate-limit";

const NO_STORE = { "Cache-Control": "no-store" };

export const ok = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: NO_STORE });
export const fail = (status: number, error: string, extra: Record<string, unknown> = {}) =>
  NextResponse.json({ error, ...extra }, { status, headers: NO_STORE });

/** Turns a thrown error into plain language; internals go to the log only. */
export function routeError(error: unknown, fallback: string, context: string): NextResponse {
  if (error instanceof ClipRuleError) return fail(422, error.message);
  console.error(JSON.stringify({ msg: "sermon_media", event: "route_error", context, error: error instanceof Error ? error.message.slice(0, 200) : "unknown" }));
  return fail(500, fallback);
}

export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

export async function limit(key: string, perHour: number): Promise<NextResponse | null> {
  const result = await assertRateLimit(key, { limit: perHour, windowMs: 60 * 60 * 1000 });
  return result.ok ? null : fail(429, "That's a lot of requests in a short time. Please wait a few minutes and try again.");
}

/** Loads a clip in the caller's church and authorizes its recording. */
export async function requireClipAccess(
  clipId: string,
  need: "view" | "edit" | "publish",
): Promise<{ ok: true; access: RecordingAccess; clip: ClipRow } | { ok: false; response: NextResponse }> {
  if (!/^[0-9a-f-]{36}$/i.test(clipId)) return { ok: false, response: fail(404, "We couldn't find that clip.") };
  const { data } = await createAdminClient().from("sermon_clips").select("recording_id").eq("id", clipId).maybeSingle();
  if (!data) return { ok: false, response: fail(404, "We couldn't find that clip.") };
  const allowed = await requireRecordingAccess(data.recording_id, need);
  if (!allowed.ok) return allowed;
  const { data: clip } = await createAdminClient()
    .from("sermon_clips")
    .select("*")
    .eq("id", clipId)
    .eq("church_id", allowed.access.auth.churchId)
    .maybeSingle();
  if (!clip) return { ok: false, response: fail(404, "We couldn't find that clip.") };
  return { ok: true, access: allowed.access, clip: clip as ClipRow };
}
