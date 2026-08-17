import { NextResponse } from "next/server";
import { getChurchBySlug } from "@/lib/queries/giving";
import {
  recordMediaView,
  type MediaViewKind,
  type MediaViewSource,
} from "@/lib/stream/media-library";
import { getActiveStreamSession } from "@/lib/stream/sessions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KINDS: MediaViewKind[] = ["live", "replay"];
const SOURCES: MediaViewSource[] = ["website", "app", "embed"];

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
    const body = (await request.json()) as {
      slug?: string;
      recordingId?: string;
      kind?: string;
      source?: string;
      viewerKey?: string;
    };

    const slug = body.slug?.trim();
    if (!slug) {
      return NextResponse.json({ error: "Missing church" }, { status: 400 });
    }

    const church = await getChurchBySlug(slug);
    if (!church) {
      return NextResponse.json({ error: "Unknown church" }, { status: 404 });
    }

    const kind = KINDS.includes(body.kind as MediaViewKind)
      ? (body.kind as MediaViewKind)
      : "replay";
    const source = SOURCES.includes(body.source as MediaViewSource)
      ? (body.source as MediaViewSource)
      : "website";

    // A live view has no recording yet, so it is counted against the session
    // that is running; the recording inherits those numbers once it lands.
    let streamSessionId: string | null = null;
    if (kind === "live") {
      const session = await getActiveStreamSession(church.churchId).catch(() => null);
      streamSessionId = session?.id ?? null;
    }

    await recordMediaView({
      churchId: church.churchId,
      recordingId: kind === "replay" ? (body.recordingId ?? null) : null,
      streamSessionId,
      kind,
      source,
      viewerKey: body.viewerKey?.slice(0, 64) ?? null,
    });

    return NextResponse.json({ ok: true });
  } catch {
    // Never let a counting failure surface to a viewer mid-playback.
    return NextResponse.json({ ok: false });
  }
}
