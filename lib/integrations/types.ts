export type IntegrationProvider = "google" | "facebook";

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
