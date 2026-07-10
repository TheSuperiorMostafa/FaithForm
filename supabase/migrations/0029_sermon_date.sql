-- User-selected preaching/service date for sermons (distinct from created_at).
ALTER TABLE public.sermons
  ADD COLUMN IF NOT EXISTS sermon_date date;
