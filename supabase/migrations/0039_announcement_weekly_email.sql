alter table public.church_settings
  add column if not exists announcement_email_subject text,
  add column if not exists announcement_email_body text,
  add column if not exists announcement_email_to text,
  add column if not exists announcement_weekly_email_enabled boolean not null default true,
  add column if not exists last_weekly_announcement_draft_week_start date,
  add column if not exists last_weekly_announcement_draft_id text;
