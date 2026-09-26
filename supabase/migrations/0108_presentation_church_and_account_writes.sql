-- Migration 0108
--
-- Additive and data-safe. No existing row is read, changed or removed: one
-- trigger that checks new writes, and one table whose direct writes are
-- withdrawn from signed-in API callers.
--
-- ## 1. A slide version belongs to its sermon's church
--
-- 0078's insert policy checks only that the new row's own `church_id` is one
-- of the caller's churches. Nothing ties `sermon_id` to that church, and
-- versions are unique per `(sermon_id, version)`. So a staff member of one
-- church could insert versions 1..N for another church's sermon under their
-- own church id — rows the other church can neither see nor delete — and every
-- publish of that sermon's slides would then fail on the unique key. The
-- server's own writes always name the sermon's church, so they are unaffected.
--
-- ## 2. An app account's security columns are the server's
--
-- 0053 granted signed-in callers UPDATE on every column of their own
-- `visitor_accounts` row. That let a person reset `authorization_version` —
-- the counter that sign-out and relationship changes bump to revoke playback
-- and other capabilities — and so revive what was revoked, or move their own
-- `status` off `deactivated` or `deletion_requested`. Every write the product
-- makes goes through the service role (lib/faithform/account.ts and its
-- callers), and neither phone app reads or writes this table directly, so
-- nothing the product does loses a path. Reading one's own row is unchanged.

create or replace function public.check_presentation_version_church()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.sermons s
     where s.id = new.sermon_id
       and s.church_id = new.church_id
  ) then
    raise exception 'sermon belongs to another church' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists sermon_presentation_versions_church_check
  on public.sermon_presentation_versions;
create trigger sermon_presentation_versions_church_check
  before insert or update of sermon_id, church_id on public.sermon_presentation_versions
  for each row execute function public.check_presentation_version_church();

revoke insert, update, delete, truncate on table public.visitor_accounts from anon, authenticated;
