-- Migration 0168
--
-- Sermon Builder and Lesson Builder become separate sections. A lesson stays a
-- `sermons` row (same outline, questions, editor, print view and PDF), marked by
-- which builder made it:
--
--   'sermon' — made in Sermon Builder (slides). If it also has a lesson, that
--              lesson is listed under Lessons too, linked back to the sermon.
--   'lesson' — made in Lesson Builder (from a title and passage, or from a
--              recording). Listed only under Lessons.
--
-- Additive: every existing row is a sermon, so both lists show exactly what
-- they did before, and old app versions that do not send the column keep
-- working through the default. No policy or grant changes.

alter table public.sermons
  add column if not exists builder text not null default 'sermon';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'sermons_builder_check'
  ) then
    alter table public.sermons
      add constraint sermons_builder_check check (builder in ('sermon', 'lesson'));
  end if;
end $$;

create index if not exists sermons_church_builder_updated
  on public.sermons (church_id, builder, updated_at desc);

-- The Lessons list: lesson-builder rows, plus sermons that have a lesson.
create index if not exists sermons_church_lessons_updated
  on public.sermons (church_id, updated_at desc)
  where builder = 'lesson' or outline is not null;
