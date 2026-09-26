-- One-time gifts from the app belong to a donor
-- Migration 0105
--
-- The donor portal signs people in by the address they gave with. Recurring
-- gifts from the app, and every gift on the web, were always recorded against a
-- donor, but a one-time gift from the app was not, so someone who had only ever
-- given once in the app could not sign in. The app now records the donor for
-- every gift; this attaches the ones already given.
--
-- The address is the giving account's own sign-in address, the same one a
-- recurring gift from that account would have used. An account already linked
-- to a donor at a church keeps that donor (link_giving_donor is
-- first-write-wins), so nothing here re-points anyone's history.
--
-- Safe to run more than once: every step only fills what is still empty.

-- 1. A donor for each app giver who has none at that church yet.
insert into public.giving_donors (church_id, email, name, updated_at)
select distinct on (a.church_id, lower(trim(u.email)))
  a.church_id,
  lower(trim(u.email)),
  coalesce(nullif(trim(va.display_name), ''), lower(trim(u.email))),
  now()
from public.giving_donation_attempts a
join public.giving_donations d on d.id = a.donation_id
join public.visitor_accounts va on va.id = a.account_id
join auth.users u on u.id = va.user_id
where a.status = 'succeeded'
  and d.donor_id is null
  and nullif(trim(u.email), '') is not null
  and not exists (
    select 1 from public.giving_donor_links l
     where l.account_id = a.account_id
       and l.church_id = a.church_id
       and l.revoked_at is null
  )
on conflict (church_id, email) do nothing;

-- 2. Link each of those accounts to its donor (first link wins).
insert into public.giving_donor_links (account_id, church_id, donor_id)
select distinct a.account_id, a.church_id, gd.id
from public.giving_donation_attempts a
join public.giving_donations d on d.id = a.donation_id
join public.visitor_accounts va on va.id = a.account_id
join auth.users u on u.id = va.user_id
join public.giving_donors gd
  on gd.church_id = a.church_id
 and gd.email = lower(trim(u.email))
where a.status = 'succeeded'
  and d.donor_id is null
on conflict (account_id, church_id) do nothing;

-- 3. Attach the gifts to the account's donor.
update public.giving_donations d
   set donor_id = l.donor_id,
       donor_email = coalesce(d.donor_email, gd.email),
       updated_at = now()
  from public.giving_donation_attempts a
  join public.giving_donor_links l
    on l.account_id = a.account_id
   and l.church_id = a.church_id
   and l.revoked_at is null
  join public.giving_donors gd on gd.id = l.donor_id
 where a.donation_id = d.id
   and a.church_id = d.church_id
   and a.status = 'succeeded'
   and d.donor_id is null;
