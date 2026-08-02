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
