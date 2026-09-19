-- A service keeps the exact published slide version used during worship.
-- Recordings inherit this association through stream_event_id.
create table public.stream_event_presentations (
  event_id uuid primary key references public.stream_events(id) on delete cascade,
  church_id uuid not null references public.churches(id) on delete cascade,
  presentation_id uuid not null references public.sermon_presentation_versions(id) on delete cascade,
  updated_at timestamptz not null default now()
);
create index stream_event_presentations_presentation_idx
  on public.stream_event_presentations(presentation_id, church_id);
alter table public.stream_event_presentations enable row level security;
-- Staff mutations are authorized by the dashboard API. Mobile has only the
-- audience-filtered functions below; callers cannot supply their own audience.
revoke all on public.stream_event_presentations from public, anon, authenticated;
grant select, insert, update, delete on public.stream_event_presentations to service_role;

create function public.check_service_presentation_church()
returns trigger language plpgsql set search_path = public as $$
begin
  if not exists (select 1 from public.stream_events e
                 where e.id = new.event_id and e.church_id = new.church_id)
     or not exists (select 1 from public.sermon_presentation_versions p
                    join public.sermons s on s.id = p.sermon_id and s.church_id = p.church_id
                    where p.id = new.presentation_id and p.church_id = new.church_id) then
    raise exception 'Service and presentation must belong to the same church' using errcode = '23514';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
create trigger stream_event_presentations_church_check
before insert or update on public.stream_event_presentations
for each row execute function public.check_service_presentation_church();

create function public.mobile_media_presentation(
  p_church_slug text, p_relationship_state text, p_kind text, p_media_id uuid
)
returns table (presentation_id uuid, sermon_id uuid, title text)
language sql stable security definer set search_path = public as $$
  select p.id, p.sermon_id, p.title
  from public.stream_event_presentations l
  join public.churches c on c.id = l.church_id and c.slug = p_church_slug
  cross join lateral public.mobile_presentation_detail(p_church_slug, p_relationship_state, l.presentation_id) p
  where (p_kind = 'live' and l.event_id = p_media_id and exists (
    select 1 from public.mobile_media_live(p_church_slug, p_relationship_state) m
    where m.event_id = p_media_id
  )) or (p_kind = 'recording' and exists (
    select 1 from public.stream_recordings r
    cross join lateral public.mobile_media_detail(p_church_slug, p_relationship_state, r.id) m
    where r.id = p_media_id and r.church_id = l.church_id
      and r.stream_event_id = l.event_id and r.mobile_revoked_at is null
  ));
$$;
revoke all on function public.mobile_media_presentation(text, text, text, uuid) from public, anon, authenticated;
grant execute on function public.mobile_media_presentation(text, text, text, uuid) to service_role;

create function public.mobile_sermon_services(
  p_church_slug text, p_relationship_state text, p_sermon_id uuid default null,
  p_presentation_id uuid default null
)
returns table (media_id uuid, kind text, title text, starts_at timestamptz, poster_url text)
language sql stable security definer set search_path = public as $$
  with linked as (
    select e.id, e.starts_at
    from public.stream_event_presentations l
    join public.churches c on c.id = l.church_id and c.slug = p_church_slug
    join public.stream_events e on e.id = l.event_id and e.church_id = l.church_id
    join public.sermon_presentation_versions v on v.id = l.presentation_id and v.church_id = l.church_id
    where p_relationship_state is distinct from 'blocked'
      and ((p_presentation_id is not null and v.id = p_presentation_id and exists (
        select 1 from public.mobile_presentation_detail(p_church_slug, p_relationship_state, p_presentation_id)
      )) or (p_presentation_id is null and v.sermon_id = p_sermon_id and exists (
        select 1 from public.mobile_sermon_detail(p_church_slug, p_relationship_state, p_sermon_id)
      )))
  )
  select chosen.media_id, chosen.kind, chosen.title, chosen.starts_at, chosen.poster_url
  from linked l
  cross join lateral (
    select candidates.* from (
      select m.event_id as media_id, 'live'::text as kind, m.title, m.starts_at, m.poster_url, 0 as priority
      from public.mobile_media_live(p_church_slug, p_relationship_state) m
      join public.stream_events e on e.id = m.event_id and e.mobile_revoked_at is null
      where m.event_id = l.id and m.state = 'live'
      union all
      select m.id, 'recording'::text, m.title, m.recorded_at, m.poster_url, 1
      from public.stream_recordings r
      cross join lateral public.mobile_media_detail(p_church_slug, p_relationship_state, r.id) m
      where r.stream_event_id = l.id and r.mobile_revoked_at is null
    ) candidates
    order by candidates.priority, candidates.starts_at desc, candidates.media_id
    limit 1
  ) chosen
  order by l.starts_at desc, l.id;
$$;
revoke all on function public.mobile_sermon_services(text, text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.mobile_sermon_services(text, text, uuid, uuid) to service_role;
