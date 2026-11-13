-- Narrowing only: church website changes now use authenticated server actions.
-- Direct table writes could attach a section/override to another church's
-- page, or inject raw HTML via an override of the trusted custom_embed type.
-- Media and inbox writes also belong to their validated server actions. In
-- particular, a browser must not rewrite a visitor's message or set arbitrary
-- sermon URLs. TRUNCATE bypasses RLS, so remove it along with the other write
-- privileges inherited from Supabase's default grants. No rows are changed.
-- Service-role access and the existing active-theme catalogue are unchanged.
revoke insert, update, delete, truncate, references, trigger on table public.site_settings from anon, authenticated;
revoke insert, update, delete, truncate, references, trigger on table public.site_pages from anon, authenticated;
revoke insert, update, delete, truncate, references, trigger on table public.site_sections from anon, authenticated;
revoke insert, update, delete, truncate, references, trigger on table public.site_overrides from anon, authenticated;
revoke insert, update, delete, truncate, references, trigger on table public.site_media from anon, authenticated;
revoke insert, update, delete, truncate, references, trigger on table public.site_contact_submissions from anon, authenticated;
revoke insert, update, delete, truncate, references, trigger on table public.site_domains from anon, authenticated;
revoke insert, update, delete, truncate, references, trigger on table public.site_domain_requests from anon, authenticated;
revoke insert, update, delete, truncate, references, trigger on table public.site_themes from anon, authenticated;

-- Membership alone never grants Website access. These legacy policies let a
-- teammate without the Website grant read draft copy, contact recipients and
-- visitor enquiries through PostgREST even though the dashboard refused them.
-- The established helper checks membership, the explicit grant/admin role and
-- the church-level feature switch. This only narrows the old membership rule;
-- public rendering still uses the service role with explicit field allowlists.
alter policy site_settings_select on public.site_settings
  using (public.user_has_feature(church_id, 'website'));
alter policy site_pages_select on public.site_pages
  using (public.user_has_feature(church_id, 'website'));
alter policy site_sections_select on public.site_sections
  using (public.user_has_feature(church_id, 'website'));
alter policy site_overrides_select on public.site_overrides
  using (public.user_has_feature(church_id, 'website'));
alter policy site_media_select on public.site_media
  using (public.user_has_feature(church_id, 'website'));
alter policy site_contact_submissions_select on public.site_contact_submissions
  using (public.user_has_feature(church_id, 'website'));
alter policy site_domains_select on public.site_domains
  using (public.user_has_feature(church_id, 'website'));
alter policy site_domain_requests_select on public.site_domain_requests
  using (public.user_has_feature(church_id, 'website'));
