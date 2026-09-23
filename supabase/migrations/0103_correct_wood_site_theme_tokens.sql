-- FaithForm: align the Wood site format with the Cornerstone reference CSS.
-- Migration 0103

update public.site_themes
set tokens = jsonb_set(tokens, '{--site-ink}', '"#2E2018"'::jsonb),
    description = 'Warm and traditional. Walnut, parchment and aged gold with stately Cinzel headings, Spectral accents, and squared architectural details.',
    updated_at = now()
where key = 'wood';
