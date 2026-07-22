alter table public.churches
  add column if not exists announcement_facebook_post_time time not null default '09:00:00';
