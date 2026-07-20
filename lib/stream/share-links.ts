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
  const youtube = await getIntegration(churchId, "youtube", input.supabase);
  const youtubeMeta = (youtube?.metadata ?? {}) as YouTubeIntegrationMetadata;
  const facebook = await getIntegration(churchId, "facebook", input.supabase);
  const facebookMeta = (facebook?.metadata ?? {}) as FacebookIntegrationMetadata;
  const hasActiveSession = Boolean(input.session);
  const includeYoutube = hasActiveSession
    ? destinations.includes("youtube")
    : Boolean(youtubeMeta.channel_id);
  const includeFacebook = hasActiveSession
    ? destinations.includes("facebook")
    : Boolean(facebookMeta.live_video_id && facebookMeta.page_id) || Boolean(facebookMeta.page_id);

  if (includeYoutube) {
    if (youtubeMeta.channel_id) {
      links.push({
        id: "youtube",
        label: "YouTube Live",
        url: `https://www.youtube.com/channel/${youtubeMeta.channel_id}/live`,
      });
    }
  }

  if (includeFacebook) {
    if (facebookMeta.live_video_id && facebookMeta.page_id) {
      links.push({
        id: "facebook",
        label: "Facebook Live",
        url: `https://www.facebook.com/${facebookMeta.page_id}/videos/${facebookMeta.live_video_id}/`,
      });
    } else if (facebookMeta.page_id) {
      links.push({
        id: "facebook",
        label: "Facebook Page",
        url: `https://www.facebook.com/${facebookMeta.page_id}`,
      });
    }
  }

  return { watchUrl, embedUrl, embedCode, links };
}
