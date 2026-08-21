export type IntegrationProvider =
  | "google"
  | "facebook"
  | "stream"
  | "youtube"
  | "apple";

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
   * Facebook's own permalink for the current live video. Stored because the
   * URL cannot be derived from the ids we hold.
   */
  live_video_url?: string;
  /**
   * True when the page token was derived from a long-lived user token (and so
   * does not expire). The user token itself lives in the `refresh_token`
   * column — never in metadata, which the status RPC exposes to all members.
   */
  long_lived?: boolean;
};

/**
 * iCloud Calendar, reached over CalDAV.
 *
 * Apple publishes no OAuth scope for calendar data — "Sign in with Apple" only
 * proves who somebody is — so a church connects with its Apple ID and an
 * app-specific password, which is how every calendar client does it. The
 * password lives in `access_token`, never in metadata: the status projection
 * hands metadata to browsers.
 */
export type AppleIntegrationMetadata = IntegrationHealthMetadata & {
  apple_id?: string;
  /** Absolute CalDAV URL of the calendar the church chose. */
  calendar_url?: string;
  calendar_name?: string;
  /** Where discovery landed, so a reconnect can skip a round trip. */
  calendar_home_url?: string;
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

/**
 * One event as the announcements screens want it, whichever calendar it came
 * from. `googleEventId` keeps its name because it is what the announcements
 * table stores and every screen already keys on; an iCloud event carries an
 * `apple:`-prefixed id in the same field, which is also what tells the two
 * apart when it is time to write a change back.
 */
export type CalendarEventPreview = {
  googleEventId: string;
  calendarId: string;
  title: string;
  location: string;
  startAt: string;
  endAt: string | null;
  htmlLink?: string;
  source?: CalendarSource;
};

export type CalendarSource = "google" | "apple";

export type PublishResult = {
  ok: boolean;
  announcementId?: string;
  facebookUrl?: string;
  facebookScheduledAt?: string;
  queuedForWeeklyEmail?: boolean;
  errors: string[];
};
