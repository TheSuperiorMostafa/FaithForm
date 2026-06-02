import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getIntegration,
  saveIntegration,
} from "@/lib/integrations/tokens";
import type { FacebookIntegrationMetadata } from "@/lib/integrations/types";

const GRAPH = "https://graph.facebook.com/v21.0";

function getFacebookConfig() {
  const appId = process.env.FACEBOOK_APP_ID;
  const appSecret = process.env.FACEBOOK_APP_SECRET;
  const redirectUri =
    process.env.FACEBOOK_REDIRECT_URI ??
    `${process.env.NEXT_PUBLIC_SITE_URL}/api/integrations/facebook/callback`;

  if (!appId || !appSecret) {
    throw new Error("Facebook OAuth is not configured");
  }

  return { appId, appSecret, redirectUri };
}

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

  const pagesRes = await fetch(
    `${GRAPH}/me/accounts?access_token=${tokenData.access_token}`,
  );
  const pagesData = (await pagesRes.json()) as {
    data?: Array<{
      id: string;
      name: string;
      access_token: string;
    }>;
    error?: { message: string };
  };

  const page = pagesData.data?.[0];
  if (!page) {
    throw new Error(
      pagesData.error?.message ??
        "No Facebook Pages found. Connect a Page to your account first.",
    );
  }

  const metadata: FacebookIntegrationMetadata = {
    page_id: page.id,
    page_name: page.name,
  };

  await saveIntegration(
    {
      churchId,
      provider: "facebook",
      accessToken: page.access_token,
      refreshToken: null,
      tokenExpiresAt: null,
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
  const integration = await getIntegration(churchId, "facebook", supabase);
  if (!integration) {
    throw new Error("Facebook is not connected");
  }

  const meta = integration.metadata as FacebookIntegrationMetadata;
  const pageId = meta.page_id;
  if (!pageId) {
    throw new Error("Facebook Page ID is missing");
  }

  const scheduled = Boolean(options.scheduledPublishTime);
  let res: Response;

  if (options.imagePng) {
    const form = new FormData();
    form.append("message", options.message);
    form.append("access_token", integration.access_token);
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
    res = await fetch(`${GRAPH}/${pageId}/photos`, {
      method: "POST",
      body: form,
    });
  } else {
    const body: Record<string, string | number | boolean> = {
      message: options.message,
      access_token: integration.access_token,
    };
    if (scheduled && options.scheduledPublishTime) {
      body.published = false;
      body.scheduled_publish_time = options.scheduledPublishTime;
    }
    res = await fetch(`${GRAPH}/${pageId}/feed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  const data = (await res.json()) as {
    id?: string;
    post_id?: string;
    error?: { message: string };
  };

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

/** Facebook requires scheduled posts to be at least ~10 minutes in the future */
export function resolveFacebookScheduledPublishTime(
  startAtIso: string,
): number | undefined {
  const startMs = new Date(startAtIso).getTime();
  if (Number.isNaN(startMs)) return undefined;

  const minLeadMs = 10 * 60 * 1000;
  if (startMs - Date.now() < minLeadMs) {
    return undefined;
  }

  return Math.floor(startMs / 1000);
}
