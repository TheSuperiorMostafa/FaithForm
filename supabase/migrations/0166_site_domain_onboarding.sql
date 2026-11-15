-- Domain connections are committed before provider calls. Only server workers
-- can read or mutate jobs, lease them, or activate a verified routing row.
CREATE TABLE public.site_domain_jobs (
  domain_id uuid PRIMARY KEY REFERENCES public.site_domains(id) ON DELETE CASCADE,
  operation text NOT NULL DEFAULT 'connect' CHECK (operation IN ('connect', 'disconnect')),
  redirect_to text CHECK (redirect_to IS NULL OR (redirect_to = lower(redirect_to) AND length(redirect_to) BETWEEN 3 AND 253)),
  phase text NOT NULL DEFAULT 'connecting' CHECK (phase IN ('connecting', 'ownership', 'dns', 'https', 'ready', 'attention')),
  records jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(records) = 'array' AND jsonb_array_length(records) <= 16 AND octet_length(records::text) <= 16384),
  verification jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(verification) = 'array' AND jsonb_array_length(verification) <= 16 AND octet_length(verification::text) <= 16384),
  last_error_code text CHECK (last_error_code IS NULL OR last_error_code ~ '^[a-z0-9_]{1,80}$'),
  checked_at timestamptz,
  available_at timestamptz DEFAULT now(),
  lease_token uuid,
  lease_until timestamptz,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  CONSTRAINT site_domain_job_lease_pair CHECK ((lease_token IS NULL) = (lease_until IS NULL))
);
ALTER TABLE public.site_domain_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.site_domain_jobs FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.site_domain_jobs TO service_role;
CREATE INDEX site_domain_jobs_due ON public.site_domain_jobs(available_at, domain_id);
CREATE INDEX site_domain_jobs_family ON public.site_domain_jobs(redirect_to) WHERE redirect_to IS NOT NULL;

CREATE TABLE public.site_domain_setup_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  domain_id uuid REFERENCES public.site_domains(id) ON DELETE SET NULL,
  hostname text NOT NULL CHECK (length(hostname) BETWEEN 3 AND 253),
  church_id uuid NOT NULL REFERENCES public.churches(id) ON DELETE CASCADE,
  event text NOT NULL CHECK (length(event) BETWEEN 1 AND 80),
  code text CHECK (code IS NULL OR code ~ '^[a-z0-9_]{1,80}$'),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.site_domain_setup_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.site_domain_setup_events FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.site_domain_setup_events TO service_role;
CREATE INDEX site_domain_setup_events_church ON public.site_domain_setup_events(church_id, created_at DESC);

-- Preserve routing/publication, but verify every legacy address before showing
-- a successful setup check in the new workflow.
INSERT INTO public.site_domain_jobs(domain_id, phase)
  SELECT id, 'connecting'
  FROM public.site_domains;

CREATE INDEX site_domain_requests_claim_lookup ON public.site_domain_requests(hostname, church_id)
  WHERE status IN ('submitted', 'in_review', 'awaiting_church', 'in_progress');

-- This guard also covers the older registration-request action. All writers
-- serialize on the same hostname before reading claims, including absent rows.
CREATE FUNCTION public.guard_site_domain_request_claim()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF NEW.hostname IS NULL OR NEW.status NOT IN ('submitted', 'in_review', 'awaiting_church', 'in_progress') THEN
    RETURN NEW;
  END IF;
  -- Ordinary progress/notes updates do not acquire claim locks while holding
  -- their request row. The hostname was already reserved when it opened.
  IF TG_OP = 'UPDATE' AND OLD.hostname IS NOT DISTINCT FROM NEW.hostname AND OLD.church_id = NEW.church_id
     AND OLD.status IN ('submitted', 'in_review', 'awaiting_church', 'in_progress') THEN
    RETURN NEW;
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('faithform-domain:' || NEW.hostname, 0));
  PERFORM 1 FROM public.churches WHERE id = NEW.church_id FOR UPDATE;
  IF EXISTS (SELECT 1 FROM public.site_domains d WHERE d.hostname = NEW.hostname AND d.church_id <> NEW.church_id)
     OR EXISTS (SELECT 1 FROM public.site_domain_requests r WHERE r.hostname = NEW.hostname
       AND r.church_id <> NEW.church_id AND r.status IN ('submitted', 'in_review', 'awaiting_church', 'in_progress')) THEN
    RAISE EXCEPTION 'That web address is unavailable.' USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_site_domain_request_claim() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guard_site_domain_request_claim() TO service_role;
CREATE TRIGGER site_domain_request_claim_guard
  BEFORE INSERT OR UPDATE OF hostname, status, church_id ON public.site_domain_requests
  FOR EACH ROW EXECUTE FUNCTION public.guard_site_domain_request_claim();

CREATE FUNCTION public.reserve_site_domain_setup(
  p_church_id uuid,
  p_hostname text,
  p_companion text DEFAULT NULL,
  p_requested_by uuid DEFAULT NULL,
  p_details jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_hostname text;
  v_domain public.site_domains%ROWTYPE;
  v_request public.site_domain_requests%ROWTYPE;
  v_root_id uuid;
  v_ids uuid[] := '{}';
  v_primary boolean;
  v_expected_redirect text;
BEGIN
  -- The application uses the Public Suffix List before calling this RPC. Keep
  -- a separate inexpensive structural check at the database trust boundary.
  IF p_hostname IS NULL OR p_hostname <> lower(p_hostname) OR length(p_hostname) > 253
     OR p_hostname !~ '^[a-z0-9]([a-z0-9.-]*[a-z0-9])?\.[a-z][a-z0-9-]*$'
     OR p_hostname ~ '\.\.' OR p_hostname ~ '(^|\.)-|-(\.|$)'
     OR p_hostname IN ('faithform.io', 'www.faithform.io', 'faithform.app', 'faithform.com', 'vercel.app', 'now.sh')
     OR p_hostname ~ '\.(faithform\.io|faithform\.app|faithform\.com|vercel\.app|now\.sh)$'
     OR (p_companion IS NOT NULL AND (p_companion <> 'www.' || p_hostname OR length(p_companion) > 253)) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_domain');
  END IF;

  IF p_details IS NULL OR jsonb_typeof(p_details) <> 'object' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_details');
  END IF;
  IF octet_length(p_details::text) > 16384
     OR length(coalesce(p_details->>'registrar', '')) > 160
     OR length(coalesce(p_details->>'contact_name', '')) > 120
     OR length(coalesce(p_details->>'contact_email', '')) > 320
     OR length(coalesce(p_details->>'contact_phone', '')) > 80
     OR length(coalesce(p_details->>'notes', '')) > 4000
     OR EXISTS (SELECT 1 FROM jsonb_each(p_details) detail WHERE detail.key IN ('registrar', 'contact_name', 'contact_email', 'contact_phone', 'notes')
       AND jsonb_typeof(detail.value) NOT IN ('string', 'null')) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_details');
  END IF;

  FOR v_hostname IN SELECT name FROM unnest(ARRAY[p_hostname, p_companion]) AS names(name) WHERE name IS NOT NULL ORDER BY name LOOP
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('faithform-domain:' || v_hostname, 0));
  END LOOP;
  PERFORM 1 FROM public.churches WHERE id = p_church_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'church_not_found'); END IF;

  IF EXISTS (SELECT 1 FROM public.site_domains d WHERE d.hostname = ANY(ARRAY[p_hostname, p_companion]) AND d.church_id <> p_church_id)
     OR EXISTS (SELECT 1 FROM public.site_domain_requests r WHERE r.hostname = ANY(ARRAY[p_hostname, p_companion])
       AND r.church_id <> p_church_id AND r.status IN ('submitted', 'in_review', 'awaiting_church', 'in_progress')) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'domain_unavailable');
  END IF;

  SELECT * INTO v_request FROM public.site_domain_requests
    WHERE church_id = p_church_id AND status IN ('submitted', 'in_review', 'awaiting_church', 'in_progress') FOR UPDATE;
  IF FOUND AND (v_request.kind <> 'connect_existing' OR v_request.hostname <> p_hostname) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'request_in_progress');
  END IF;

  IF EXISTS (SELECT 1 FROM public.site_domain_jobs j JOIN public.site_domains d ON d.id = j.domain_id
      WHERE d.hostname = ANY(ARRAY[p_hostname, p_companion]) AND j.operation = 'disconnect') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'disconnect_in_progress');
  END IF;

  -- An existing address being used as another connection's redirect must not
  -- silently become its own canonical site (or change its redirect target).
  IF EXISTS (SELECT 1 FROM public.site_domain_jobs j JOIN public.site_domains d ON d.id = j.domain_id
      WHERE d.church_id = p_church_id AND d.hostname = p_hostname AND j.redirect_to IS NOT NULL)
     OR EXISTS (SELECT 1 FROM public.site_domain_jobs j JOIN public.site_domains d ON d.id = j.domain_id
      WHERE d.church_id = p_church_id AND d.hostname = p_companion AND j.redirect_to IS DISTINCT FROM p_hostname) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'domain_in_use');
  END IF;

  SELECT NOT EXISTS (SELECT 1 FROM public.site_domains WHERE church_id = p_church_id AND is_primary) INTO v_primary;
  FOR v_hostname IN SELECT name FROM unnest(ARRAY[p_hostname, p_companion]) AS names(name) WHERE name IS NOT NULL ORDER BY name LOOP
    SELECT * INTO v_domain FROM public.site_domains WHERE hostname = v_hostname FOR UPDATE;
    IF NOT FOUND THEN
      INSERT INTO public.site_domains(church_id, hostname, is_primary, requested_by)
      VALUES (p_church_id, v_hostname, v_primary AND v_hostname = p_hostname, p_requested_by)
      RETURNING * INTO v_domain;
    END IF;
    v_ids := array_append(v_ids, v_domain.id);
    v_expected_redirect := CASE WHEN v_hostname = p_hostname THEN NULL ELSE p_hostname END;
    INSERT INTO public.site_domain_jobs(domain_id, redirect_to, phase)
    VALUES (v_domain.id, v_expected_redirect, 'connecting')
    ON CONFLICT (domain_id) DO UPDATE SET available_at = CASE
      WHEN public.site_domain_jobs.available_at IS NULL
        AND (public.site_domain_jobs.lease_until IS NULL OR public.site_domain_jobs.lease_until <= clock_timestamp())
        AND (public.site_domain_jobs.checked_at IS NULL OR public.site_domain_jobs.checked_at <= clock_timestamp() - interval '30 seconds')
      THEN clock_timestamp() ELSE public.site_domain_jobs.available_at END;
    IF v_hostname = p_hostname THEN v_root_id := v_domain.id; END IF;
  END LOOP;

  IF v_request.id IS NOT NULL THEN
    UPDATE public.site_domain_requests SET status = 'in_progress', domain_id = v_root_id,
      registrar = coalesce(nullif(btrim(p_details->>'registrar'), ''), registrar),
      contact_name = coalesce(nullif(btrim(p_details->>'contact_name'), ''), contact_name),
      contact_email = coalesce(nullif(btrim(p_details->>'contact_email'), ''), contact_email),
      contact_phone = coalesce(nullif(btrim(p_details->>'contact_phone'), ''), contact_phone),
      notes = coalesce(nullif(btrim(p_details->>'notes'), ''), notes) WHERE id = v_request.id;
  ELSIF NOT EXISTS (SELECT 1 FROM public.site_domain_requests WHERE church_id = p_church_id
      AND kind = 'connect_existing' AND hostname = p_hostname AND status = 'completed') THEN
    INSERT INTO public.site_domain_requests(church_id, requested_by, kind, hostname, status, domain_id, registrar, contact_name, contact_email, contact_phone, notes)
    VALUES (p_church_id, p_requested_by, 'connect_existing', p_hostname, 'in_progress', v_root_id,
      nullif(btrim(p_details->>'registrar'), ''), nullif(btrim(p_details->>'contact_name'), ''),
      nullif(btrim(p_details->>'contact_email'), ''), nullif(btrim(p_details->>'contact_phone'), ''), nullif(btrim(p_details->>'notes'), ''));
  END IF;
  RETURN jsonb_build_object('ok', true, 'domainId', v_root_id, 'domainIds', to_jsonb(v_ids));
EXCEPTION WHEN unique_violation THEN
  -- The exception block rolls back the entire family, including its request.
  RETURN jsonb_build_object('ok', false, 'code', 'domain_unavailable');
END;
$$;
REVOKE ALL ON FUNCTION public.reserve_site_domain_setup(uuid, text, text, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_site_domain_setup(uuid, text, text, uuid, jsonb) TO service_role;

CREATE FUNCTION public.claim_site_domain_jobs(p_limit integer DEFAULT 2, p_domain_id uuid DEFAULT NULL)
RETURNS SETOF public.site_domain_jobs LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$
  WITH candidates AS (
    SELECT j.domain_id FROM public.site_domain_jobs j
    WHERE j.available_at <= clock_timestamp()
      AND (j.lease_until IS NULL OR j.lease_until < clock_timestamp())
      AND (p_domain_id IS NULL OR j.domain_id = p_domain_id)
    ORDER BY j.available_at, j.domain_id
    FOR UPDATE SKIP LOCKED LIMIT greatest(1, least(coalesce(p_limit, 2), 4))
  )
  UPDATE public.site_domain_jobs j SET
    lease_token = gen_random_uuid(), lease_until = clock_timestamp() + interval '2 minutes',
    attempts = least(j.attempts::bigint + 1, 2147483647)::integer
  FROM candidates c WHERE j.domain_id = c.domain_id RETURNING j.*;
$$;
REVOKE ALL ON FUNCTION public.claim_site_domain_jobs(integer, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_site_domain_jobs(integer, uuid) TO service_role;

CREATE FUNCTION public.finish_site_domain_job(
  p_domain_id uuid,
  p_lease_token uuid,
  p_phase text,
  p_records jsonb,
  p_verification jsonb,
  p_error_code text,
  p_next_check_at timestamptz,
  p_activate boolean DEFAULT false
) RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_domain public.site_domains%ROWTYPE;
  v_job public.site_domain_jobs%ROWTYPE;
  v_canonical text;
BEGIN
  IF p_activate AND p_phase <> 'ready' THEN
    RAISE EXCEPTION 'Only a ready connection can be activated.' USING ERRCODE = '22023';
  END IF;
  -- Church -> domain -> job matches primary/removal operations and serializes
  -- family completion. Simultaneous root/www workers must not both observe
  -- the other job's old phase and leave their request open for six hours.
  SELECT * INTO v_domain FROM public.site_domains WHERE id = p_domain_id;
  IF NOT FOUND THEN RETURN false; END IF;
  PERFORM 1 FROM public.churches WHERE id = v_domain.church_id FOR UPDATE;
  SELECT * INTO v_domain FROM public.site_domains WHERE id = p_domain_id FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  SELECT * INTO v_job FROM public.site_domain_jobs WHERE domain_id = p_domain_id
    AND lease_token = p_lease_token AND lease_until > clock_timestamp() FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;

  UPDATE public.site_domain_jobs SET phase = p_phase, records = p_records, verification = p_verification,
    last_error_code = p_error_code, checked_at = clock_timestamp(),
    available_at = CASE WHEN p_next_check_at IS NULL THEN NULL ELSE greatest(p_next_check_at, clock_timestamp() + interval '15 seconds') END,
    lease_token = NULL, lease_until = NULL
  WHERE domain_id = p_domain_id;
  IF p_activate AND v_job.operation <> 'connect' THEN
    RAISE EXCEPTION 'A disconnecting connection cannot be activated.' USING ERRCODE = '22023';
  END IF;
  IF p_activate THEN
    UPDATE public.site_domains SET status = 'live', verified_at = coalesce(verified_at, clock_timestamp()) WHERE id = p_domain_id;
  END IF;
  IF v_job.phase <> p_phase THEN
    INSERT INTO public.site_domain_setup_events(domain_id, hostname, church_id, event, code)
    VALUES (p_domain_id, v_domain.hostname, v_domain.church_id, v_job.phase || ':' || p_phase, p_error_code);
  END IF;

  v_canonical := coalesce(v_job.redirect_to, v_domain.hostname);
  IF p_phase = 'ready' AND v_job.operation = 'connect'
     AND EXISTS (SELECT 1 FROM public.site_domains d JOIN public.site_domain_jobs j ON j.domain_id = d.id
       WHERE d.church_id = v_domain.church_id AND d.hostname = v_canonical AND j.redirect_to IS NULL AND j.phase = 'ready')
     AND NOT EXISTS (SELECT 1 FROM public.site_domains d JOIN public.site_domain_jobs j ON j.domain_id = d.id
       WHERE d.church_id = v_domain.church_id AND (d.hostname = v_canonical OR j.redirect_to = v_canonical) AND j.phase <> 'ready') THEN
    UPDATE public.site_domain_requests SET status = 'completed', handled_at = clock_timestamp()
    WHERE church_id = v_domain.church_id AND kind = 'connect_existing' AND hostname = v_canonical
      AND status IN ('submitted', 'in_review', 'awaiting_church', 'in_progress');
  END IF;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.finish_site_domain_job(uuid, uuid, text, jsonb, jsonb, text, timestamptz, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finish_site_domain_job(uuid, uuid, text, jsonb, jsonb, text, timestamptz, boolean) TO service_role;

-- Stop routing immediately, but retain the hostname claim until provider
-- deletion completes. An old bounded connect request is allowed to expire
-- before a disconnect worker can remove the provider registration.
CREATE FUNCTION public.request_site_domain_disconnect(p_church_id uuid, p_domain_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_selected public.site_domains%ROWTYPE;
  v_selected_job public.site_domain_jobs%ROWTYPE;
  v_domain public.site_domains%ROWTYPE;
  v_hostname text;
  v_names text[];
  v_canonical boolean;
  v_had_primary boolean := false;
BEGIN
  SELECT * INTO v_selected FROM public.site_domains WHERE id = p_domain_id AND church_id = p_church_id;
  IF NOT FOUND THEN RETURN false; END IF;
  SELECT * INTO v_selected_job FROM public.site_domain_jobs WHERE domain_id = p_domain_id;
  v_canonical := v_selected_job.redirect_to IS NULL;
  v_names := CASE WHEN v_canonical THEN ARRAY[v_selected.hostname, 'www.' || v_selected.hostname] ELSE ARRAY[v_selected.hostname] END;
  FOR v_hostname IN SELECT name FROM unnest(v_names) AS names(name) ORDER BY name LOOP
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('faithform-domain:' || v_hostname, 0));
  END LOOP;
  PERFORM 1 FROM public.churches WHERE id = p_church_id FOR UPDATE;
  FOR v_domain IN SELECT d.* FROM public.site_domains d LEFT JOIN public.site_domain_jobs j ON j.domain_id = d.id
    WHERE d.church_id = p_church_id AND (d.id = p_domain_id OR (v_canonical AND j.redirect_to = v_selected.hostname))
    ORDER BY d.hostname FOR UPDATE OF d LOOP
    INSERT INTO public.site_domain_jobs(domain_id) VALUES (v_domain.id) ON CONFLICT DO NOTHING;
    IF EXISTS (SELECT 1 FROM public.site_domain_jobs WHERE domain_id = v_domain.id AND operation <> 'disconnect') THEN
      INSERT INTO public.site_domain_setup_events(domain_id, hostname, church_id, event)
      VALUES (v_domain.id, v_domain.hostname, p_church_id, 'disconnect_requested');
    END IF;
    UPDATE public.site_domain_jobs SET operation = 'disconnect', phase = 'attention',
      available_at = greatest(clock_timestamp(), coalesce(lease_until, clock_timestamp()),
        CASE WHEN last_error_code = 'rate_limited' THEN coalesce(available_at, clock_timestamp()) ELSE clock_timestamp() END,
        coalesce(checked_at + interval '30 seconds', clock_timestamp())),
      lease_token = NULL, lease_until = NULL,
      last_error_code = CASE WHEN operation = 'disconnect' THEN last_error_code ELSE NULL END
    WHERE domain_id = v_domain.id;
    v_had_primary := v_had_primary OR v_domain.is_primary;
    UPDATE public.site_domains SET status = 'failed', verified_at = NULL, is_primary = false WHERE id = v_domain.id;
  END LOOP;
  IF v_canonical THEN
    UPDATE public.site_domain_requests SET status = 'cancelled', handled_at = clock_timestamp()
    WHERE church_id = p_church_id AND kind = 'connect_existing' AND domain_id = v_selected.id
      AND status IN ('submitted', 'in_review', 'awaiting_church', 'in_progress');
  END IF;
  IF v_had_primary THEN
    UPDATE public.site_domains SET is_primary = true WHERE id = (
      SELECT d.id FROM public.site_domains d JOIN public.site_domain_jobs j ON j.domain_id = d.id
      WHERE d.church_id = p_church_id AND d.status = 'live' AND d.verified_at IS NOT NULL
        AND j.phase = 'ready' AND j.operation = 'connect' AND j.redirect_to IS NULL
      ORDER BY d.created_at, d.id LIMIT 1
    );
  END IF;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.request_site_domain_disconnect(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.request_site_domain_disconnect(uuid, uuid) TO service_role;

CREATE FUNCTION public.finish_site_domain_disconnect(p_domain_id uuid, p_lease_token uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_domain public.site_domains%ROWTYPE;
BEGIN
  SELECT * INTO v_domain FROM public.site_domains WHERE id = p_domain_id;
  IF NOT FOUND THEN RETURN false; END IF;
  PERFORM 1 FROM public.churches WHERE id = v_domain.church_id FOR UPDATE;
  SELECT * INTO v_domain FROM public.site_domains WHERE id = p_domain_id FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  PERFORM 1 FROM public.site_domain_jobs WHERE domain_id = p_domain_id AND operation = 'disconnect'
    AND lease_token = p_lease_token AND lease_until > clock_timestamp() FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  INSERT INTO public.site_domain_setup_events(domain_id, hostname, church_id, event)
  VALUES (p_domain_id, v_domain.hostname, v_domain.church_id, 'disconnected');
  DELETE FROM public.site_domains WHERE id = p_domain_id;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.finish_site_domain_disconnect(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finish_site_domain_disconnect(uuid, uuid) TO service_role;

-- Choosing a primary address is one transaction, never a clear/set pair that
-- could leave a church without a primary when the second HTTP request fails.
CREATE FUNCTION public.set_primary_site_domain(p_church_id uuid, p_domain_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  PERFORM 1 FROM public.churches WHERE id = p_church_id FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  PERFORM 1 FROM public.site_domains d JOIN public.site_domain_jobs j ON j.domain_id = d.id
    WHERE d.id = p_domain_id AND d.church_id = p_church_id AND d.status = 'live' AND d.verified_at IS NOT NULL
      AND j.phase = 'ready' AND j.operation = 'connect' AND j.redirect_to IS NULL FOR UPDATE OF d, j;
  IF NOT FOUND THEN RETURN false; END IF;
  UPDATE public.site_domains SET is_primary = false WHERE church_id = p_church_id AND is_primary AND id <> p_domain_id;
  UPDATE public.site_domains SET is_primary = true WHERE church_id = p_church_id AND id = p_domain_id;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.set_primary_site_domain(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_primary_site_domain(uuid, uuid) TO service_role;

-- Manual retry is scoped to the owning church, never steals an active lease,
-- and cannot bypass a recent check or the provider's Retry-After schedule.
CREATE FUNCTION public.request_site_domain_check(p_church_id uuid, p_domain_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_domain public.site_domains%ROWTYPE;
  v_job public.site_domain_jobs%ROWTYPE;
BEGIN
  SELECT * INTO v_domain FROM public.site_domains WHERE id = p_domain_id AND church_id = p_church_id;
  IF NOT FOUND THEN RETURN false; END IF;
  SELECT * INTO v_job FROM public.site_domain_jobs WHERE domain_id = p_domain_id;
  IF NOT FOUND THEN RETURN false; END IF;
  UPDATE public.site_domain_jobs j SET available_at = clock_timestamp()
  FROM public.site_domains d
  WHERE d.id = j.domain_id AND d.church_id = p_church_id
    AND (d.id = p_domain_id OR (v_job.redirect_to IS NULL AND j.redirect_to = v_domain.hostname))
    AND (j.lease_until IS NULL OR j.lease_until <= clock_timestamp())
    AND (j.checked_at IS NULL OR j.checked_at <= clock_timestamp() - interval '30 seconds')
    AND NOT (coalesce(j.last_error_code = 'rate_limited', false) AND coalesce(j.available_at > clock_timestamp(), false));
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.request_site_domain_check(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.request_site_domain_check(uuid, uuid) TO service_role;

NOTIFY pgrst, 'reload schema';
