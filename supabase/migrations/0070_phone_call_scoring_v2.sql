-- Phone call scoring learns to tell a scam from a failure
-- Migration 0070
--
-- ## What was wrong
--
-- 0036 scored every call 0–100 on one question: did this go well? For a church
-- phone line that question is backwards most of the time. The single most
-- common call a church answers is a Google Business Listing robocall, and the
-- best possible handling of one — recognise it, decline, hang up — scores near
-- zero under "did the caller get what they wanted". So the calls the assistant
-- handled *best* sank to the bottom of the log, and the column stopped being
-- worth reading.
--
-- ## What replaces it
--
-- The rubric now classifies first and scores second, on a 1–10 scale that maps
-- to bands a person can actually distinguish. Three of those judgements are
-- lifted out of the JSON blob into real columns, because they are the ones the
-- dashboard filters and sorts on:
--
--   * `call_classification` — spam / no_engagement / vendor / real
--   * `notify_pastor`       — does a human at the church need to see this
--   * `urgency`             — how fast
--
-- Keeping them in `score_breakdown` would mean a jsonb path scan on every call
-- log page load, and no index worth having.
--
-- ## The old scores
--
-- Rows scored under 0036 are on a 0–100 scale and rows scored from here on are
-- on 1–10, and there is no honest way to have both in one column. The old
-- values are rescaled rather than dropped: dividing by ten preserves the only
-- thing a v1 score ever conveyed — its rank against the other v1 calls — while
-- putting it in the range the UI now renders. They keep `version: 1` in their
-- breakdown, so nothing later mistakes a converted score for a judged one, and
-- their classification stays null because v1 never made one.

alter table public.phone_calls
  add column if not exists call_classification text,
  add column if not exists notify_pastor boolean,
  add column if not exists urgency text;

alter table public.phone_calls
  drop constraint if exists phone_calls_call_classification_check;
alter table public.phone_calls
  add constraint phone_calls_call_classification_check
  check (
    call_classification is null
    or call_classification in ('spam', 'no_engagement', 'vendor', 'real')
  );

alter table public.phone_calls
  drop constraint if exists phone_calls_urgency_check;
alter table public.phone_calls
  add constraint phone_calls_urgency_check
  check (urgency is null or urgency in ('high', 'normal', 'low'));

-- Stamp the surviving 0036 rows before anything is rescaled, so a re-run can
-- tell a converted score from one the new rubric produced.
update public.phone_calls
set score_breakdown = coalesce(score_breakdown, '{}'::jsonb) || jsonb_build_object('version', 1)
where scored_at is not null
  and (score_breakdown is null or score_breakdown -> 'version' is null);

-- 0–100 becomes 1–10. Clamped at 1 because the new scale has no zero, and only
-- applied to scores that could not already be on it.
update public.phone_calls
set ai_score = greatest(1, round(ai_score / 10.0))
where scored_at is not null
  and ai_score is not null
  and ai_score > 10
  and (score_breakdown -> 'version')::text = '1';

-- The call log's default view is "what still needs a person", newest first.
create index if not exists phone_calls_attention_idx
  on public.phone_calls (church_id, notify_pastor, called_at desc)
  where notify_pastor is true;

-- Filtering the log by kind — "show me only the real calls" — is the other
-- read this table gets, and it is always scoped to one church.
create index if not exists phone_calls_classification_idx
  on public.phone_calls (church_id, call_classification, called_at desc);

notify pgrst, 'reload schema';
