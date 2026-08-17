import type { SupabaseClient } from "@supabase/supabase-js";
import { getIntegration } from "@/lib/integrations/tokens";
import type {
  FacebookIntegrationMetadata,
  YouTubeIntegrationMetadata,
} from "@/lib/integrations/types";
import { getLiveEmbedUrl, getLivePageUrl } from "@/lib/site-url";
import { getDestinationPlatforms } from "@/lib/stream/platform-labels";
import type { StreamSession } from "@/lib/stream/sessions";

export type StreamShareLink = {
  id: string;
  label: string;
  url: string;
};

export type StreamShareLinks = {
  watchUrl: string;
  embedUrl: string;
  embedCode: string;
  links: StreamShareLink[];
};

export async function getStreamShareLinks(
  churchId: string,
  input: {
    slug?: string | null;
    session?: StreamSession | null;
    supabase?: SupabaseClient;
  },
): Promise<StreamShareLinks> {
  const slug = input.slug?.trim() ?? "";
  const watchUrl = slug ? getLivePageUrl(slug) : "";
  const embedUrl = slug ? getLiveEmbedUrl(slug) : "";
  const embedCode = embedUrl
    ? `<iframe src="${embedUrl}" width="640" height="360" frameborder="0" allowfullscreen></iframe>`
    : "";

  const links: StreamShareLink[] = [];

  if (watchUrl) {
    links.push({
      id: "faithform",
      label: "FaithForm watch page",
      url: watchUrl,
    });
  }

  const destinations = getDestinationPlatforms(input.session?.destinationsSnapshot);

  if (destinations.includes("youtube")) {
    const youtube = await getIntegration(churchId, "youtube", input.supabase);
    const meta = (youtube?.metadata ?? {}) as YouTubeIntegrationMetadata;
    if (meta.channel_id) {
      links.push({
        id: "youtube",
        label: "YouTube Live",
        url: `https://www.youtube.com/channel/${meta.channel_id}/live`,
      });
    }
  }

  if (destinations.includes("facebook")) {
    const facebook = await getIntegration(churchId, "facebook", input.supabase);
    const meta = (facebook?.metadata ?? {}) as FacebookIntegrationMetadata;
    // Only Facebook's own permalink resolves — see fetchLiveVideoPermalink.
    // Without it, link to the Page, where the live video is the top post,
    // rather than to a URL that shows an error.
    if (meta.live_video_url) {
      links.push({
        id: "facebook",
        label: "Facebook Live",
        url: meta.live_video_url,
      });
    } else if (meta.page_id) {
      links.push({
        id: "facebook",
        label: "Facebook Page",
        url: `https://www.facebook.com/${meta.page_id}`,
      });
    }
  }

  return { watchUrl, embedUrl, embedCode, links };
}
