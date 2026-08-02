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
    needsReconnect: false,
    reconnectReason: null as string | null,
  },
  facebook: {
    connected: false,
    pageName: null as string | null,
    pageId: null as string | null,
    needsReconnect: false,
    reconnectReason: null as string | null,
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
    needsReconnect: false,
    reconnectReason: null as string | null,
  },
};

/**
 * Reads integration rows for a church.
 *
 * The RPC is `security definer` but filters on `public.user_church_ids()`,
 * which resolves through `auth.uid()`. A service-role client has no user
 * session, so `auth.uid()` is null and the RPC matches nothing — background
 * work (cron jobs, go-live, scheduled streams) would otherwise see every
 * integration as disconnected. Fall back to a direct read in that case, the
 * same way `getIntegration` already does.
 */
async function loadIntegrationStatusRows(
  churchId: string,
  supabase?: SupabaseClient,
): Promise<IntegrationStatusRow[]> {
  if (supabase) {
    const { data, error } = await supabase.rpc("get_church_integration_status", {
      p_church_id: churchId,
    });

    if (!error && data?.length) {
      return data as IntegrationStatusRow[];
    }
  }

  const admin = createAdminClientOrNull();
  if (!admin) return [];

  const { data, error } = await admin
    .from("church_integrations")
    .select("provider, access_token, metadata")
    .eq("church_id", churchId);

  if (error || !data) return [];

  return data.map((row) => ({
    provider: row.provider as string,
    connected: Boolean((row.access_token as string | null)?.trim()),
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
  }));
}

export async function getIntegrationStatus(
  churchId: string,
  supabase?: SupabaseClient,
) {
  const rows = await loadIntegrationStatusRows(churchId, supabase);

  if (rows.length === 0) {
    return EMPTY_STATUS;
  }

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
      needsReconnect: Boolean(!google?.connected && googleMeta.needs_reconnect),
      reconnectReason: googleMeta.reconnect_reason ?? null,
    },
    facebook: {
      connected: Boolean(facebook?.connected),
      pageName: facebookMeta.page_name ?? null,
      pageId: facebookMeta.page_id ?? null,
      needsReconnect: Boolean(
        !facebook?.connected && facebookMeta.needs_reconnect,
      ),
      reconnectReason: facebookMeta.reconnect_reason ?? null,
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
      needsReconnect: Boolean(
        !youtube?.connected && youtubeMeta.needs_reconnect,
      ),
      reconnectReason: youtubeMeta.reconnect_reason ?? null,
    },
  };
}

export type IntegrationStatus = Awaited<ReturnType<typeof getIntegrationStatus>>;

export async function hasIntegration(
  churchId: string,
  provider: IntegrationProvider,
  supabase?: SupabaseClient,
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

export type SaveIntegrationInput = {
  churchId: string;
  provider: IntegrationProvider;
  accessToken: string;
  /**
   * `undefined` keeps whatever refresh token is already stored; `null` clears
   * it. Omitting it is the safe default for metadata-only writes — an upsert
   * that always wrote `null` here silently destroyed working credentials.
   */
  refreshToken?: string | null;
  /** Same contract as `refreshToken`: `undefined` keeps, `null` clears. */
  tokenExpiresAt?: Date | null;
  metadata?: Record<string, unknown>;
  connectedBy?: string;
};

export async function saveIntegration(
  input: SaveIntegrationInput,
  supabase?: SupabaseClient,
) {
  // Only pay for a read when the caller left a token field unspecified.
  const mustPreserve =
    input.refreshToken === undefined || input.tokenExpiresAt === undefined;
  const existing = mustPreserve
    ? await getIntegration(input.churchId, input.provider, supabase)
    : null;

  const refreshToken =
    input.refreshToken === undefined
      ? (existing?.refresh_token ?? null)
      : input.refreshToken;

  const tokenExpiresAt =
    input.tokenExpiresAt === undefined
      ? (existing?.token_expires_at ?? null)
      : (input.tokenExpiresAt?.toISOString() ?? null);

  const row = {
    church_id: input.churchId,
    provider: input.provider,
    access_token: input.accessToken,
    refresh_token: refreshToken,
    token_expires_at: tokenExpiresAt,
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

/**
 * Flags a connection as needing re-authorization without destroying it.
 *
 * Deleting the row on every refresh failure was the main reason integrations
 * appeared to "disconnect on their own": one transient `invalid_grant` threw
 * away the page id, channel id, calendar selection and reusable live stream id
 * along with the tokens. Clearing the access token is enough for the status RPC
 * to report it as disconnected, while the metadata survives for reconnect.
 */
export async function markIntegrationNeedsReconnect(
  churchId: string,
  provider: IntegrationProvider,
  reason: string,
  supabase?: SupabaseClient,
) {
  const existing = await getIntegration(churchId, provider, supabase);
  if (!existing) return;

  const metadata: Record<string, unknown> = {
    ...(existing.metadata ?? {}),
    needs_reconnect: true,
    reconnect_reason: reason,
    disconnected_at: new Date().toISOString(),
  };

  // A targeted update, not an upsert: `getIntegration` resolves through an RPC
  // that does not return `connected_by`, so writing a whole row here would blank
  // it. The refresh token is deliberately left in place — it is what lets the
  // connection heal itself if the failure turns out to have been transient.
  const patch = { access_token: "", metadata };

  if (supabase) {
    const { error } = await supabase
      .from("church_integrations")
      .update(patch)
      .eq("church_id", churchId)
      .eq("provider", provider);
    if (!error) return;
  }

  const admin = createAdminClientOrNull();
  if (!admin) return;

  await admin
    .from("church_integrations")
    .update(patch)
    .eq("church_id", churchId)
    .eq("provider", provider);
}

/** Strips the reconnect flags a successful (re)connect makes stale. */
export function clearReconnectFlags(
  metadata: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  const {
    needs_reconnect: _needsReconnect,
    reconnect_reason: _reason,
    disconnected_at: _disconnectedAt,
    ...rest
  } = (metadata ?? {}) as Record<string, unknown>;
  return rest;
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
