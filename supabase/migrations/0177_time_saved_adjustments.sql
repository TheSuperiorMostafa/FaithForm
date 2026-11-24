-- Time-saved adjustments. Add further time-credit fixes to this file
-- until it is applied.

-- 1) Attendance follow-up texts: 4 minutes (was 2).
-- The trigger below matches 0136 except for the minutes value.
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
      'Attendance follow-up text sent', 4, source_key, new.delivery_confirmed_at);
  end if;
  return new;
end;
$$;
revoke all on function public.credit_confirmed_attendance_sms() from public, anon, authenticated;

-- Bring already-credited texts in line with the new value.
update public.activity_log set time_saved_minutes = 4
  where automation_type = 'Attendance Follow-up Text' and time_saved_minutes = 2;

-- 2) Announcement credits are now logged per announcement so each shows in the
--    admin Activity tab: Publish Announcement 5, Church App Updated 8,
--    Facebook Post about Announcement 20, Announcement Email 20 (minutes).
--    Facebook and email used to be computed on the fly and never logged, and
--    Publish Announcement used one fixed trigger source, so only each church's
--    first announcement was ever logged. Replace that row and backfill every
--    existing announcement. Trigger sources match lib/activity/credits.ts.
--    Migration 0019 also backfilled one 15-minute 'backfill:announcement:<id>'
--    row per announcement (published or not); left in place it would count on
--    top of the rows below.
delete from public.activity_log
  where automation_type = 'Publish Announcement'
    and (trigger_source = 'announcements_module' or trigger_source like 'backfill:announcement:%');

insert into public.activity_log (church_id, automation_type, category, task_name, time_saved_minutes, trigger_source, executed_at)
select a.church_id, c.automation_type, c.category, coalesce(a.title, a.event_title), c.minutes,
       c.prefix || ':' || a.id::text, c.executed_at
from public.announcements a
cross join lateral (values
  ('Publish Announcement', 'Communication', 5, 'announcement_publish',
     coalesce(a.published_at, a.created_at), a.status = 'published'),
  ('Church App Updated', 'Calendar', 8, 'announcement_app',
     coalesce(a.mobile_published_at, a.created_at), coalesce(a.mobile_visibility, 'none') <> 'none'),
  ('Facebook Post about Announcement', 'Social', 20, 'announcement_facebook',
     a.created_at, a.push_to_facebook),
  ('Announcement Email', 'Communication', 20, 'announcement_email',
     a.created_at, a.push_to_team)
) as c(automation_type, category, minutes, prefix, executed_at, applies)
where c.applies
  and not exists (
    select 1 from public.activity_log l
    where l.church_id = a.church_id and l.trigger_source = c.prefix || ':' || a.id::text
  );

-- 3) Catalog minutes changed on 2026-11-24. Bring already-logged entries in
--    line so the Activity tab and totals use the new values.
update public.activity_log l
set time_saved_minutes = v.minutes
from (values
  ('Track Weekly Attendance', 10),
  ('Annual Attendance Report', 90),
  ('Sermon Created', 15),
  ('Sermon Outline Generated', 30),
  ('Sermon Published', 10),
  ('Discussion Questions Generated', 15),
  ('Sermon PDF Exported', 15),
  ('Sermon PPTX Exported', 45),
  ('Sermon Series Created', 45)
) as v(automation_type, minutes)
where l.automation_type = v.automation_type
  and l.time_saved_minutes is distinct from v.minutes;

update public.activity_log
set automation_type = 'Personalized Pastoral Follow-up'
where automation_type = 'Sent Personalized Pastoral Follow up if msg';

-- Phone calls: length of the call (rounded up to the minute) + 5 minutes.
-- Was the larger of the call length and 5. Migration 0019 also backfilled
-- calls as 'backfill:phone_call:<phone_calls.id>'; drop that copy where the
-- webhook logged the same call, and fix the minutes on both forms.
delete from public.activity_log b
using public.phone_calls pc
where b.trigger_source = 'backfill:phone_call:' || pc.id::text
  and b.church_id = pc.church_id
  and exists (
    select 1 from public.activity_log l
    where l.church_id = pc.church_id and l.trigger_source = 'phone_call:' || pc.retail_ai_call_id
  );

update public.activity_log l
set time_saved_minutes = coalesce(ceil(pc.duration_seconds / 60.0)::int, 0) + 5,
    task_name = regexp_replace(l.task_name, '\(\d+ min saved\)',
      '(' || (coalesce(ceil(pc.duration_seconds / 60.0)::int, 0) + 5) || ' min saved)')
from public.phone_calls pc
where l.automation_type = 'Phone Call + Duration of Call'
  and l.trigger_source in ('phone_call:' || pc.retail_ai_call_id, 'backfill:phone_call:' || pc.id::text)
  and l.church_id = pc.church_id;

-- 4) Every task now logs to activity_log so churches (and the admin Activity
--    tab) can see each credit. Fix two more fixed trigger sources that logged
--    only a church's first ever item, and backfill what can be rebuilt.

-- Weekly attendance: one entry per Sunday (was 'attendance_module').
-- attendance_records has no unique (church_id, service_date), so take one row
-- per Sunday; otherwise a duplicated Sunday would insert two entries here.
-- Also replaces 0019's 'backfill:attendance:<record id>' rows, which would
-- otherwise sit beside the per-Sunday rows below.
delete from public.activity_log
  where automation_type = 'Track Weekly Attendance'
    and (trigger_source = 'attendance_module' or trigger_source like 'backfill:attendance:%');
insert into public.activity_log (church_id, automation_type, category, task_name, time_saved_minutes, trigger_source, executed_at)
select distinct on (r.church_id, r.service_date)
       r.church_id, 'Track Weekly Attendance', 'Admin',
       'Weekly attendance recorded for ' || r.service_date::text, 10,
       'attendance:' || r.service_date::text,
       coalesce(r.submitted_at, (r.service_date::timestamp + interval '12 hours') at time zone 'UTC')
from public.attendance_records r
where not exists (
  select 1 from public.activity_log l
  where l.church_id = r.church_id and l.trigger_source = 'attendance:' || r.service_date::text
)
order by r.church_id, r.service_date, r.submitted_at;

-- Sermon series: one entry per series (was 'sermon_module:series').
delete from public.activity_log
  where automation_type = 'Sermon Series Created' and trigger_source = 'sermon_module:series';
insert into public.activity_log (church_id, automation_type, category, task_name, time_saved_minutes, trigger_source, executed_at)
select s.church_id, 'Sermon Series Created', 'Admin', s.title, 45,
       'sermon_module:series:' || s.id::text, s.created_at
from public.sermon_series s
where not exists (
  select 1 from public.activity_log l
  where l.church_id = s.church_id and l.trigger_source = 'sermon_module:series:' || s.id::text
);

-- Attendance reports: monthly 25, quarterly 40, annual 90, for every finished
-- period in which the church recorded attendance. Monthly used to be counted
-- on the fly; quarterly and annual were never credited. New periods are
-- credited by lib/activity/attendance-report-credits.ts.
insert into public.activity_log (church_id, automation_type, category, task_name, time_saved_minutes, trigger_source, executed_at)
select p.church_id, p.automation_type, 'Admin', p.label || ' attendance report', p.minutes,
       'attendance_report:' || p.period, (p.period_end::timestamp + interval '12 hours') at time zone 'UTC'
from (
  select distinct r.church_id, 'Monthly Attendance Report' as automation_type, 25 as minutes,
         to_char(r.service_date, 'YYYY-MM') as period,
         to_char(r.service_date, 'FMMonth YYYY') as label,
         (date_trunc('month', r.service_date) + interval '1 month')::date as period_end
  from public.attendance_records r
  union
  select distinct r.church_id, 'Quarterly Attendance Report', 40,
         to_char(r.service_date, 'YYYY') || '-Q' || extract(quarter from r.service_date)::int,
         'Quarter ' || extract(quarter from r.service_date)::int || ', ' || to_char(r.service_date, 'YYYY'),
         (date_trunc('quarter', r.service_date) + interval '3 months')::date
  from public.attendance_records r
  union
  select distinct r.church_id, 'Annual Attendance Report', 90,
         to_char(r.service_date, 'YYYY'),
         to_char(r.service_date, 'YYYY'),
         (date_trunc('year', r.service_date) + interval '1 year')::date
  from public.attendance_records r
) p
where p.period_end <= current_date
  and not exists (
    select 1 from public.activity_log l
    where l.church_id = p.church_id and l.trigger_source = 'attendance_report:' || p.period
  );

-- 5) Sermon discussion questions, handouts (PDF), and slides (PPTX) now count
--    from activity_log, one per sermon, matching what Activity shows. Make sure
--    every sermon with one of these assets has its entry, under the trigger
--    sources the app writes (lib/queries/sermons.ts, app/api/sermon/[id]/export).
--    Migration 0019 backfilled one row per sermon_assets row instead
--    ('backfill:sermon_asset:<asset id>'); those are replaced, not kept beside.
with kinds(kind, automation_type, minutes, prefix) as (values
  ('discussion_questions', 'Discussion Questions Generated', 15, 'sermon_module:asset:discussion_questions:'),
  ('export_pdf', 'Sermon PDF Exported', 15, 'sermon_module:export:pdf:'),
  ('export_pptx', 'Sermon PPTX Exported', 45, 'sermon_module:export:pptx:')
)
insert into public.activity_log (church_id, automation_type, category, task_name, time_saved_minutes, trigger_source, executed_at)
select s.church_id, k.automation_type, 'Admin', s.title, k.minutes, k.prefix || s.id::text, min(a.created_at)
from public.sermon_assets a
join public.sermons s on s.id = a.sermon_id
join kinds k on k.kind = a.kind::text
where not exists (
  select 1 from public.activity_log l
  where l.church_id = s.church_id and l.trigger_source = k.prefix || s.id::text
)
group by s.church_id, s.id, s.title, k.automation_type, k.minutes, k.prefix;

delete from public.activity_log where trigger_source like 'backfill:sermon_asset:%';

-- 6) Removed task types: nothing in the app credits these any more, and
--    hours saved would otherwise keep counting old rows by their stored minutes.
delete from public.activity_log
  where automation_type in (
    'Social Snippet Generated',
    'Right Now Media Post',
    'Pastor Repost Live on Personal Account',
    'Missed Sunday list creation and send'
  );
