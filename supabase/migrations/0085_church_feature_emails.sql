-- FaithForm: switch a feature's email off without switching the feature off
-- Migration 0085
--
-- A platform admin can already turn a feature off for a church
-- (`church_features.enabled`). This adds a second, narrower switch on the same
-- row: whether that feature may send email for the church — giving receipts
-- and failed-payment notices, website contact-form notices, the weekly
-- announcement email.
--
-- Additive and defaulted on, so nothing changes until an admin flips it, and a
-- missing row still means "never changed", which means on.

alter table public.church_features
  add column if not exists emails_enabled boolean not null default true;

notify pgrst, 'reload schema';
