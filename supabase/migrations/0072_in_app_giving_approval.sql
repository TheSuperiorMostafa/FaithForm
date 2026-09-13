-- In-app Apple Pay giving, approved one church at a time
-- Migration 0072
--
-- Additive. Two columns on `churches`, one check constraint, one trigger. No
-- existing row changes meaning: every church starts unapproved, which is the
-- state every church is already in on iPhone today.
--
-- ## Why this exists
--
-- Apple's App Review Guideline 3.2.1(vi) lets a third-party app take a donation
-- without In-App Purchase on exactly two conditions: the gift is paid with
-- Apple Pay, and the organisation *receiving* it is one Apple has approved as a
-- nonprofit. In the US that approval rides on the organisation's Candid Seal of
-- Transparency. FaithForm is not the recipient — every gift is a direct charge
-- on the church's own Stripe account — so the approval is per church, and a
-- church without it has to be sent to its web give page in Safari instead.
--
-- Android has no such rule, so nothing on Android reads this.
--
-- ## Why a church cannot set it
--
-- The flag is an attestation that *we* checked the church's Seal. A church
-- flipping it on for itself would put FaithForm's App Store listing on the line
-- for a claim nobody verified, so it is written by a platform admin through the
-- control center (service role) and by nothing a church holds.
--
-- That needs more than "no policy mentions it". `churches_update` (0038) lets a
-- church admin update their own church row through PostgREST, and Postgres
-- column privileges cannot narrow that: `authenticated` holds table-level
-- UPDATE, and a column-level REVOKE is a no-op underneath a table-level grant.
-- So the guard is a trigger that refuses any change to these two columns from
-- the browser-facing roles, whatever policy let the statement in.

alter table public.churches
  add column if not exists apple_pay_donations_approved boolean not null default false;

-- When the approval was granted. Null while unapproved; cleared on revocation
-- rather than kept, because "approved since" is the only question it answers
-- and a stale date next to a revoked flag reads as still approved.
alter table public.churches
  add column if not exists apple_pay_donations_approved_at timestamptz;

-- The pair is one fact. An approval with no date is a row somebody edited by
-- hand, and a date with no approval is a revocation that forgot half its job.
alter table public.churches
  drop constraint if exists churches_apple_pay_donations_approval_stamped;

alter table public.churches
  add constraint churches_apple_pay_donations_approval_stamped
    check (apple_pay_donations_approved = (apple_pay_donations_approved_at is not null));

/*
 * Refuses a church-side change to the approval.
 *
 * Deliberately NOT `security definer`: `current_user` has to be the role that
 * ran the statement. PostgREST switches to `anon` or `authenticated` for a
 * browser's request and to `service_role` for the server's, so the browser
 * roles are the ones named here and everything else — the control center's
 * service-role write, the SQL editor, a migration — passes untouched.
 *
 * `is distinct from` rather than "was mentioned": a client that writes the whole
 * row back with the values it read is not trying to change the approval, and
 * failing its unrelated profile save would be a bug.
 */
create or replace function public.guard_apple_pay_donations_approval()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.apple_pay_donations_approved
       or new.apple_pay_donations_approved_at is not null then
      raise exception 'apple_pay_donations_approved is set by FaithForm, not by a church'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if new.apple_pay_donations_approved is distinct from old.apple_pay_donations_approved
     or new.apple_pay_donations_approved_at is distinct from old.apple_pay_donations_approved_at then
    raise exception 'apple_pay_donations_approved is set by FaithForm, not by a church'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists churches_guard_apple_pay_donations_approval on public.churches;
create trigger churches_guard_apple_pay_donations_approval
  before insert or update on public.churches
  for each row execute function public.guard_apple_pay_donations_approval();
