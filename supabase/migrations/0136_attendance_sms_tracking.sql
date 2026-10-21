-- Accepted API requests are distinct from handset-confirmed sends.
alter table public.attendance_follow_up_log
  drop constraint if exists attendance_follow_up_log_status_check;
alter table public.attendance_follow_up_log
  add constraint attendance_follow_up_log_status_check
  check (status in ('queued', 'sent', 'failed', 'skipped'));
alter table public.attendance_follow_up_log
  add column if not exists delivery_confirmed_at timestamptz,
  add column if not exists app_checked_at timestamptz,
  add column if not exists app_checked_by uuid references auth.users(id) on delete set null,
  add column if not exists delivery_checked_at timestamptz;

-- Existing history predates the required handset check. Do not retroactively
-- make old attendance pages demand confirmation or award old sends time credit.
update public.attendance_follow_up_log set app_checked_at = created_at where app_checked_at is null;

create index if not exists attendance_follow_up_pending_delivery_idx
  on public.attendance_follow_up_log (delivery_checked_at nulls first, created_at)
  where status = 'queued' and sms_id is not null;
create index if not exists attendance_follow_up_app_check_idx
  on public.attendance_follow_up_log (church_id, service_date)
  where app_checked_at is null and status in ('queued', 'sent');

-- The log already restricts writes to the service role. Keep this function
-- SECURITY INVOKER so the trigger cannot expand a caller's privileges.
create or replace function public.credit_confirmed_attendance_sms()
returns trigger language plpgsql set search_path = public, pg_temp as $$
declare source_key text;
begin
  if new.status <> 'sent' or new.delivery_confirmed_at is null or new.sms_id is null then
    return new;
  end if;
  source_key := 'attendance_sms:' || new.church_id::text || ':' || new.sms_id;
  -- Provider retries and overlapping reconciliation runs must credit once.
  perform pg_advisory_xact_lock(hashtextextended(source_key, 0));
  if not exists (select 1 from public.activity_log where church_id = new.church_id and trigger_source = source_key) then
    insert into public.activity_log (church_id, automation_type, category, task_name, time_saved_minutes, trigger_source, executed_at)
    values (new.church_id, 'Attendance Follow-up Text', 'Communication',
      'Attendance follow-up text sent', 2, source_key, new.delivery_confirmed_at);
  end if;
  return new;
end;
$$;
revoke all on function public.credit_confirmed_attendance_sms() from public, anon, authenticated;
drop trigger if exists attendance_sms_confirmed_credit on public.attendance_follow_up_log;
create trigger attendance_sms_confirmed_credit
  after insert or update of status, delivery_confirmed_at on public.attendance_follow_up_log
  for each row execute function public.credit_confirmed_attendance_sms();
