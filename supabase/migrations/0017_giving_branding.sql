-- FaithForm: Donor giving page branding (church colors)
-- Migration 0017

alter table public.churches
  add column if not exists giving_primary_color text,
  add column if not exists giving_accent_color text;
