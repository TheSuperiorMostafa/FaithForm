export type IntegrationProvider = "google" | "facebook" | "stream" | "youtube";

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

export type GoogleIntegrationMetadata = {
  calendar_id?: string;
  email?: string;
};

export type FacebookIntegrationMetadata = {
  page_id?: string;
  page_name?: string;
  live_video_id?: string;
};

export type StreamIntegrationMetadata = {
  relay_host?: string;
  youtube_url?: string;
  facebook_url?: string;
  preview_ingest_active?: boolean;
  preview_ingest_at?: string | null;
};

export type YouTubeIntegrationMetadata = {
  channel_id?: string;
  channel_title?: string;
  can_manage_live?: boolean;
  live_streaming_enabled?: boolean;
  live_streaming_error?: string | null;
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
  gmailDraftUrl?: string;
  errors: string[];
};
