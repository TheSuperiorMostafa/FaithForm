-- iCloud Calendar as a connectable provider
-- Migration 0052
--
-- Apple publishes no OAuth scope for calendar data — "Sign in with Apple"
-- proves identity and nothing else — so a church connects iCloud the way every
-- calendar client does: an Apple ID and an app-specific password, over CalDAV.
-- Those credentials sit in the same columns the OAuth providers use, on a table
-- the security baseline already restricts to the service role.

alter table public.church_integrations
  drop constraint if exists church_integrations_provider_check;

alter table public.church_integrations
  add constraint church_integrations_provider_check
  check (provider in ('google', 'facebook', 'stream', 'youtube', 'apple'));
