-- Private check-in alerts share the retryable outbox but never its broadcast audience.
create table if not exists public.checkin_guardian_alerts (
  id uuid primary key,
  church_id uuid not null references public.churches(id) on delete cascade,
  session_id uuid not null references public.checkin_sessions(id) on delete cascade,
  household_id uuid not null references public.households(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists checkin_guardian_alerts_household_idx on public.checkin_guardian_alerts(church_id, household_id, created_at desc);
create index if not exists checkin_guardian_alerts_session_idx on public.checkin_guardian_alerts(session_id, created_at desc);
alter table public.checkin_guardian_alerts enable row level security;
revoke all on public.checkin_guardian_alerts from public, anon, authenticated;
grant select, insert, update, delete on public.checkin_guardian_alerts to service_role;

alter table public.notification_outbox drop constraint if exists notification_outbox_kind_check;
alter table public.notification_outbox add constraint notification_outbox_kind_check check (kind in (
  'announcement_published', 'event_published', 'service_live', 'recording_published',
  'group_join_requested', 'group_request_approved', 'group_event_cancelled', 'group_message',
  'household_code_ready', 'checkin_guardian_alert'
));
alter table public.notification_outbox drop constraint if exists notification_outbox_subject_type_check;
alter table public.notification_outbox add constraint notification_outbox_subject_type_check check (subject_type in (
  'announcement', 'stream_event', 'stream_recording', 'group_join_request', 'group_event', 'group_message', 'household', 'checkin_session'
));
alter table public.notification_outbox drop constraint if exists notification_outbox_topic_check;
alter table public.notification_outbox add constraint notification_outbox_topic_check check (topic in ('announcements', 'events', 'groups', 'checkin'));
alter table public.notification_outbox drop constraint if exists notification_outbox_target_shape_check;
alter table public.notification_outbox add constraint notification_outbox_target_shape_check check (
  (topic in ('groups', 'checkin')) = (target_account_ids is not null)
  and (target_account_ids is null or cardinality(target_account_ids) between 1 and 200)
  and (topic <> 'checkin' or (
    (kind = 'household_code_ready' and subject_type = 'household') or
    (kind = 'checkin_guardian_alert' and subject_type = 'checkin_session')
  ))
  and (kind not in ('household_code_ready', 'checkin_guardian_alert') or topic = 'checkin')
  and (subject_type not in ('household', 'checkin_session') or topic = 'checkin')
);

-- Session lock makes the minute cooldown reliable across simultaneous staff clicks.
-- Audit row and push job commit together, and no credential is put in the payload.
create or replace function public.queue_checkin_guardian_alert(
  p_id uuid, p_church_id uuid, p_session_id uuid, p_household_id uuid,
  p_actor_user_id uuid, p_account_ids uuid[], p_deep_link text, p_dedupe_key text
) returns boolean language plpgsql security definer set search_path = public as $$
declare v_session public.checkin_sessions%rowtype;
begin
  select * into v_session from public.checkin_sessions where id = p_session_id and church_id = p_church_id for update;
  if not found or v_session.status <> 'checked_in' or v_session.household_id is distinct from p_household_id then return false; end if;
  if not exists (select 1 from public.household_members where church_id = p_church_id and household_id = p_household_id and member_id = v_session.member_id and relationship = 'dependent') then return false; end if;
  if exists (select 1 from public.checkin_guardian_alerts where session_id = p_session_id and created_at > now() - interval '1 minute') then return false; end if;
  if coalesce(cardinality(p_account_ids), 0) not between 1 and 200 then return false; end if;
  insert into public.checkin_guardian_alerts(id, church_id, session_id, household_id, actor_user_id) values(p_id, p_church_id, p_session_id, p_household_id, p_actor_user_id);
  insert into public.notification_outbox(church_id, kind, subject_type, subject_id, target_visibility, target_account_ids, topic, title, body, deep_link, collapse_key, dedupe_key)
  values(p_church_id, 'checkin_guardian_alert', 'checkin_session', p_session_id, 'members', p_account_ids, 'checkin', 'Please come to Kids Check in', 'Your child needs a guardian. Open Kids Check in for the room details.', p_deep_link, 'checkin-alert-' || p_session_id, p_dedupe_key);
  return true;
end $$;
revoke all on function public.queue_checkin_guardian_alert(uuid, uuid, uuid, uuid, uuid, uuid[], text, text) from public, anon, authenticated;
grant execute on function public.queue_checkin_guardian_alert(uuid, uuid, uuid, uuid, uuid, uuid[], text, text) to service_role;
notify pgrst, 'reload schema';
