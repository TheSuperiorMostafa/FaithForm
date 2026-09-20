-- Normalized, cropped renditions only. Uploads are authorized by server routes;
-- there is intentionally no anonymous/authenticated storage write policy.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('branding-images', 'branding-images', true, 12582912, array['image/jpeg', 'image/png'])
on conflict (id) do update set public = excluded.public,
  file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- My Groups filters by tenant and active identity, then reads group_id.
-- Existing indexes begin with identity/status but do not cover this tenant lookup.
create index if not exists group_memberships_church_account_active_idx
  on public.group_memberships (church_id, account_id) include (group_id)
  where status = 'active' and account_id is not null;
create index if not exists group_memberships_church_member_active_idx
  on public.group_memberships (church_id, member_id) include (group_id)
  where status = 'active' and member_id is not null;
