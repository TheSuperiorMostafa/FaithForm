-- Account deletion that keeps the record of having deleted
-- Migration 0073
--
-- Additive in effect. One foreign key on `visitor_account_requests` changes
-- from CASCADE to SET NULL, its column becomes nullable, and one nullable
-- column is added. No row is written, and no other table changes.
--
-- ## How an account is deleted
--
-- `lib/faithform/account-deletion.ts`, run by the cron at
-- `/api/webhooks/accounts/deletion`, deletes the person's Supabase Auth user.
-- Everything else follows from foreign keys that already exist:
--
--   auth.users            → visitor_accounts                on delete cascade   (0053)
--   visitor_accounts      → relationships, claims, People
--                           links, devices, notification
--                           preferences, detections, scan
--                           redemptions, donor links,
--                           donation attempts               on delete cascade   (0053–0063)
--   visitor_accounts      → attendance attempts, QR
--                           redemptions, People link audit,
--                           invitation acceptances,
--                           children's check-in sessions    on delete set null  (0053–0071)
--
-- That split is the product rule, already written into the schema: CASCADE is
-- what the account owns, SET NULL is a church's record that outlives it. One
-- Auth delete applies the whole split inside one Postgres transaction, and a
-- table added later is handled by the foreign key it declares. A hand-written
-- list of per-table deletes would be a second copy of that rule, and the first
-- migration to forget it would leave personal data behind.
--
-- ## What this migration fixes
--
-- `visitor_account_requests` was on the wrong side of the split. Its CASCADE
-- meant that deleting an account also deleted the request asking for it: no
-- record that anyone asked, when, or whether it was done, and nothing to stop
-- a retry from starting over. /account-deletion tells people we keep "a record
-- that you asked us to delete your account", and a church-facing support
-- question ("was this person's account really deleted?") needs the same row.
--
-- With SET NULL the request row survives with no link to anyone: an id, a
-- kind, a status, three timestamps and an outcome. The account id it loses was
-- the only thing on it that pointed at a person.

-- ---------------------------------------------------------------------------
-- The request outlives the account
-- ---------------------------------------------------------------------------

alter table public.visitor_account_requests
  alter column account_id drop not null;

-- Found by what it references rather than by its generated name, so this runs
-- the same on a database whose constraint was ever renamed, and re-runs clean.
do $$
declare
  existing text;
begin
  for existing in
    select c.conname
      from pg_constraint c
     where c.conrelid = 'public.visitor_account_requests'::regclass
       and c.contype = 'f'
       and c.confrelid = 'public.visitor_accounts'::regclass
  loop
    execute format(
      'alter table public.visitor_account_requests drop constraint %I',
      existing
    );
  end loop;
end $$;

alter table public.visitor_account_requests
  add constraint visitor_account_requests_account_id_fkey
    foreign key (account_id) references public.visitor_accounts (id)
    on delete set null;

-- ---------------------------------------------------------------------------
-- What a completed deletion actually did
-- ---------------------------------------------------------------------------
--
-- `status = 'completed'` says the request is finished, not what finishing
-- meant, and there are three honest answers:
--
--   auth_user_deleted        the sign-in identity (email and password) is
--                            gone, and the account's data with it.
--   staff_account_retained   the account's data is gone, but the same sign-in
--                            is how this person reaches a church dashboard,
--                            so it was kept. Deleting it would lock a church
--                            out of its own FaithForm; see account-deletion.ts.
--   account_already_removed  the account was gone before the job reached it,
--                            for instance deleted by hand in Supabase.
--
-- Server-side only. The mobile contract's request status is unchanged, and no
-- projection selects this column.

alter table public.visitor_account_requests
  add column if not exists outcome text;

alter table public.visitor_account_requests
  drop constraint if exists visitor_account_requests_outcome_check;

alter table public.visitor_account_requests
  add constraint visitor_account_requests_outcome_check
    check (
      outcome is null
      or (
        kind = 'deletion'
        and outcome in (
          'auth_user_deleted',
          'staff_account_retained',
          'account_already_removed'
        )
      )
    );

notify pgrst, 'reload schema';
