import type { SupabaseClient } from "@supabase/supabase-js";
import {
  checkFacebookScheduleTime,
  normalizeFacebookPostTime,
} from "@/lib/announcements/facebook-schedule";
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
  /** The flyer as stored: an AI-made PNG, or the church's own JPEG or PNG. */
  image?: ArrayBuffer;
  /**
   * Unix seconds to schedule the post for. Omit it to post immediately. That
   * is the caller's explicit choice, never a fallback: a time Facebook would
   * refuse throws instead of going out now.
   */
  scheduledPublishTime?: number;
};

/**
 * What a flyer's bytes really are, for the multipart part Facebook reads.
 *
 * Every upload used to be labelled image/png. That was true of the AI flyers,
 * but not of a church's own design, which is usually a JPEG. The bytes are
 * checked rather than the stored path, so an older object labelled wrongly is
 * still sent correctly.
 */
export function facebookImagePart(bytes: ArrayBuffer): {
  contentType: "image/jpeg" | "image/png" | "image/webp";
  filename: string;
} {
  const head = new Uint8Array(bytes, 0, Math.min(12, bytes.byteLength));
  const ascii = (from: number, to: number) =>
    String.fromCharCode(...Array.from(head.subarray(from, to)));

  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) {
    return { contentType: "image/jpeg", filename: "announcement.jpg" };
  }
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") {
    return { contentType: "image/webp", filename: "announcement.webp" };
  }
  return { contentType: "image/png", filename: "announcement.png" };
}

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
  const scheduled = options.scheduledPublishTime !== undefined;

  // Checked here, right before the request, as well as when the form was
  // submitted: making a graphic can take long enough to use up a tight lead.
  // Facebook's own refusal is cryptic, so this refuses first, in plain words.
  if (scheduled) {
    const check = checkFacebookScheduleTime(options.scheduledPublishTime! * 1000);
    if (!check.ok) throw new Error(check.error);
  }

  const { token, pageId } = await getFacebookPageAccessToken(
    churchId,
    supabase,
  );

  const send = async (accessToken: string): Promise<Response> => {
    if (options.image) {
      const part = facebookImagePart(options.image);
      const form = new FormData();
      form.append("message", options.message);
      form.append("access_token", accessToken);
      form.append(
        "source",
        new Blob([options.image], { type: part.contentType }),
        part.filename,
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

/**
 * The Church Profile's announcement post time, as "HH:mm".
 *
 * When a post goes out is decided in lib/announcements/facebook-schedule.ts.
 * It used to be decided here, where a day-before slot that had passed turned
 * silently into an immediate post.
 */
export function formatAnnouncementFacebookPostTime(
  postTime: string | null | undefined,
): string {
  return normalizeFacebookPostTime(postTime);
}
