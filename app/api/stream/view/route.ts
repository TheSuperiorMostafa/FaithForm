import { NextResponse } from "next/server";
import { getChurchBySlug } from "@/lib/queries/giving";
import {
  recordMediaView,
  type MediaViewKind,
  type MediaViewSource,
} from "@/lib/stream/media-library";
import { getActiveStreamSession } from "@/lib/stream/sessions";
import { z } from "zod";
import {
  assertRateLimit,
  getClientIp,
  rateLimitResponse,
} from "@/lib/security/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KINDS: MediaViewKind[] = ["live", "replay"];
const SOURCES: MediaViewSource[] = ["website", "app", "embed"];
const bodySchema = z.object({
  slug: z.string().trim().min(1).max(100),
  recordingId: z.string().uuid().optional(),
  kind: z.enum(["live", "replay"]),
  source: z.enum(["website", "app", "embed"]).optional(),
  viewerKey: z.string().uuid().nullable().optional(),
});

/**
 * Counts one play.
 *
 * Public by design — a visitor watching a sermon is not signed in. Writes go
 * through the service role rather than letting anonymous clients insert
 * directly, and the payload carries no identity: `viewerKey` is an opaque
 * random string the player keeps in local storage purely so repeat plays by one
 * person collapse into a single unique viewer.
 */
export async function POST(request: Request) {
  try {
    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (contentLength > 2048) {
      return NextResponse.json({ error: "Invalid request" }, { status: 413 });
    }
    const parsed = bodySchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }
    const body = parsed.data;
    const slug = body.slug;

    const rate = await assertRateLimit(
      `stream-view:${getClientIp(request)}:${slug}:${body.viewerKey ?? "none"}`,
      { limit: 20, windowMs: 60 * 60 * 1000 },
    );
    if (!rate.ok) return rateLimitResponse(rate.retryAfterSeconds);

    const church = await getChurchBySlug(slug);
    if (!church) {
      return NextResponse.json({ error: "Unknown church" }, { status: 404 });
    }

    const kind = KINDS.includes(body.kind) ? body.kind : "replay";
    const source = SOURCES.includes(body.source as MediaViewSource)
      ? (body.source as MediaViewSource)
      : "website";

    // A live view has no recording yet, so it is counted against the session
    // that is running; the recording inherits those numbers once it lands.
    let streamSessionId: string | null = null;
    if (kind === "live") {
      const session = await getActiveStreamSession(church.churchId).catch(() => null);
      if (!session?.id || !session.streamEventId) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      const admin = (await import("@/lib/supabase/admin")).createAdminClient();
      const { data: publicEvent } = await admin
        .from("stream_events")
        .select("id")
        .eq("id", session.streamEventId)
        .eq("church_id", church.churchId)
        .eq("status", "live")
        .eq("public_access", true)
        .maybeSingle();
      if (!publicEvent?.id) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      streamSessionId = session.id;
    } else if (!body.recordingId) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }

    await recordMediaView({
      churchId: church.churchId,
      recordingId: kind === "replay" ? body.recordingId : null,
      streamSessionId,
      kind,
      source,
      viewerKey: body.viewerKey ?? null,
    });

    return NextResponse.json({ ok: true });
  } catch {
    // Never let a counting failure surface to a viewer mid-playback.
    return NextResponse.json({ ok: false });
  }
}
