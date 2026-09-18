-- A pastor's Go Live action is the mobile publication boundary. Do not wait
-- for the relay's encoder-ready callback before surfacing the service: browser
-- ingest can take a few seconds to connect, and during that window the apps
-- must show the new service instead of falling back to an older ended one.

create or replace function public.mobile_media_live(
  p_church_slug text,
  p_relationship_state text,
  p_now timestamptz default now(),
  p_ended_window_hours integer default 24
)
returns table (
  state text,
  event_id uuid,
  title text,
  starts_at timestamptz,
  countdown_enabled boolean,
  poster_url text,
  publication_version integer,
  church_name text,
  church_timezone text
)
language sql
security definer
stable
set search_path = public
as $$
  with visible as (
    select
      e.id,
      e.title,
      e.starts_at,
      e.countdown_enabled,
      coalesce(e.mobile_poster_url, e.artwork_url) as poster_url,
      e.mobile_publication_version,
      e.status,
      e.updated_at,
      c.name as church_name,
      c.timezone as church_timezone
    from public.stream_events e
    join public.churches c on c.id = e.church_id
    where c.slug = p_church_slug
      and p_relationship_state is distinct from 'blocked'
      and e.mobile_visibility <> 'none'
      and e.mobile_unpublished_at is null
      and e.status <> 'cancelled'
      and (
        e.mobile_visibility = 'public'
        or (e.mobile_visibility = 'followers'
            and p_relationship_state in ('following', 'joined'))
        or (e.mobile_visibility = 'members'
            and p_relationship_state = 'joined')
      )
  )
  select
    case
      when v.status = 'live' then 'live'
      when v.status = 'scheduled' and v.starts_at > p_now then 'upcoming'
      else 'recent_ended'
    end as state,
    v.id, v.title, v.starts_at, v.countdown_enabled, v.poster_url,
    v.mobile_publication_version, v.church_name, v.church_timezone
  from visible v
  where v.status = 'live'
     or (v.status = 'scheduled' and v.starts_at > p_now)
     or (v.status = 'ended'
         and v.updated_at > p_now - make_interval(hours => greatest(0, p_ended_window_hours)))
  order by
    case
      when v.status = 'live' then 0
      when v.status = 'scheduled' then 1
      else 2
    end,
    v.starts_at asc
  limit 1;
$$;

revoke all on function public.mobile_media_live(text, text, timestamptz, integer)
  from public, anon, authenticated;
grant execute on function public.mobile_media_live(text, text, timestamptz, integer)
  to service_role;
