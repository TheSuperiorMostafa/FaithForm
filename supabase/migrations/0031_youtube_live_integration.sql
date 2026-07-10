-- Add YouTube integration provider for live API automation.

alter table public.church_integrations
  drop constraint if exists church_integrations_provider_check;

alter table public.church_integrations
  add constraint church_integrations_provider_check
  check (provider in ('google', 'facebook', 'stream', 'youtube'));
