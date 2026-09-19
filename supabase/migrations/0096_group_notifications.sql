-- Group notifications through the existing outbox
-- Migration 0096 (Prompt 14)
--
-- A leader hears about a join request, a person hears that their request was
-- approved, and people who said they were coming hear that a gathering was
-- cancelled. None of that needs a second notification system: it rides the
-- transactional outbox from 0054, its worker, its provider adapters and its
-- delivery log.
--
-- Two additions make that possible:
--
--   * `target_account_ids` — these notifications are for named people, not
--     for everyone at a visibility level. The recipients are still re-checked
--     at send time (a relationship that ended in between gets nothing), which
--     is the rule 0054 established and this keeps.
--   * new kinds, subject types and a `groups` topic.
--
-- Ordered after 0095 on purpose: 0095 re-declares the kind and subject-type
-- checks for livestream notifications, and a check re-declared here must keep
-- every value either migration introduced. Constraints are replaced by what
-- they check, never by a guessed name.

alter table public.notification_outbox
  add column if not exists target_account_ids uuid[];

alter table public.notification_outbox
  drop constraint if exists notification_outbox_kind_check;

alter table public.notification_outbox
  add constraint notification_outbox_kind_check
  check (kind in (
    'announcement_published', 'event_published', 'service_live', 'recording_published',
    'group_join_requested', 'group_request_approved', 'group_event_cancelled'
  ));

alter table public.notification_outbox
  drop constraint if exists notification_outbox_subject_type_check;

alter table public.notification_outbox
  add constraint notification_outbox_subject_type_check
  check (subject_type in (
    'announcement', 'stream_event', 'stream_recording', 'group_join_request', 'group_event'
  ));

-- 0054 declared the topic check inline, so its name is whatever Postgres
-- generated; it is found by what it checks.
do $$
declare
  v_constraint text;
begin
  for v_constraint in
    select c.conname
      from pg_constraint c
     where c.conrelid = 'public.notification_outbox'::regclass
       and c.contype = 'c'
       and pg_get_constraintdef(c.oid) ~ '\mtopic\M'
  loop
    execute format('alter table public.notification_outbox drop constraint %I', v_constraint);
  end loop;
end $$;

alter table public.notification_outbox
  add constraint notification_outbox_topic_check
  check (topic in ('announcements', 'events', 'groups'));

-- A targeted notification names its people; a broadcast one does not. Never
-- both, so the worker cannot mistake one for the other.
alter table public.notification_outbox
  drop constraint if exists notification_outbox_target_shape_check;

alter table public.notification_outbox
  add constraint notification_outbox_target_shape_check
  check (
    (topic = 'groups') = (target_account_ids is not null)
    and (target_account_ids is null or cardinality(target_account_ids) between 1 and 200)
  );

notify pgrst, 'reload schema';
