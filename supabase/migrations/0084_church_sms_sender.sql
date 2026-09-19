-- FaithForm: each church texts from its own phone
-- Migration 0084
--
-- Attendance follow-up texts went out through one server-wide SMS credential
-- (`SMS_MOBILE_API_KEY`, or `TWILIO_*`). SMSMobileAPI sends from whichever
-- handset its app is installed on, so every church's members were texted from
-- one pastor's phone, and their replies went back to that phone.
--
-- A church's texting phone is now its own connection on `church_integrations`
-- (provider 'sms'): the gateway key in `access_token`, the sending number in
-- `metadata.from_number`. Service-role only, like every other credential on
-- that table (migration 0050). The server-wide credential is only used for the
-- one church named by `SMS_ENV_CHURCH_ID`.

alter table public.church_integrations
  drop constraint if exists church_integrations_provider_check;

alter table public.church_integrations
  add constraint church_integrations_provider_check
  check (provider in ('google', 'facebook', 'stream', 'youtube', 'apple', 'retell', 'sms'));

notify pgrst, 'reload schema';
