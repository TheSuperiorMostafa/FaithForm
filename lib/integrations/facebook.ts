import type { SupabaseClient } from "@supabase/supabase-js";
import { provisionFacebookLiveRtmpUrl } from "@/lib/integrations/facebook-live";
import {
  exchangeForLongLivedUserToken,
  FacebookReconnectRequiredError,
  fetchFacebookPages,
  getFacebookConfig,
  getFacebookPageAccessToken,
  GRAPH,
  isFacebookAuthError,
  refreshFacebookPageToken,
} from "@/lib/integrations/facebook-token";
import { markIntegrationNeedsReconnect, saveIntegration } from "@/lib/integrations/tokens";
import type { FacebookIntegrationMetadata } from "@/lib/integrations/types";
import { setStreamRelayDestination } from "@/lib/stream/relay";
import { shiftYmd, toYMD, zonedDateTimeToUtcMs } from "@/lib/utils/dates";

export {
  FacebookReconnectRequiredError,
  getFacebookPageAccessToken,
} from "@/lib/integrations/facebook-token";

export function getFacebookAuthUrl(state: string): string {
  const { appId, redirectUri } = getFacebookConfig();
  const params = new URLSearchParams({
    client_id: appId,
    redirect_uri: redirectUri,
    state,
    scope: "pages_show_list,pages_manage_posts,pages_read_engagement",
    response_type: "code",
  });
  return `https://www.facebook.com/v21.0/dialog/oauth?${params}`;
}

export async function exchangeFacebookCode(
  code: string,
  churchId: string,
  userId: string,
  supabase?: SupabaseClient,
  options?: { provisionLive?: boolean },
) {
  const { appId, appSecret, redirectUri } = getFacebookConfig();

  const tokenRes = await fetch(
    `${GRAPH}/oauth/access_token?${new URLSearchParams({
      client_id: appId,
      client_secret: appSecret,
      redirect_uri: redirectUri,
      code,
    })}`,
  );

  if (!tokenRes.ok) {
    throw new Error("Facebook token exchange failed");
  }

  const tokenData = (await tokenRes.json()) as {
    access_token?: string;
    error?: { message: string };
  };

  if (!tokenData.access_token) {
    throw new Error(tokenData.error?.message ?? "No Facebook access token");
  }

  const longLived = await exchangeForLongLivedUserToken(tokenData.access_token);
  const pages = await fetchFacebookPages(longLived.token);

  const page = pages[0];
  if (!page) {
    throw new Error(
      "No Facebook Pages found. Connect a Page to your account first.",
    );
  }

  let liveVideoId: string | undefined;
  if (options?.provisionLive) {
    const { rtmpUrl, liveVideoId: createdLiveVideoId } =
      await provisionFacebookLiveRtmpUrl(
        page.id,
        page.access_token,
        `${page.name} — FaithForm`,
      );
    liveVideoId = createdLiveVideoId;
    await setStreamRelayDestination(
      churchId,
      "facebook",
      rtmpUrl,
      userId,
      supabase,
    );
  }

  const metadata: FacebookIntegrationMetadata = {
    page_id: page.id,
    page_name: page.name,
    live_video_id: liveVideoId,
    long_lived: longLived.token !== tokenData.access_token,
    connected_at: new Date().toISOString(),
  };

  await saveIntegration(
    {
      churchId,
      provider: "facebook",
      accessToken: page.access_token,
      // The long-lived user token is the credential that mints Page tokens, so
      // it belongs in the refresh_token column. Metadata is readable by every
      // church member through the status RPC; this must not go there.
      refreshToken: longLived.token,
      tokenExpiresAt: longLived.expiresAt,
      metadata,
      connectedBy: userId,
    },
    supabase,
  );
}

export type FacebookAnnouncementPostOptions = {
  message: string;
  imagePng?: ArrayBuffer;
  /** Unix timestamp (seconds) for scheduled publish; omit for immediate post */
  scheduledPublishTime?: number;
};

export type FacebookPostResult = {
  postId: string;
  url: string;
  scheduled: boolean;
  scheduledPublishTime: string | null;
};

function facebookPostUrl(postId: string): string {
  return `https://www.facebook.com/${postId.replace("_", "/posts/")}`;
}

export async function postAnnouncementToFacebookPage(
  churchId: string,
  options: FacebookAnnouncementPostOptions,
  supabase?: SupabaseClient,
): Promise<FacebookPostResult> {
  const { token, pageId } = await getFacebookPageAccessToken(
    churchId,
    supabase,
  );
  const scheduled = Boolean(options.scheduledPublishTime);

  const send = async (accessToken: string): Promise<Response> => {
    if (options.imagePng) {
      const form = new FormData();
      form.append("message", options.message);
      form.append("access_token", accessToken);
      form.append(
        "source",
        new Blob([options.imagePng], { type: "image/png" }),
        "announcement.png",
      );
      if (scheduled && options.scheduledPublishTime) {
        form.append("published", "false");
        form.append(
          "scheduled_publish_time",
          String(options.scheduledPublishTime),
        );
      }
      return fetch(`${GRAPH}/${pageId}/photos`, { method: "POST", body: form });
    }

    const body: Record<string, string | number | boolean> = {
      message: options.message,
      access_token: accessToken,
    };
    if (scheduled && options.scheduledPublishTime) {
      body.published = false;
      body.scheduled_publish_time = options.scheduledPublishTime;
    }
    return fetch(`${GRAPH}/${pageId}/feed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  };

  type PostResponse = {
    id?: string;
    post_id?: string;
    error?: { message?: string; code?: number; type?: string };
  };

  let res = await send(token);
  let data = (await res.json().catch(() => ({}))) as PostResponse;

  // A rejected Page token is recoverable: mint a fresh one from the long-lived
  // user token and retry once before asking anyone to reconnect.
  if (!res.ok && data.error && isFacebookAuthError(data.error)) {
    const refreshed = await refreshFacebookPageToken(churchId, supabase);
    if (refreshed) {
      res = await send(refreshed);
      data = (await res.json().catch(() => ({}))) as PostResponse;
    } else {
      await markIntegrationNeedsReconnect(
        churchId,
        "facebook",
        "Facebook access expired. Reconnect Facebook in Settings.",
        supabase,
      );
      throw new FacebookReconnectRequiredError();
    }
  }

  const postId = data.id ?? data.post_id;
  if (!res.ok || !postId) {
    throw new Error(data.error?.message ?? "Facebook post failed");
  }

  return {
    postId,
    url: facebookPostUrl(postId),
    scheduled,
    scheduledPublishTime:
      scheduled && options.scheduledPublishTime
        ? new Date(options.scheduledPublishTime * 1000).toISOString()
        : null,
  };
}

export type FacebookDeleteResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Removes a post from the connected Page.
 *
 * Used when an announcement is unsubmitted while its Facebook post is still
 * scheduled. Callers decide the policy — an already-live post is deliberately
 * left alone so unsubmitting never silently deletes public content.
 */
export async function deleteFacebookPost(
  churchId: string,
  postId: string,
  supabase?: SupabaseClient,
): Promise<FacebookDeleteResult> {
  let token: string;
  try {
    ({ token } = await getFacebookPageAccessToken(churchId, supabase));
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Facebook is not connected",
    };
  }

  const res = await fetch(
    `${GRAPH}/${encodeURIComponent(postId)}?access_token=${encodeURIComponent(
      token,
    )}`,
    { method: "DELETE" },
  );

  const data = (await res.json().catch(() => ({}))) as {
    success?: boolean;
    error?: { message?: string; code?: number };
  };

  if (!res.ok) {
    // 100 / "does not exist" means it is already gone — treat that as success.
    const message = data.error?.message ?? "Could not delete the Facebook post";
    if (/does not exist|Unsupported get request|cannot be loaded/i.test(message)) {
      return { ok: true };
    }
    return { ok: false, error: message };
  }

  return { ok: true };
}

export async function postToFacebookPage(
  churchId: string,
  message: string,
  supabase?: SupabaseClient,
): Promise<{ postId: string; url: string }> {
  const result = await postAnnouncementToFacebookPage(
    churchId,
    { message },
    supabase,
  );
  return { postId: result.postId, url: result.url };
}

/** Facebook requires scheduled posts to be at least ~10 minutes in the future. */
const FACEBOOK_MIN_SCHEDULE_LEAD_MS = 10 * 60 * 1000;

const DEFAULT_ANNOUNCEMENT_FACEBOOK_POST_TIME = "09:00";

export type FacebookScheduleOptions = {
  /** HH:mm in the church timezone. */
  postTime?: string;
  /** IANA timezone for the church. */
  timezone?: string;
};

/**
 * Schedule announcement Facebook posts for the day before the event at the
 * church's configured time. Posts immediately when that slot has already passed.
 */
export function resolveFacebookScheduledPublishTime(
  startAtIso: string,
  options?: FacebookScheduleOptions,
): number | undefined {
  const startMs = new Date(startAtIso).getTime();
  if (Number.isNaN(startMs)) return undefined;

  const timezone = options?.timezone?.trim() || "America/New_York";
  const postTime = normalizePostTime(
    options?.postTime ?? DEFAULT_ANNOUNCEMENT_FACEBOOK_POST_TIME,
  );

  const eventDate = toYMD(new Date(startAtIso), timezone);
  const publishDate = shiftYmd(eventDate, -1);
  const scheduledMs = zonedDateTimeToUtcMs(publishDate, postTime, timezone);
  const now = Date.now();

  if (scheduledMs - now < FACEBOOK_MIN_SCHEDULE_LEAD_MS) {
    return undefined;
  }

  return Math.floor(scheduledMs / 1000);
}

function normalizePostTime(value: string): string {
  const trimmed = value.trim();
  const match = trimmed.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return DEFAULT_ANNOUNCEMENT_FACEBOOK_POST_TIME;
  const hours = Math.min(23, Math.max(0, Number(match[1])));
  const minutes = Math.min(59, Math.max(0, Number(match[2])));
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

export function formatAnnouncementFacebookPostTime(
  postTime: string | null | undefined,
): string {
  return normalizePostTime(postTime ?? DEFAULT_ANNOUNCEMENT_FACEBOOK_POST_TIME);
}
