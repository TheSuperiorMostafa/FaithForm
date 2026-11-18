-- Updates 1.6.12: a home address and gender on each person in People.
-- Both are optional directory fields, edited through the same church-scoped
-- People server actions as name, phone, email and status. Existing people
-- stay blank until church staff fills them in.
alter table public.members
  add column if not exists address text,
  add column if not exists gender text
  constraint members_gender_check check (gender is null or gender in ('male', 'female'));
