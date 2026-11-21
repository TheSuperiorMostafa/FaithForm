-- Migration 0176: Service Plans answers, response alerts and files
--
-- Builds on 0175. Four additions:
--
--   plan_attendance           a shared person's answer for one plan:
--                             "I'll be there" (confirmed) or "Can't make it"
--                             (declined). No row = not confirmed yet.
--   service_types.response_*  who staff want told when someone answers: up to
--                             ten emails and ten mobile numbers per service
--                             type, used by every plan of that type.
--   song_attachments.generated_from
--                             marks the lyrics and chord chart PDFs FaithForm
--                             makes when an arrangement is saved, so a re-save
--                             replaces them instead of piling up copies.
--   plan_item_attachments     files and links attached to one plan item.
--
-- ## Who can answer
--
-- Only a personal share link answers, and only for the person it was sent to.
-- A copy link (audience 'link') has no person and cannot answer: anyone could
-- hold it, so letting it pick a name would let anyone answer for anyone.
-- `service_plan_record_attendance` is called by the share page's server
-- action after it has checked the token; it takes the share id, never a person
-- id, so the caller cannot choose who it answers for.
--
-- ## Access
--
-- As in 0175: staff holding the Service Plans feature read their church
-- through RLS; nothing is writable from the browser; writes are server actions
-- with the service role.
--
-- Additive. Rollback: drop plan_item_attachments, plan_attendance and the
-- function, the generated_from index and column, and the two service_types
-- columns. No existing row changes meaning.

-- ---------------------------------------------------------------------------
-- ANSWERS
-- ---------------------------------------------------------------------------

create table if not exists public.plan_attendance (
  church_id uuid not null,
  plan_id uuid not null,
  person_id uuid not null references public.members (id) on delete cascade,
  status text not null
    constraint plan_attendance_status_check check (status in ('confirmed', 'declined')),
  -- The link they answered through; null when staff set it by hand.
  share_id uuid references public.plan_shares (id) on delete set null,
  responded_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  primary key (plan_id, person_id),
  foreign key (plan_id, church_id)
    references public.plans (id, church_id) on delete cascade
);

create index if not exists plan_attendance_person_idx
  on public.plan_attendance (person_id);
create index if not exists plan_attendance_share_idx
  on public.plan_attendance (share_id)
  where share_id is not null;

drop trigger if exists plan_attendance_person_church on public.plan_attendance;
create trigger plan_attendance_person_church
  before insert or update of person_id, church_id on public.plan_attendance
  for each row execute function public.service_plans_check_person_church();

-- Records one answer through a live personal link and copies it onto the
-- person's team rows for that plan, in one transaction. Returns the answer
-- before this one ('confirmed', 'declined' or null), so the caller only
-- notifies staff when the answer actually changed.
create or replace function public.service_plan_record_attendance(
  p_church_id uuid,
  p_share_id uuid,
  p_status text
)
returns text
language plpgsql
set search_path = public
as $$
declare
  v_plan uuid;
  v_person uuid;
  v_previous text;
begin
  if p_status is null or p_status not in ('confirmed', 'declined') then
    raise exception 'Answer with confirmed or declined' using errcode = '22023';
  end if;

  select s.plan_id, s.person_id
    into v_plan, v_person
    from public.plan_shares s
    join public.plans p on p.id = s.plan_id and p.church_id = s.church_id
   where s.id = p_share_id
     and s.church_id = p_church_id
     and s.revoked_at is null
     and s.expires_at > now()
     and not p.is_template;
  if v_person is null then
    raise exception 'This link cannot answer for anyone' using errcode = 'P0002';
  end if;

  select status into v_previous
    from public.plan_attendance
   where plan_id = v_plan and person_id = v_person
   for update;

  insert into public.plan_attendance (church_id, plan_id, person_id, status, share_id, responded_at)
  values (p_church_id, v_plan, v_person, p_status, p_share_id, now())
  on conflict (plan_id, person_id) do update
    set status = excluded.status,
        share_id = excluded.share_id,
        responded_at = excluded.responded_at;

  update public.plan_team_members
     set status = p_status
   where church_id = p_church_id
     and plan_id = v_plan
     and person_id = v_person
     and status is distinct from p_status;

  return v_previous;
end;
$$;

revoke all on function public.service_plan_record_attendance(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.service_plan_record_attendance(uuid, uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- RESPONSE ALERTS (per service type)
-- ---------------------------------------------------------------------------
--
-- Constant defaults: adding these is a catalogue change, no table rewrite.
-- Values are cleaned by the server action (lower-cased emails, E.164 phones);
-- the checks only bound the size.

alter table public.service_types
  add column if not exists response_notify_emails text[] not null default '{}',
  add column if not exists response_notify_phones text[] not null default '{}';

alter table public.service_types
  drop constraint if exists service_types_response_emails_check;
alter table public.service_types
  add constraint service_types_response_emails_check
  check (cardinality(response_notify_emails) <= 10);
alter table public.service_types
  drop constraint if exists service_types_response_phones_check;
alter table public.service_types
  add constraint service_types_response_phones_check
  check (cardinality(response_notify_phones) <= 10);

-- ---------------------------------------------------------------------------
-- GENERATED SONG PDFS
-- ---------------------------------------------------------------------------

alter table public.song_attachments
  add column if not exists generated_from text;

alter table public.song_attachments
  drop constraint if exists song_attachments_generated_from_check;
alter table public.song_attachments
  add constraint song_attachments_generated_from_check
  check (
    generated_from is null
    or (generated_from in ('lyrics', 'chart') and storage_path is not null)
  );

-- One generated lyrics PDF and one generated chart PDF per arrangement.
create unique index if not exists song_attachments_generated_idx
  on public.song_attachments (arrangement_id, generated_from)
  where generated_from is not null;

-- ---------------------------------------------------------------------------
-- PLAN ITEM FILES
-- ---------------------------------------------------------------------------
--
-- Stored in the private `song-files` bucket under <church_id>/plans/<plan_id>/,
-- uploaded through server-issued signed upload URLs and read through
-- short-lived signed URLs, like song files.

create table if not exists public.plan_item_attachments (
  id uuid primary key default gen_random_uuid(),
  church_id uuid not null,
  plan_id uuid not null,
  plan_item_id uuid not null,
  storage_path text
    constraint plan_item_attachments_path_length check (storage_path is null or length(storage_path) <= 500),
  url text
    constraint plan_item_attachments_url_check check (url is null or (url ~* '^https://' and length(url) <= 2048)),
  file_name text
    constraint plan_item_attachments_file_name_length check (file_name is null or length(file_name) <= 255),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint plan_item_attachments_has_target check ((storage_path is null) <> (url is null)),
  constraint plan_item_attachments_path_church check (storage_path is null or storage_path like church_id::text || '/%'),
  foreign key (plan_item_id, plan_id, church_id)
    references public.plan_items (id, plan_id, church_id) on delete cascade
);

create index if not exists plan_item_attachments_plan_idx
  on public.plan_item_attachments (plan_id, created_at);
create index if not exists plan_item_attachments_item_idx
  on public.plan_item_attachments (plan_item_id);

-- A file is something a share recipient sees, so it moves share_version.
drop trigger if exists plan_item_attachments_bump_share_version on public.plan_item_attachments;
create trigger plan_item_attachments_bump_share_version
  after insert or update or delete on public.plan_item_attachments
  for each row execute function public.service_plans_bump_share_version();

-- ---------------------------------------------------------------------------
-- ROW LEVEL SECURITY
-- ---------------------------------------------------------------------------

alter table public.plan_attendance enable row level security;
alter table public.plan_item_attachments enable row level security;

revoke all on table public.plan_attendance from public, anon, authenticated;
revoke all on table public.plan_item_attachments from public, anon, authenticated;

grant select on table public.plan_attendance, public.plan_item_attachments to authenticated;
grant select, insert, update, delete on table public.plan_attendance, public.plan_item_attachments to service_role;

drop policy if exists plan_attendance_select on public.plan_attendance;
create policy plan_attendance_select on public.plan_attendance
  for select to authenticated using (public.has_service_plans_access(church_id));
drop policy if exists plan_item_attachments_select on public.plan_item_attachments;
create policy plan_item_attachments_select on public.plan_item_attachments
  for select to authenticated using (public.has_service_plans_access(church_id));

-- ---------------------------------------------------------------------------
-- REALTIME
-- ---------------------------------------------------------------------------
--
-- Staff with the plan open see answers and files arrive without a refresh.

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'plan_attendance'
    ) then
      alter publication supabase_realtime add table public.plan_attendance;
    end if;
    if not exists (
      select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'plan_item_attachments'
    ) then
      alter publication supabase_realtime add table public.plan_item_attachments;
    end if;
  end if;
end $$;
