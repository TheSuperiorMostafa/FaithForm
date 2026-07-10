import type { SupabaseClient } from "@supabase/supabase-js";

import { createAdminClientOrNull } from "@/lib/supabase/admin";
import type {
  ChurchIntegrationRow,
  FacebookIntegrationMetadata,
  GoogleIntegrationMetadata,
  IntegrationProvider,
  StreamIntegrationMetadata,
  YouTubeIntegrationMetadata,
} from "@/lib/integrations/types";

type IntegrationStatusRow = {
  provider: string;
  connected: boolean;
  metadata: Record<string, unknown> | null;
};

const EMPTY_STATUS = {
  google: {
    connected: false,
    email: null as string | null,
    calendarId: "primary",
  },
  facebook: {
    connected: false,
    pageName: null as string | null,
    pageId: null as string | null,
  },
  stream: {
    connected: false,
    relayHost: null as string | null,
    youtubeUrl: null as string | null,
    facebookUrl: null as string | null,
  },
  youtube: {
    connected: false,
    channelId: null as string | null,
    channelTitle: null as string | null,
  },
};

export async function getIntegrationStatus(
  churchId: string,
  supabase: SupabaseClient,
) {
  const { data, error } = await supabase.rpc("get_church_integration_status", {
    p_church_id: churchId,
  });

  if (error || !data) {
    return EMPTY_STATUS;
  }

  const rows = data as IntegrationStatusRow[];
  const google = rows.find((r) => r.provider === "google");
  const facebook = rows.find((r) => r.provider === "facebook");
  const stream = rows.find((r) => r.provider === "stream");
  const youtube = rows.find((r) => r.provider === "youtube");

  const googleMeta = (google?.metadata ?? {}) as GoogleIntegrationMetadata;
  const facebookMeta = (facebook?.metadata ?? {}) as FacebookIntegrationMetadata;
  const streamMeta = (stream?.metadata ?? {}) as StreamIntegrationMetadata;
  const youtubeMeta = (youtube?.metadata ?? {}) as YouTubeIntegrationMetadata;

  return {
    google: {
      connected: Boolean(google?.connected),
      email: googleMeta.email ?? null,
      calendarId: googleMeta.calendar_id ?? "primary",
    },
    facebook: {
      connected: Boolean(facebook?.connected),
      pageName: facebookMeta.page_name ?? null,
      pageId: facebookMeta.page_id ?? null,
    },
    stream: {
      connected: Boolean(stream?.connected),
      relayHost: streamMeta.relay_host ?? null,
      youtubeUrl: streamMeta.youtube_url ?? null,
      facebookUrl: streamMeta.facebook_url ?? null,
    },
    youtube: {
      connected: Boolean(youtube?.connected),
      channelId: youtubeMeta.channel_id ?? null,
      channelTitle: youtubeMeta.channel_title ?? null,
    },
  };
}

export async function hasIntegration(
  churchId: string,
  provider: IntegrationProvider,
  supabase: SupabaseClient,
): Promise<boolean> {
  const status = await getIntegrationStatus(churchId, supabase);
  if (provider === "google") return status.google.connected;
  if (provider === "facebook") return status.facebook.connected;
  if (provider === "youtube") return status.youtube.connected;
  return status.stream.connected;
}

export async function getIntegration(
  churchId: string,
  provider: IntegrationProvider,
  supabase?: SupabaseClient,
): Promise<ChurchIntegrationRow | null> {
  if (supabase) {
    const { data, error } = await supabase.rpc("get_church_integration_tokens", {
      p_church_id: churchId,
      p_provider: provider,
    });

    if (!error && data?.length) {
      const row = data[0] as {
        access_token: string;
        refresh_token: string | null;
        token_expires_at: string | null;
        metadata: Record<string, unknown>;
      };

      return {
        id: "",
        church_id: churchId,
        provider,
        access_token: row.access_token,
        refresh_token: row.refresh_token,
        token_expires_at: row.token_expires_at,
        metadata: row.metadata ?? {},
        connected_by: null,
      };
    }
    // Service-role clients have no user session, so the RPC admin check fails.
  }

  const admin = createAdminClientOrNull();
  if (!admin) return null;

  const { data, error } = await admin
    .from("church_integrations")
    .select("*")
    .eq("church_id", churchId)
    .eq("provider", provider)
    .maybeSingle();

  if (error || !data) return null;

  return {
    id: data.id,
    church_id: data.church_id,
    provider: data.provider as IntegrationProvider,
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    token_expires_at: data.token_expires_at,
    metadata: (data.metadata ?? {}) as Record<string, unknown>,
    connected_by: data.connected_by,
  };
}

export async function saveIntegration(
  input: {
    churchId: string;
    provider: IntegrationProvider;
    accessToken: string;
    refreshToken?: string | null;
    tokenExpiresAt?: Date | null;
    metadata?: Record<string, unknown>;
    connectedBy?: string;
  },
  supabase?: SupabaseClient,
) {
  const row = {
    church_id: input.churchId,
    provider: input.provider,
    access_token: input.accessToken,
    refresh_token: input.refreshToken ?? null,
    token_expires_at: input.tokenExpiresAt?.toISOString() ?? null,
    metadata: input.metadata ?? {},
    connected_by: input.connectedBy ?? null,
  };

  if (supabase) {
    const { error } = await supabase
      .from("church_integrations")
      .upsert(row, { onConflict: "church_id,provider" });

    if (!error) return;
  }

  const admin = createAdminClientOrNull();
  if (!admin) {
    throw new Error(
      "Could not save integration. Set SUPABASE_SECRET_KEY on the server, or connect while signed in as a church admin.",
    );
  }

  const { error } = await admin
    .from("church_integrations")
    .upsert(row, { onConflict: "church_id,provider" });

  if (error) throw new Error(error.message);
}

export async function deleteIntegration(
  churchId: string,
  provider: IntegrationProvider,
  supabase?: SupabaseClient,
) {
  if (supabase) {
    const { error } = await supabase
      .from("church_integrations")
      .delete()
      .eq("church_id", churchId)
      .eq("provider", provider);

    if (!error) return;
  }

  const admin = createAdminClientOrNull();
  if (!admin) return;

  await admin
    .from("church_integrations")
    .delete()
    .eq("church_id", churchId)
    .eq("provider", provider);
}

export async function getChurchCalendarId(
  churchId: string,
  supabase?: SupabaseClient,
): Promise<string> {
  let calendarFromChurch: string | undefined;

  if (supabase) {
    const { data } = await supabase
      .from("churches")
      .select("google_calendar_id")
      .eq("id", churchId)
      .maybeSingle();
    calendarFromChurch = data?.google_calendar_id as string | undefined;
  }

  const integration = await getIntegration(churchId, "google");
  const meta = (integration?.metadata ?? {}) as GoogleIntegrationMetadata;

  return meta.calendar_id ?? calendarFromChurch ?? "primary";
}
