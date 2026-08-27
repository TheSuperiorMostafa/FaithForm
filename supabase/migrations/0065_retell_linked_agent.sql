-- Linked Retell agents: churches whose AI phone agent was hand-built
-- directly in Retell, before FaithForm existed.
-- Migration 0065
--
-- `agent_mode` tells the sync path whether it owns the agent. 'managed' is
-- the existing behavior — FaithForm creates and pushes prompt/config updates.
-- 'linked' means the agent already exists in the church's own Retell
-- account: FaithForm reads call logs, transcripts and scoring, but every
-- outbound write (create/update agent, provision a number) refuses.
--
-- A linked church's agent often lives in its own Retell account, so it needs
-- its own API key rather than FaithForm's shared one. That key rides the
-- same church_integrations table Apple Calendar's app-specific password
-- uses (migration 0052) — service-role only, per the security baseline
-- (migration 0050).

alter table public.voice_assistant_settings
  add column if not exists agent_mode text not null default 'managed'
  check (agent_mode in ('managed', 'linked'));

alter table public.church_integrations
  drop constraint if exists church_integrations_provider_check;

alter table public.church_integrations
  add constraint church_integrations_provider_check
  check (provider in ('google', 'facebook', 'stream', 'youtube', 'apple', 'retell'));

notify pgrst, 'reload schema';
