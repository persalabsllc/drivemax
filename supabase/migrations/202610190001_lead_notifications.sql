begin;

-- A private outbox: an email outage must never discard an inquiry.
create table public.lead_notifications (
  id uuid primary key references public.messages(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  payload jsonb not null,
  state text not null default 'pending' check (state in ('pending','sending','sent')),
  attempts integer not null default 0,
  claim_token uuid,
  next_attempt_at timestamptz not null default now(),
  locked_at timestamptz,
  provider_id text,
  last_error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index lead_notifications_pending on public.lead_notifications(next_attempt_at)
  where state <> 'sent';
alter table public.lead_notifications enable row level security;
revoke all on public.lead_notifications from anon, authenticated;
grant all on public.lead_notifications to service_role;

create function public.queue_lead_notification() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.direction = 'inbound' then
    insert into public.lead_notifications(id, lead_id, payload)
      select new.id, l.id, jsonb_build_object(
        'leadId', l.id, 'name', l.name, 'email', l.email, 'phone', l.phone,
        'preferredContact', l.preferred_contact, 'kind', l.kind,
        'details', l.details, 'body', new.body, 'subject', new.subject,
        'isReply', new.provider_id is not null
      ) from public.leads l where l.id = new.lead_id
      on conflict (id) do nothing;
  end if;
  return new;
end $$;
create trigger message_notification after insert on public.messages
  for each row execute function public.queue_lead_notification();

-- Claim one at a time so concurrent submissions cannot send the same job.
-- The lease lets a later worker recover after a terminated function.
create function public.claim_lead_notification(requested_lead_id uuid default null)
returns setof public.lead_notifications
language plpgsql security definer set search_path = '' as $$
begin
  return query
    update public.lead_notifications n
    set state = 'sending', claim_token = gen_random_uuid(), locked_at = now(),
      attempts = n.attempts + 1
    where n.id = (
      select q.id from public.lead_notifications q
      where (requested_lead_id is null or q.lead_id = requested_lead_id)
        and ((q.state = 'pending' and q.next_attempt_at <= now())
          or (q.state = 'sending' and q.locked_at < now() - interval '5 minutes'))
      order by q.created_at, q.id
      for update skip locked limit 1
    ) returning n.*;
end $$;
revoke all on function public.queue_lead_notification(), public.claim_lead_notification(uuid)
  from public, anon, authenticated;
grant execute on function public.claim_lead_notification(uuid) to service_role;

-- Existing inquiries stay in the Control Room; do not unexpectedly email the entire history.
notify pgrst, 'reload schema';
commit;
