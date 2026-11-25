-- Announcement Email is now credited at 5 minutes (was 20). New credits use
-- lib/automation-catalog.ts; bring already-logged rows (including the 0177
-- backfill) in line so the Activity tab and hours-saved totals agree.
update public.activity_log
set time_saved_minutes = 5
where automation_type = 'Announcement Email'
  and time_saved_minutes is distinct from 5;
