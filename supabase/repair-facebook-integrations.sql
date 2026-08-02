-- Flags legacy Facebook connections as needing reconnect.
--
-- Rows connected before long-lived tokens landed hold a Page token derived from
-- a short-lived user token: it dies about an hour after connecting, and there is
-- no stored user token to re-derive from. They cannot be healed automatically —
-- only the admin re-authorizing produces a long-lived token — but left alone
-- they are worse than broken: the status RPC reads a non-empty access_token and
-- reports "Connected" right up until a post fails.
--
-- Clearing access_token flips the row to disconnected and the metadata flags
-- make Settings show "Reconnect needed" with a reason. Page id and name survive,
-- so reconnecting does not mean re-picking the Page.
--
-- Unlike scripts/repair-facebook-integrations.mjs, plain SQL cannot call the
-- Graph API, so this does not probe whether a token is still alive — every
-- legacy row is flagged. A connection that still works today is flagged early;
-- it would have lapsed within the hour regardless.
--
-- Run STEP 1 first to see what is affected. Both steps are safe to re-run.

-- ---------------------------------------------------------------------------
-- STEP 1 — inspect (read-only)
-- ---------------------------------------------------------------------------

select
  coalesce(c.name, ci.church_id::text) as church,
  ci.metadata ->> 'page_name'          as facebook_page,
  ci.updated_at                        as connected_or_updated
from public.church_integrations ci
left join public.churches c on c.id = ci.church_id
where ci.provider = 'facebook'
  -- No long-lived user token stored: the pre-fix shape.
  and coalesce(ci.refresh_token, '') = ''
  -- Still claims to be connected.
  and coalesce(ci.access_token, '') <> ''
order by church;

-- ---------------------------------------------------------------------------
-- STEP 2 — apply
-- ---------------------------------------------------------------------------

update public.church_integrations
set
  access_token = '',
  metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
    'needs_reconnect',   true,
    'reconnect_reason',  'Facebook access expired. Reconnect Facebook in Settings.',
    -- Matches JavaScript's toISOString, which is the format the app writes.
    'disconnected_at',   to_char(now() at time zone 'utc',
                                 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  )
where provider = 'facebook'
  and coalesce(refresh_token, '') = ''
  and coalesce(access_token, '') <> ''
returning
  church_id,
  metadata ->> 'page_name' as facebook_page;
