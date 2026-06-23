alter table public.giving_donations
  add column if not exists receipt_email_sent_at timestamptz;
