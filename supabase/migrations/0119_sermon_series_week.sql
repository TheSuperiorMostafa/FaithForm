-- Keep a sermon attached to the specific planned week it came from. Older
-- sermons remain attached to their series with a null week and are displayed
-- separately until a unique title/passage match can identify their week.
alter table public.sermons
  add column if not exists series_week integer;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.sermons'::regclass
       and conname = 'sermons_series_week_range'
  ) then
    alter table public.sermons
      add constraint sermons_series_week_range
      check (series_week is null or series_week between 1 and 52);
  end if;
end;
$$;

create index if not exists sermons_series_week_created_idx
  on public.sermons (series_id, series_week, created_at desc)
  where series_id is not null;

notify pgrst, 'reload schema';
