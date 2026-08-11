import type { SupabaseClient } from "@supabase/supabase-js";
// Imported from facebook-token rather than facebook to keep this module free of
// a cycle — facebook.ts imports provisionFacebookLiveRtmpUrl from here.
import {
  getFacebookPageAccessToken,
  GRAPH,
} from "@/lib/integrations/facebook-token";
import { getIntegration, saveIntegration } from "@/lib/integrations/tokens";
import type { FacebookIntegrationMetadata } from "@/lib/integrations/types";
import { setStreamRelayDestination } from "@/lib/stream/relay";

export async function provisionFacebookLiveRtmpUrl(
  pageId: string,
  pageAccessToken: string,
  title: string,
): Promise<{ rtmpUrl: string; liveVideoId: string }> {
  const body = new URLSearchParams({
    status: "LIVE_NOW",
    title: title.slice(0, 255) || "FaithForm Live",
    description: "Live stream via FaithForm",
    access_token: pageAccessToken,
  });

  const res = await fetch(`${GRAPH}/${pageId}/live_videos`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  const data = (await res.json()) as {
    id?: string;
    secure_stream_url?: string;
    stream_url?: string;
    error?: { message: string };
  };

  const rtmpUrl = data.secure_stream_url ?? data.stream_url;
  if (!res.ok || !rtmpUrl || !data.id) {
    throw new Error(
      data.error?.message ?? "Facebook did not return a live stream URL.",
    );
  }

  return { rtmpUrl, liveVideoId: data.id };
}

export async function provisionFacebookLiveForChurch(
  churchId: string,
  userId: string | null,
  supabase?: SupabaseClient,
) {
  const integration = await getIntegration(churchId, "facebook", supabase);
  if (!integration) {
    throw new Error("Facebook is not connected. Connect Facebook first.");
  }

  const metadata = (integration.metadata ?? {}) as FacebookIntegrationMetadata;

  // Resolves through the long-lived user token, so a Page token that went stale
  // between services is re-minted here instead of failing the go-live.
  const { token: pageToken, pageId } = await getFacebookPageAccessToken(
    churchId,
    supabase,
  );

  const pageName = metadata.page_name ?? "FaithForm";
  const { rtmpUrl, liveVideoId } = await provisionFacebookLiveRtmpUrl(
    pageId,
    pageToken,
    `${pageName} — FaithForm`,
  );

  await saveIntegration(
    {
      churchId,
      provider: "facebook",
      accessToken: pageToken,
      // refreshToken/tokenExpiresAt omitted: this is a metadata write, and
      // saveIntegration keeps the stored long-lived user token in place.
      metadata: {
        ...metadata,
        live_video_id: liveVideoId,
      },
      connectedBy: integration.connected_by ?? userId ?? undefined,
    },
    supabase,
  );

  await setStreamRelayDestination(
    churchId,
    "facebook",
    rtmpUrl,
    userId,
    supabase,
  );
}

/**
 * Ends the Page's current live video when the service is over.
 *
 * Nothing told Facebook a service had finished. It eventually times the video
 * out on its own after the stream stops, but until then the Page shows a live
 * broadcast that is not being fed — and a stale `live_video_id` left in
 * metadata is a broadcast the next service could try to reuse.
 *
 * Best effort throughout, like `completeYouTubeBroadcast`: a platform that will
 * not shut down cleanly must never leave the local session stuck live.
 */
export async function endFacebookLiveVideo(
  churchId: string,
  supabase?: SupabaseClient,
): Promise<{ ok: boolean; status?: string; error?: string }> {
  const integration = await getIntegration(churchId, "facebook", supabase);
  if (!integration) return { ok: true, status: "not_connected" };

  const metadata = (integration.metadata ?? {}) as FacebookIntegrationMetadata;
  const liveVideoId = metadata.live_video_id;
  if (!liveVideoId) return { ok: true, status: "no_live_video" };

  let result: { ok: boolean; status?: string; error?: string } = {
    ok: true,
    status: "ended",
  };

  try {
    const { token } = await getFacebookPageAccessToken(churchId, supabase);
    const res = await fetch(`${GRAPH}/${liveVideoId}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        end_live_video: "true",
        access_token: token,
      }),
    });

    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as {
        error?: { message?: string };
      };
      const message = data.error?.message ?? `HTTP ${res.status}`;
      // Already over, or gone entirely — both are the state we wanted.
      if (!/not.*live|already ended|does not exist|Unsupported/i.test(message)) {
        console.error("endFacebookLiveVideo:", message);
        result = { ok: false, error: message };
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "end failed";
    console.error("endFacebookLiveVideo:", message);
    result = { ok: false, error: message };
  }

  // Drop the pointer either way. The next service provisions its own video, and
  // a stale id here would aim the next end-of-service at one already gone.
  const current = await getIntegration(churchId, "facebook", supabase);
  if (current) {
    const currentMeta = (current.metadata ?? {}) as FacebookIntegrationMetadata;
    await saveIntegration(
      {
        churchId,
        provider: "facebook",
        accessToken: current.access_token,
        metadata: { ...currentMeta, live_video_id: undefined },
        connectedBy: current.connected_by ?? undefined,
      },
      supabase,
    );
  }

  return result;
}
