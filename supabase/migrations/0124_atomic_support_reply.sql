-- A church reply must not remain on a resolved ticket if the status update
-- fails. Lock the ticket and write the comment/status in one transaction.
create or replace function public.reply_to_support_ticket(
  p_ticket_id uuid,
  p_church_id uuid,
  p_author_user_id uuid,
  p_author_name text,
  p_body text
)
returns text
language plpgsql
volatile
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_ticket public.support_tickets%rowtype;
  v_body text := trim(p_body);
begin
  if p_ticket_id is null or p_church_id is null or p_author_user_id is null then
    raise exception 'Missing support reply identifier' using errcode = '22023';
  end if;
  if v_body is null or v_body = '' or length(v_body) > 4000 then
    raise exception 'Invalid support reply body' using errcode = '22023';
  end if;

  select * into v_ticket
  from public.support_tickets
  where id = p_ticket_id and church_id = p_church_id
  for update;
  if not found then
    raise exception 'Support ticket not found' using errcode = 'P0002';
  end if;

  insert into public.support_ticket_comments
    (ticket_id, church_id, author_role, author_user_id, author_name, body)
  values
    (p_ticket_id, p_church_id, 'church', p_author_user_id, p_author_name, v_body);

  update public.support_tickets set
    status = case when status = 'resolved' then 'open' else status end,
    updated_at = now()
  where id = p_ticket_id and church_id = p_church_id;
  if not found then
    raise exception 'Support ticket changed' using errcode = 'P0002';
  end if;

  return v_ticket.subject;
end;
$$;

revoke all on function public.reply_to_support_ticket(uuid, uuid, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.reply_to_support_ticket(uuid, uuid, uuid, text, text)
  to service_role;
