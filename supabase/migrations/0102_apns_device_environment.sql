-- APNs tokens from Xcode builds use development, even against our production
-- API. Keep that distinct from the backend's environment and account partition.
alter table public.visitor_device_installations
  add column if not exists apns_environment text
    check (apns_environment in ('development', 'production'));

notify pgrst, 'reload schema';
