-- App members in People, and one answer to "who came"
-- Migration 0083
--
-- Additive. One new column on `members`, one widened check on
-- `visitor_people_claims.source`, one index, new functions, and one trigger.
-- Existing attendance history is read, never rewritten — the one exception is
-- an explicit staff action, `move_people_link`, described below.
--
-- ## What was wrong
--
--   1. **Nobody who joined in the app could be checked in automatically.**
--      A self check-in resolves the person through an active
--      `visitor_people_links` row, and the only code path that created one
--      approved a People *claim*. Nothing ever opened a claim: the app has no
--      screen for it, no route called `requestPeopleClaim`, and approving a
--      join request did not create one. Every app user was refused with
--      `no_people_link` — "Your church needs to confirm who you are" — and the
--      dashboard had nothing to confirm.
--
--   2. **People who joined in the app were not in People.** Joining wrote a
--      `visitor_church_relationships` row and nothing else, so the directory,
--      the weekly sheet and follow-up never heard of them.
--
--   3. **Check-ins were not attendance.** The weekly sheet, the dashboard
--      chart, the People counts and follow-up read `attendance_records` /
--      `attendance_entries`. Automatic, scanned and kiosk check-ins are counted
--      in `attendance_facts`, and room check-ins in `checkin_sessions`. The
--      three never met, so a person checked in by the app was "not started" on
--      the weekly page and could be texted "we missed you" the same afternoon.
--
-- ## What this changes — an explicit superseding decision
--
-- Prompt 3 held that FaithForm may never create a `members` row, and that a
-- link is created only by staff approving a claim. That rule is superseded,
-- narrowly: **joining a church makes you one of its people.** When an account's
-- relationship with a church becomes `joined` (an open join, an approved
-- request, an accepted invitation, or dashboard staff opening the app):
--
--   - if the account is already linked there, nothing happens;
--   - if nobody in that church's People has the same name, a People record is
--     created from the account's name *only* — never its email — and linked;
--   - otherwise (or when the account has no name) a claim is opened and a
--     person decides, from the People page, whether it is someone already
--     there or someone new.
--
-- What Prompt 3 protected is kept: nothing ever links an account to an
-- **existing** People record without a staff member choosing it, and email or
-- phone never decide anything. A new record belongs to the account that caused
-- it, so linking it discloses nothing the account holder did not type.
--
-- ## One answer to "who came"
--
-- `attendance_presence` reads every way a person can be recorded at church —
-- the weekly sheet, the app, a scanned code, the kiosk, the Services roster,
-- and a room check-in — as one list of (person, day, how). The totals below it
-- count each person once per day however many ways they were recorded. The
-- functions are SECURITY INVOKER: a caller sees exactly the rows their own row
-- security already lets them read.
--
-- Rollback: drop the trigger and the new functions, drop
-- `members.source`, and restore the two-value check on
-- `visitor_people_claims.source` (after resolving any 'join' claims). Links
-- and People records created meanwhile are ordinary rows and can stay.

-- ---------------------------------------------------------------------------
-- Where a People record came from
-- ---------------------------------------------------------------------------
--
-- 'app' marks a record FaithForm created because someone joined in the app.
-- It is what lets staff fold such a record into the person it turned out to
-- be (`move_people_link`) without ever doing that to a record a church made.

alter table public.members
  add column if not exists source text not null default 'dashboard';

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conname = 'members_source_check'
       and conrelid = 'public.members'::regclass
  ) then
    alter table public.members
      add constraint members_source_check
      check (source in ('dashboard', 'app'));
  end if;
end $$;

-- A claim opened because someone joined, rather than because they asked.
-- Like a self request it names no target: the candidates are suggestions
-- worked out when staff look, never stored as an answer.
--
-- 0053 declared the old two-value check inline, so its name is whatever
-- Postgres generated. Drop it by what it checks rather than by a guessed name;
-- the self-request-has-no-target rule also mentions `source` and stays.
do $$
declare
  v_constraint text;
begin
  for v_constraint in
    select c.conname
      from pg_constraint c
     where c.conrelid = 'public.visitor_people_claims'::regclass
       and c.contype = 'c'
       and pg_get_constraintdef(c.oid) ~ '\msource\M'
       and pg_get_constraintdef(c.oid) !~ 'requested_member_id'
  loop
    execute format('alter table public.visitor_people_claims drop constraint %I', v_constraint);
  end loop;
end $$;
alter table public.visitor_people_claims
  add constraint visitor_people_claims_source_check
  check (source in ('self_request', 'invitation', 'join'));

-- The weekly totals read occurrences by their local day.
create index if not exists service_occurrences_church_local_date_idx
  on public.service_occurrences (church_id, local_service_date);

-- ---------------------------------------------------------------------------
-- Names
-- ---------------------------------------------------------------------------

-- "  Mary   Ann  Smith " -> "Mary Ann Smith"; blank -> null.
create or replace function public.tidy_person_name(p_name text)
returns text
language sql
immutable
set search_path = public
as $$
  select nullif(regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g'), '')
$$;

-- The comparison key for "is this the same name". Case-insensitive, and blind
-- to how the name was split between the two columns.
create or replace function public.person_name_key(p_first text, p_last text)
returns text
language sql
immutable
set search_path = public
as $$
  select lower(public.tidy_person_name(coalesce(p_first, '') || ' ' || coalesce(p_last, '')))
$$;

-- The last word is the last name; everything before it the first. One word is
-- a first name alone, which is what the dashboard's own form allows.
create or replace function public.split_person_name(p_name text)
returns table (first_name text, last_name text)
language sql
immutable
set search_path = public
as $$
  with tidy as (select public.tidy_person_name(p_name) as name)
  select
    case
      when position(' ' in name) = 0 then name
      else regexp_replace(name, '\s+\S+$', '')
    end,
    case
      when position(' ' in name) = 0 then ''
      else substring(name from '\S+$')
    end
  from tidy
  where name is not null
$$;

-- The name an account gave, as the church may already see it. The display
-- name first; failing that, the name typed at sign-up (dashboard staff carry
-- theirs as `full_name`). Never the email address: churches are told they see
-- a member's name, and that is all this reads.
create or replace function public.app_account_name(p_account_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select public.tidy_person_name(left(
    coalesce(
      public.tidy_person_name(a.display_name),
      public.tidy_person_name(u.raw_user_meta_data ->> 'display_name'),
      public.tidy_person_name(u.raw_user_meta_data ->> 'full_name'),
      public.tidy_person_name(u.raw_user_meta_data ->> 'name')
    ),
    120
  ))
    from public.visitor_accounts a
    left join auth.users u on u.id = a.user_id
   where a.id = p_account_id
$$;

revoke all on function public.app_account_name(uuid) from public, anon, authenticated;
grant execute on function public.app_account_name(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Joining makes you one of the church's people
-- ---------------------------------------------------------------------------
--
-- Returns what happened, so a caller can say so:
--   'linked'           a People record was created and linked
--   'already_linked'   nothing to do
--   'awaiting_staff'   a claim is open; a person decides on the People page
--   'not_joined'       the account is not a member of this church
--   'account_inactive' the account is being deleted or was deactivated
--
-- Idempotent, and serialised per account and church, so two devices joining
-- at once create one record rather than two.

create or replace function public.connect_app_member(
  p_account_id uuid,
  p_church_id uuid,
  p_actor_user_id uuid default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_state text;
  v_status text;
  v_name text;
  v_first text;
  v_last text;
  v_member_id uuid;
  v_link_id uuid;
  v_claim_id uuid;
  v_actor_type text := case when p_actor_user_id is null then 'system' else 'staff' end;
begin
  if p_account_id is null or p_church_id is null then
    return 'not_joined';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('connect_app_member:' || p_account_id::text || ':' || p_church_id::text, 0)
  );

  select r.state into v_state
    from public.visitor_church_relationships r
   where r.account_id = p_account_id
     and r.church_id = p_church_id;

  if v_state is distinct from 'joined' then
    return 'not_joined';
  end if;

  select a.status into v_status
    from public.visitor_accounts a
   where a.id = p_account_id;

  if v_status is distinct from 'active' then
    return 'account_inactive';
  end if;

  if exists (
    select 1
      from public.visitor_people_links l
     where l.account_id = p_account_id
       and l.church_id = p_church_id
       and l.is_active
  ) then
    return 'already_linked';
  end if;

  if exists (
    select 1
      from public.visitor_people_claims c
     where c.account_id = p_account_id
       and c.church_id = p_church_id
       and c.status in ('pending', 'disputed')
  ) then
    return 'awaiting_staff';
  end if;

  v_name := public.app_account_name(p_account_id);

  if v_name is not null then
    select s.first_name, s.last_name into v_first, v_last
      from public.split_person_name(v_name) s;
  end if;

  -- Someone in People already has this name — or there is no name to go on.
  -- Either way this is exactly the case where guessing links the wrong person,
  -- so it becomes a question for staff rather than an answer.
  if v_name is null or exists (
    select 1
      from public.members m
     where m.church_id = p_church_id
       and public.person_name_key(m.first_name, m.last_name) = lower(v_name)
  ) then
    insert into public.visitor_people_claims (
      account_id, church_id, status, source, claimed_first_name, claimed_last_name
    ) values (
      p_account_id, p_church_id, 'pending', 'join', v_first, nullif(v_last, '')
    )
    returning id into v_claim_id;

    insert into public.visitor_people_link_events (
      church_id, account_id, claim_id, action, to_status, actor_type, actor_user_id, note
    ) values (
      p_church_id, p_account_id, v_claim_id, 'claim_opened_on_join', 'pending',
      v_actor_type, p_actor_user_id,
      case
        when v_name is null then 'The app account has no name.'
        else 'Someone in People already has this name.'
      end
    );

    return 'awaiting_staff';
  end if;

  insert into public.members (church_id, first_name, last_name, is_active, source)
  values (p_church_id, v_first, coalesce(v_last, ''), true, 'app')
  returning id into v_member_id;

  insert into public.visitor_people_links (
    account_id, church_id, member_id, is_active, linked_at, linked_by
  ) values (
    p_account_id, p_church_id, v_member_id, true, now(), p_actor_user_id
  )
  returning id into v_link_id;

  insert into public.visitor_people_link_events (
    church_id, account_id, link_id, member_id, action, to_status, actor_type, actor_user_id
  ) values (
    p_church_id, p_account_id, v_link_id, v_member_id, 'member_created_on_join', 'active',
    v_actor_type, p_actor_user_id
  );

  -- A device holding a cached "no link" refusal must ask again.
  update public.visitor_accounts
     set authorization_version = authorization_version + 1,
         updated_at = now()
   where id = p_account_id;

  return 'linked';
end;
$$;

revoke all on function public.connect_app_member(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.connect_app_member(uuid, uuid, uuid)
  to service_role;

-- ---------------------------------------------------------------------------
-- Staff answer a claim with "someone new"
-- ---------------------------------------------------------------------------
--
-- `approveClaim` links a claim to a person staff picked. This is the other
-- answer: nobody in People is this person, so add them. Creating the record,
-- linking it and closing the claim happen together or not at all.

create or replace function public.add_people_claim_as_new_person(
  p_church_id uuid,
  p_claim_id uuid,
  p_staff_user_id uuid,
  p_first_name text,
  p_last_name text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claim public.visitor_people_claims%rowtype;
  v_first text := left(public.tidy_person_name(p_first_name), 120);
  v_last text := coalesce(left(public.tidy_person_name(p_last_name), 120), '');
  v_member_id uuid;
  v_link_id uuid;
  v_now timestamptz := now();
begin
  if v_first is null then
    raise exception 'first_name_required';
  end if;

  select * into v_claim
    from public.visitor_people_claims c
   where c.id = p_claim_id
     and c.church_id = p_church_id
   for update;

  if not found then
    raise exception 'claim_not_found';
  end if;

  if v_claim.status not in ('pending', 'disputed') then
    raise exception 'claim_resolved';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('connect_app_member:' || v_claim.account_id::text || ':' || p_church_id::text, 0)
  );

  if exists (
    select 1
      from public.visitor_people_links l
     where l.account_id = v_claim.account_id
       and l.church_id = p_church_id
       and l.is_active
  ) then
    raise exception 'already_linked';
  end if;

  insert into public.members (church_id, first_name, last_name, is_active, source)
  values (p_church_id, v_first, v_last, true, 'app')
  returning id into v_member_id;

  insert into public.visitor_people_links (
    account_id, church_id, member_id, claim_id, is_active, linked_at, linked_by
  ) values (
    v_claim.account_id, p_church_id, v_member_id, v_claim.id, true, v_now, p_staff_user_id
  )
  returning id into v_link_id;

  update public.visitor_people_claims
     set status = 'approved',
         resolved_member_id = v_member_id,
         resolved_by = p_staff_user_id,
         resolved_at = v_now,
         resolution_note = 'Added as a new person',
         updated_at = v_now
   where id = v_claim.id;

  insert into public.visitor_people_link_events (
    church_id, account_id, claim_id, link_id, member_id, action,
    from_status, to_status, actor_type, actor_user_id
  ) values (
    p_church_id, v_claim.account_id, v_claim.id, v_link_id, v_member_id,
    'claim_approved_new_person', v_claim.status, 'approved', 'staff', p_staff_user_id
  );

  update public.visitor_accounts
     set authorization_version = authorization_version + 1,
         updated_at = v_now
   where id = v_claim.account_id;

  return v_member_id;
end;
$$;

revoke all on function public.add_people_claim_as_new_person(uuid, uuid, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.add_people_claim_as_new_person(uuid, uuid, uuid, text, text)
  to service_role;

-- ---------------------------------------------------------------------------
-- Staff move an app connection to the right person
-- ---------------------------------------------------------------------------
--
-- For when the record an account is linked to is not the one staff mean —
-- most often a record created on joining for someone who was already in
-- People under a different spelling.
--
-- The link always moves. When the old record is one FaithForm created on
-- joining (`source = 'app'`), it existed only for this account, so what it
-- gathered moves with it and it is retired:
--
--   - counted facts move, unless the person was already counted at that
--     service — then the duplicate is reversed, with a correction row, so the
--     same human is never counted twice;
--   - attempts follow their facts;
--   - weekly-sheet entries move; where both records were on the same sheet,
--     "present" wins and the duplicate entry goes, and that sheet's totals are
--     recounted;
--   - room check-ins move, unless one is already open for the person that day;
--   - the old record is deactivated, never deleted.
--
-- A record the church made itself is left exactly as it is: only the link
-- moves.

create or replace function public.move_people_link(
  p_church_id uuid,
  p_from_member_id uuid,
  p_to_member_id uuid,
  p_staff_user_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_from public.members%rowtype;
  v_link public.visitor_people_links%rowtype;
  v_new_link_id uuid;
  v_sheets uuid[];
  v_now timestamptz := now();
begin
  if p_from_member_id is null or p_to_member_id is null
     or p_from_member_id = p_to_member_id then
    raise exception 'invalid_target';
  end if;

  select * into v_from
    from public.members m
   where m.id = p_from_member_id
     and m.church_id = p_church_id
   for update;

  if not found then
    raise exception 'member_not_found';
  end if;

  perform 1
    from public.members m
   where m.id = p_to_member_id
     and m.church_id = p_church_id
     and m.is_active
   for update;

  if not found then
    raise exception 'member_not_found';
  end if;

  select * into v_link
    from public.visitor_people_links l
   where l.member_id = p_from_member_id
     and l.church_id = p_church_id
     and l.is_active
   for update;

  if not found then
    raise exception 'not_linked';
  end if;

  if exists (
    select 1
      from public.visitor_people_links l
     where l.member_id = p_to_member_id
       and l.is_active
  ) then
    raise exception 'member_already_claimed';
  end if;

  update public.visitor_people_links
     set is_active = false,
         revoked_at = v_now,
         revoked_by = p_staff_user_id,
         revoke_reason = 'Moved to another person',
         updated_at = v_now
   where id = v_link.id;

  insert into public.visitor_people_links (
    account_id, church_id, member_id, claim_id, is_active, linked_at, linked_by
  ) values (
    v_link.account_id, p_church_id, p_to_member_id, v_link.claim_id, true, v_now, p_staff_user_id
  )
  returning id into v_new_link_id;

  insert into public.visitor_people_link_events (
    church_id, account_id, link_id, member_id, action, from_status, to_status,
    actor_type, actor_user_id
  ) values
    (p_church_id, v_link.account_id, v_link.id, p_from_member_id,
     'link_moved_away', 'active', 'revoked', 'staff', p_staff_user_id),
    (p_church_id, v_link.account_id, v_new_link_id, p_to_member_id,
     'link_moved_here', null, 'active', 'staff', p_staff_user_id);

  if v_from.source = 'app' then
    -- Counted facts. The unique (occurrence, member) slot is taken by reversed
    -- facts too, so "already counted" means any fact at all.
    update public.attendance_facts f
       set member_id = p_to_member_id,
           updated_at = v_now
     where f.member_id = p_from_member_id
       and f.church_id = p_church_id
       and not exists (
         select 1
           from public.attendance_facts t
          where t.service_occurrence_id = f.service_occurrence_id
            and t.member_id = p_to_member_id
       );

    insert into public.attendance_corrections (
      church_id, service_occurrence_id, member_id, fact_id, action,
      previous_status, new_status, actor_user_id, reason
    )
    select f.church_id, f.service_occurrence_id, f.member_id, f.id, 'reverse',
           'active', 'reversed', p_staff_user_id,
           'Same person as another People record; counted there already.'
      from public.attendance_facts f
     where f.member_id = p_from_member_id
       and f.church_id = p_church_id
       and f.status = 'active';

    update public.attendance_facts
       set status = 'reversed',
           reversed_at = v_now,
           updated_at = v_now
     where member_id = p_from_member_id
       and church_id = p_church_id
       and status = 'active';

    update public.attendance_attempts
       set member_id = p_to_member_id
     where member_id = p_from_member_id
       and church_id = p_church_id;

    -- Weekly sheets where both records appear: one person, so one entry.
    with pairs as (
      select e.id as from_id,
             e.record_id,
             e.status as from_status,
             t.id as to_id,
             t.status as to_status
        from public.attendance_entries e
        join public.attendance_entries t
          on t.record_id = e.record_id
         and t.member_id = p_to_member_id
       where e.member_id = p_from_member_id
         and e.church_id = p_church_id
    ),
    promoted as (
      update public.attendance_entries t
         set status = 'present'
        from pairs p
       where t.id = p.to_id
         and p.from_status = 'present'
         and p.to_status = 'absent'
      returning t.record_id
    ),
    removed as (
      delete from public.attendance_entries e
       using pairs p
       where e.id = p.from_id
      returning e.record_id
    )
    select array_agg(distinct x.record_id) into v_sheets
      from (
        select record_id from promoted
        union all
        select record_id from removed
      ) x;

    update public.attendance_entries
       set member_id = p_to_member_id
     where member_id = p_from_member_id
       and church_id = p_church_id;

    if v_sheets is not null then
      update public.attendance_records r
         set total_present = (
               select count(*) from public.attendance_entries e
                where e.record_id = r.id and e.status = 'present'
             ),
             total_absent = (
               select count(*) from public.attendance_entries e
                where e.record_id = r.id and e.status = 'absent'
             )
       where r.id = any(v_sheets);
    end if;

    -- Room check-ins, except one that would give the person two open
    -- sessions on the same day.
    update public.checkin_sessions s
       set member_id = p_to_member_id
     where s.member_id = p_from_member_id
       and s.church_id = p_church_id
       and not (
         s.status in ('pre_checked_in', 'checked_in')
         and exists (
           select 1
             from public.checkin_sessions t
            where t.member_id = p_to_member_id
              and t.local_service_date = s.local_service_date
              and t.status in ('pre_checked_in', 'checked_in')
         )
       );

    update public.members
       set is_active = false
     where id = p_from_member_id;
  end if;

  update public.visitor_accounts
     set authorization_version = authorization_version + 1,
         updated_at = v_now
   where id = v_link.account_id;

  return v_new_link_id;
end;
$$;

revoke all on function public.move_people_link(uuid, uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.move_people_link(uuid, uuid, uuid, uuid)
  to service_role;

-- ---------------------------------------------------------------------------
-- Every way into `joined` connects the person
-- ---------------------------------------------------------------------------
--
-- A trigger rather than a call from each command, because the commands that
-- can produce `joined` — an open join, staff approval, an accepted invitation,
-- staff opening the app — are several, and the next one added must not be able
-- to forget. Joining never fails because of People: if connecting throws, the
-- person is still joined and the People page lists them as not yet added.

create or replace function public.connect_app_member_on_join()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.state = 'joined'
     and (tg_op = 'INSERT' or old.state is distinct from 'joined') then
    begin
      perform public.connect_app_member(new.account_id, new.church_id, null);
    exception when others then
      raise warning 'connect_app_member(%, %) failed: %',
        new.account_id, new.church_id, sqlerrm;
    end;
  end if;
  return new;
end;
$$;

revoke all on function public.connect_app_member_on_join()
  from public, anon, authenticated;

drop trigger if exists visitor_church_relationships_connect_people
  on public.visitor_church_relationships;
create trigger visitor_church_relationships_connect_people
  after insert or update of state on public.visitor_church_relationships
  for each row execute function public.connect_app_member_on_join();

-- ---------------------------------------------------------------------------
-- One answer to "who came"
-- ---------------------------------------------------------------------------
--
-- `method` is what staff are told:
--   weekly     the weekly attendance sheet
--   automatic  the app, on arrival (geofence)
--   scanned    the app, by scanning the service code
--   kiosk      the check-in kiosk
--   marked     staff, on the Services roster
--   room       a room check-in (children, and the adults serving with them)
--
-- Backfilled 'legacy' facts are copies of weekly-sheet entries and are left
-- out, so nothing is read twice. A weekly-sheet entry whose person was later
-- deleted keeps counting that day, with no member.

create or replace function public.attendance_presence(
  p_church_id uuid,
  p_from date,
  p_to date
)
returns table (member_id uuid, service_date date, method text)
language sql
stable
set search_path = public
as $$
  select e.member_id, r.service_date, 'weekly'::text
    from public.attendance_records r
    join public.attendance_entries e on e.record_id = r.id
   where r.church_id = p_church_id
     and r.service_date between p_from and p_to
     and e.status = 'present'
  union all
  select f.member_id,
         o.local_service_date,
         case f.source
           when 'geofence' then 'automatic'
           when 'qr' then 'scanned'
           when 'kiosk' then 'kiosk'
           else 'marked'
         end
    from public.service_occurrences o
    join public.attendance_facts f on f.service_occurrence_id = o.id
   where o.church_id = p_church_id
     and f.church_id = p_church_id
     and o.local_service_date between p_from and p_to
     and f.status = 'active'
     and f.source <> 'legacy'
  union all
  select s.member_id, s.local_service_date, 'room'::text
    from public.checkin_sessions s
   where s.church_id = p_church_id
     and s.local_service_date between p_from and p_to
     and s.status in ('checked_in', 'checked_out')
$$;

-- Per day: everyone present, counted once. `checked_in` is how many of them
-- were recorded some way other than the weekly sheet, which is what the weekly
-- page shows before anyone has filled the sheet in. `absent` is who the sheet
-- marked absent *and* nothing else recorded — someone the app checked in was
-- not absent, whatever the sheet says. A sheet's own total is a floor, so a
-- sheet saved without its entries is never undercounted.
create or replace function public.attendance_presence_by_date(
  p_church_id uuid,
  p_from date,
  p_to date
)
returns table (
  service_date date,
  present integer,
  absent integer,
  checked_in integer,
  automatic integer,
  has_sheet boolean
)
language sql
stable
set search_path = public
as $$
  with presence as (
    select p.member_id, p.service_date, p.method
      from public.attendance_presence(p_church_id, p_from, p_to) p
  ),
  by_day as (
    select p.service_date,
           (count(distinct p.member_id)
             + count(*) filter (where p.member_id is null))::integer as present,
           (count(distinct p.member_id) filter (where p.method <> 'weekly'))::integer as checked_in,
           (count(distinct p.member_id) filter (where p.method = 'automatic'))::integer as automatic
      from presence p
     group by p.service_date
  ),
  sheets as (
    select r.service_date,
           max(coalesce(r.total_present, 0))::integer as total_present
      from public.attendance_records r
     where r.church_id = p_church_id
       and r.service_date between p_from and p_to
     group by r.service_date
  ),
  absences as (
    select r.service_date, count(distinct e.member_id)::integer as absent
      from public.attendance_records r
      join public.attendance_entries e on e.record_id = r.id
     where r.church_id = p_church_id
       and r.service_date between p_from and p_to
       and e.status = 'absent'
       and e.member_id is not null
       and not exists (
         select 1
           from presence p
          where p.service_date = r.service_date
            and p.member_id = e.member_id
       )
     group by r.service_date
  )
  select coalesce(d.service_date, s.service_date),
         greatest(coalesce(d.present, 0), coalesce(s.total_present, 0)),
         coalesce(a.absent, 0),
         coalesce(d.checked_in, 0),
         coalesce(d.automatic, 0),
         s.service_date is not null
    from by_day d
    full join sheets s on s.service_date = d.service_date
    left join absences a on a.service_date = coalesce(d.service_date, s.service_date)
   order by 1
$$;

-- Per person: how many days they were at church, and the last one.
create or replace function public.attendance_presence_by_member(p_church_id uuid)
returns table (member_id uuid, days_present integer, last_present date)
language sql
stable
set search_path = public
as $$
  select p.member_id,
         count(distinct p.service_date)::integer,
         max(p.service_date)
    from public.attendance_presence(p_church_id, '-infinity'::date, 'infinity'::date) p
   where p.member_id is not null
   group by p.member_id
$$;

revoke all on function public.attendance_presence(uuid, date, date) from public, anon;
revoke all on function public.attendance_presence_by_date(uuid, date, date) from public, anon;
revoke all on function public.attendance_presence_by_member(uuid) from public, anon;
grant execute on function public.attendance_presence(uuid, date, date)
  to authenticated, service_role;
grant execute on function public.attendance_presence_by_date(uuid, date, date)
  to authenticated, service_role;
grant execute on function public.attendance_presence_by_member(uuid)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Everyone who already joined
-- ---------------------------------------------------------------------------
--
-- The trigger only sees future changes. Everyone joined before this migration
-- — including dashboard staff the app admitted — goes through the same
-- decision now. Each call is idempotent, so running this file twice is safe.

do $$
declare
  v_row record;
begin
  for v_row in
    select r.account_id, r.church_id
      from public.visitor_church_relationships r
     where r.state = 'joined'
       and not exists (
         select 1
           from public.visitor_people_links l
          where l.account_id = r.account_id
            and l.church_id = r.church_id
            and l.is_active
       )
  loop
    begin
      perform public.connect_app_member(v_row.account_id, v_row.church_id, null);
    exception when others then
      raise warning 'connect_app_member(%, %) failed: %',
        v_row.account_id, v_row.church_id, sqlerrm;
    end;
  end loop;
end $$;

notify pgrst, 'reload schema';
