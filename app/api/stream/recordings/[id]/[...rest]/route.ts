import { NextRequest, NextResponse } from "next/server";

import { ExpiringCache } from "@/lib/cache/expiring-cache";
import {
  recordingObjectResponse,
  recordingPlaylistResponse,
} from "@/lib/stream/recording-delivery";
import { verifyRecordingPlaybackToken } from "@/lib/stream/recording-playback";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * A segmented recording, as HLS, for the church website and the dashboard.
 *
 *     /api/stream/recordings/<recordingId>/<token>/index.m3u8
 *     /api/stream/recordings/<recordingId>/<token>/init/<takeId>.mp4
 *     /api/stream/recordings/<recordingId>/<token>/seg/<segmentId>.m4s
 *
 * A public token plays only while the recording is published to the website,
 * checked through the website's own read path (`web_recordings`) on every
 * request, with a positive answer reused for fifteen seconds. A staff token
 * is minted only after an admin check and plays the church's own recording,
 * published or not — that is what a review screen is for.
 */

const publicAuthorizations = new ExpiringCache<true>(15_000);
const slugs = new ExpiringCache<string>(5 * 60_000);

async function publiclyVisible(churchId: string, recordingId: string): Promise<boolean> {
  const key = `${churchId}|${recordingId}`;
  if (publicAuthorizations.get(key)) return true;

  const admin = createAdminClient();
  let slug = slugs.get(churchId);
  if (!slug) {
    const { data } = await admin.from("churches").select("slug").eq("id", churchId).maybeSingle();
    slug = (data?.slug as string | null) ?? undefined;
    if (!slug) return false;
    slugs.set(churchId, slug);
  }
  const { data } = await admin.rpc("web_recordings", {
    p_church_slug: slug,
    p_recording_id: recordingId,
    p_limit: 1,
  });
  const visible = ((data ?? []) as Array<{ church_id?: string }>).some((row) => row.church_id === churchId);
  if (visible) publicAuthorizations.set(key, true);
  return visible;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; rest?: string[] }> },
) {
  const { id, rest = [] } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id) || rest.length < 2) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const [token, ...media] = rest;
  const capability = verifyRecordingPlaybackToken(token, { recordingId: id });
  if (!capability) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  if (capability.audience === "public" && !(await publiclyVisible(capability.churchId, id))) {
    return NextResponse.json(
      { error: "Unavailable" },
      { status: 403, headers: { "Cache-Control": "no-store" } },
    );
  }

  const full = media.length === 1 && media[0] === "full.m3u8" && capability.audience === "staff";
  if ((media.length === 1 && media[0] === "index.m3u8") || full) {
    return recordingPlaylistResponse({
      churchId: capability.churchId,
      recordingId: id,
      basePath: request.nextUrl.pathname.replace(/\/(index|full)\.m3u8$/, ""),
      verifiedOnly: capability.audience === "public",
      ignoreTrim: full,
    });
  }

  return recordingObjectResponse({ churchId: capability.churchId, recordingId: id, rest: media });
}
