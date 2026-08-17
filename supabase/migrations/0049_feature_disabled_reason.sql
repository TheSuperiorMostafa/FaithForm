-- Why a feature is switched off
-- Migration 0049
--
-- Turning a feature off told every member the same thing: it "isn't part of
-- your church's FaithForm plan yet". That is one specific reason presented as
-- if it were the only one. A feature switched off for a fortnight while we fix
-- something, or one not built yet, reads to a church as a billing problem.
--
-- So the switch carries its reason, chosen when it is switched off.

alter table public.church_features
  add column if not exists disabled_reason text
    check (
      disabled_reason is null
      or disabled_reason in (
        'coming_soon',
        'temporarily_unavailable',
        'not_in_plan',
        'custom'
      )
    ),
  -- Shown verbatim when the reason is 'custom'. Ignored otherwise.
  add column if not exists disabled_note text;
