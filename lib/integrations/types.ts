export type IntegrationProvider = "google" | "facebook" | "stream" | "youtube";

/**
 * Health fields every provider's metadata carries.
 *
 * A broken connection keeps its row so channel ids, page ids and calendar
 * selections survive — only the access token is cleared, which is what the
 * status RPC reads. These fields let the UI say *why* a reconnect is needed
 * instead of silently showing "Not connected".
 */
export type IntegrationHealthMetadata = {
  needs_reconnect?: boolean;
  reconnect_reason?: string;
  disconnected_at?: string;
  connected_at?: string;
};

export type ChurchIntegrationRow = {
  id: string;
  church_id: string;
  provider: IntegrationProvider;
  access_token: string;
  refresh_token: string | null;
  token_expires_at: string | null;
  metadata: Record<string, unknown>;
  connected_by: string | null;
};

export type GoogleIntegrationMetadata = IntegrationHealthMetadata & {
  calendar_id?: string;
  email?: string;
};

export type FacebookIntegrationMetadata = IntegrationHealthMetadata & {
  page_id?: string;
  page_name?: string;
  live_video_id?: string;
  /**
   * True when the page token was derived from a long-lived user token (and so
   * does not expire). The user token itself lives in the `refresh_token`
   * column — never in metadata, which the status RPC exposes to all members.
   */
  long_lived?: boolean;
};

export type StreamIntegrationMetadata = IntegrationHealthMetadata & {
  relay_host?: string;
  youtube_url?: string;
  facebook_url?: string;
  preview_ingest_active?: boolean;
  preview_ingest_at?: string | null;
};

export type YouTubeIntegrationMetadata = IntegrationHealthMetadata & {
  channel_id?: string;
  channel_title?: string;
  can_manage_live?: boolean;
  live_stream_id?: string;
  live_broadcast_id?: string;
};

export type CalendarEventPreview = {
  googleEventId: string;
  calendarId: string;
  title: string;
  location: string;
  startAt: string;
  endAt: string | null;
  htmlLink?: string;
};

export type PublishResult = {
  ok: boolean;
  announcementId?: string;
  facebookUrl?: string;
  facebookScheduledAt?: string;
  queuedForWeeklyEmail?: boolean;
  errors: string[];
};
