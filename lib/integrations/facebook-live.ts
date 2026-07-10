import type { SupabaseClient } from "@supabase/supabase-js";
import { getIntegration, saveIntegration } from "@/lib/integrations/tokens";
import type { FacebookIntegrationMetadata } from "@/lib/integrations/types";
import { setStreamRelayDestination } from "@/lib/stream/relay";

const GRAPH = "https://graph.facebook.com/v21.0";

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
  userId: string,
  supabase?: SupabaseClient,
) {
  const integration = await getIntegration(churchId, "facebook", supabase);
  if (!integration) {
    throw new Error("Facebook is not connected. Connect Facebook first.");
  }

  const metadata = (integration.metadata ?? {}) as FacebookIntegrationMetadata;
  const pageId = metadata.page_id;
  if (!pageId) {
    throw new Error("Facebook Page ID is missing. Reconnect Facebook.");
  }

  const pageName = metadata.page_name ?? "FaithForm";
  const { rtmpUrl, liveVideoId } = await provisionFacebookLiveRtmpUrl(
    pageId,
    integration.access_token,
    `${pageName} — FaithForm`,
  );

  await saveIntegration(
    {
      churchId,
      provider: "facebook",
      accessToken: integration.access_token,
      refreshToken: integration.refresh_token,
      tokenExpiresAt: integration.token_expires_at
        ? new Date(integration.token_expires_at)
        : null,
      metadata: {
        ...metadata,
        live_video_id: liveVideoId,
      },
      connectedBy: integration.connected_by ?? userId,
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
