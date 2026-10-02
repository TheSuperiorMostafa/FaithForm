-- FaithForm: landing page vs multi-page website mode for church sites
-- Migration 0112
--
-- Churches keep the existing one-scroll landing by default. Opting into
-- "website" mode lets each major section live at its own path (/about, /visit,
-- …) while the home page stays a short hero + service times + chrome.

alter table public.site_settings
  add column if not exists layout_mode text not null default 'landing'
    check (layout_mode in ('landing', 'website'));

comment on column public.site_settings.layout_mode is
  'landing = single-scroll hash nav; website = separate pages per section';
