-- A ticket and its delivery job commit together. Customer-visible ticket rows
-- contain no integration secrets, error details, or delivery bookkeeping.
CREATE TABLE public.support_notion_outbox (
  ticket_id uuid PRIMARY KEY REFERENCES public.support_tickets(id) ON DELETE CASCADE,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  available_at timestamptz NOT NULL DEFAULT now(),
  lease_token uuid,
  lease_until timestamptz,
  delivered_at timestamptz,
  last_error_code text
);

ALTER TABLE public.support_notion_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.support_notion_outbox FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.support_notion_outbox TO service_role;

CREATE INDEX support_notion_outbox_pending
  ON public.support_notion_outbox (available_at, ticket_id)
  WHERE delivered_at IS NULL;

CREATE FUNCTION public.enqueue_support_notion_ticket()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  INSERT INTO public.support_notion_outbox(ticket_id) VALUES (NEW.id)
    ON CONFLICT (ticket_id) DO NOTHING;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.enqueue_support_notion_ticket() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_support_notion_ticket() TO service_role;

CREATE TRIGGER support_ticket_notion_enqueue
  AFTER INSERT ON public.support_tickets
  FOR EACH ROW EXECUTE FUNCTION public.enqueue_support_notion_ticket();

INSERT INTO public.support_notion_outbox(ticket_id)
  SELECT id FROM public.support_tickets ON CONFLICT (ticket_id) DO NOTHING;

-- Called only by server workers. A crashed worker becomes retryable after its
-- lease; a slow/stuck ticket is moved behind other work by retry backoff.
CREATE FUNCTION public.claim_support_notion_ticket(p_ticket_id uuid DEFAULT NULL)
RETURNS TABLE(ticket_id uuid, lease_token uuid, attempts integer)
LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$
  WITH candidate AS (
    SELECT q.ticket_id FROM public.support_notion_outbox q
    WHERE q.delivered_at IS NULL
      AND q.available_at <= now()
      AND (q.lease_until IS NULL OR q.lease_until < now())
      AND (p_ticket_id IS NULL OR q.ticket_id = p_ticket_id)
    ORDER BY q.available_at, q.ticket_id
    FOR UPDATE SKIP LOCKED LIMIT 1
  )
  UPDATE public.support_notion_outbox q SET
    lease_token = gen_random_uuid(),
    lease_until = now() + interval '2 minutes',
    attempts = q.attempts + 1
  FROM candidate c WHERE q.ticket_id = c.ticket_id
  RETURNING q.ticket_id, q.lease_token, q.attempts;
$$;
REVOKE ALL ON FUNCTION public.claim_support_notion_ticket(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_support_notion_ticket(uuid) TO service_role;
