-- Claims are a lifecycle record; payment remains the existing, audited contract
-- transaction. Backfilling tracking rows never replays a payment or fund entry.
create table public.dmcrm_protection_claims (
 id uuid primary key, org_id uuid not null references public.dmcrm_orgs(id), contract_id uuid not null,
 serial_no bigint generated always as identity,
 claim_number text generated always as ('DMC-'||lpad(serial_no::text,7,'0')) stored unique,
 status text not null check(status in('open','paid','closed')),
 submitted_on date not null, service_on date, mileage integer check(mileage between 0 and 6000000),
 units integer not null check(units between 1 and 2), description text not null check(length(trim(description)) between 3 and 2000),
 repairer text not null default '' check(length(repairer)<=250), requested_amount numeric(12,2) check(requested_amount>0 and requested_amount<=1000000),
 paid_on date, amount numeric(12,2) check(amount>0 and amount<=1000000), payment_reference text not null default '',
 paid_from_fund boolean not null default false, payment_event_id uuid unique references public.dmcrm_protection_events(id),
 closed_on date, closure_reason text not null default '' check(length(closure_reason)<=1000), revision integer not null default 1 check(revision>0),
 created_at timestamptz not null default now(), created_by uuid not null, updated_at timestamptz not null default now(), updated_by uuid not null,
 unique(org_id,id), foreign key(org_id,contract_id) references public.dmcrm_protection_contracts(org_id,id),
 check((status='paid' and paid_on is not null and amount is not null and payment_event_id is not null and length(trim(payment_reference)) between 1 and 250)
    or(status<>'paid' and paid_on is null and amount is null and payment_event_id is null and payment_reference='' and not paid_from_fund)),
 check((status='closed' and closed_on is not null and closed_on>=submitted_on and length(trim(closure_reason))>=3)
    or(status<>'closed' and closed_on is null and closure_reason='')),
 check(status='paid' or(service_on is not null and mileage is not null)),
 check(paid_on is null or paid_on>=submitted_on)
);
create index on public.dmcrm_protection_claims(org_id,status,paid_on);
create index on public.dmcrm_protection_claims(org_id,contract_id);
create table public.dmcrm_protection_claim_events (
 id uuid primary key, org_id uuid not null references public.dmcrm_orgs(id), claim_id uuid not null,
 command jsonb not null, result jsonb not null, created_by uuid not null, created_at timestamptz not null default now(),
 foreign key(org_id,claim_id) references public.dmcrm_protection_claims(org_id,id)
);
create index on public.dmcrm_protection_claim_events(org_id,claim_id);
create trigger dmcrm_claim_events_immutable before update or delete on public.dmcrm_protection_claim_events for each row execute function public.dmcrm_business_immutable();
create function public.dmcrm_claim_immutable() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='DELETE' then raise exception 'Claim history cannot be deleted.';end if;
 if old.status<>'open' or (to_jsonb(new)-array['claim_number','status','submitted_on','service_on','mileage','units','description','repairer','requested_amount','paid_on','amount','payment_reference','paid_from_fund','payment_event_id','closed_on','closure_reason','revision','updated_at','updated_by'])
   is distinct from (to_jsonb(old)-array['claim_number','status','submitted_on','service_on','mileage','units','description','repairer','requested_amount','paid_on','amount','payment_reference','paid_from_fund','payment_event_id','closed_on','closure_reason','revision','updated_at','updated_by']) then
  raise exception 'Paid or closed claim history cannot be changed.';
 end if;
 return new;
end $$;
create trigger dmcrm_claim_immutable before update or delete on public.dmcrm_protection_claims for each row execute function public.dmcrm_claim_immutable();
do $$ declare t text; begin foreach t in array array['protection_claims','protection_claim_events'] loop
 execute format('alter table public.dmcrm_%I enable row level security',t);
 execute format('revoke all on public.dmcrm_%I from public,anon,authenticated',t);
 execute format('grant all on public.dmcrm_%I to service_role',t);
end loop;end $$;

create function public.dmcrm_track_paid_protection(p_event uuid) returns void language sql security definer set search_path='' as $$
 insert into public.dmcrm_protection_claims(id,org_id,contract_id,status,submitted_on,service_on,mileage,units,description,paid_on,amount,payment_reference,paid_from_fund,payment_event_id,created_at,created_by,updated_at,updated_by)
 select e.id,e.org_id,e.contract_id,'paid',(e.command->>'paid_on')::date,(e.command->>'service_on')::date,(e.command->>'mileage')::integer,coalesce((e.command->>'units')::integer,1),e.command->>'description',
 (e.command->>'paid_on')::date,(e.command->>'amount')::numeric,e.command->>'reference',coalesce((e.command->>'paid_from_fund')::boolean,false),e.id,e.created_at,e.created_by,e.created_at,e.created_by
 from public.dmcrm_protection_events e where e.action='record_protection_claim' and (p_event is null or e.id=p_event)
 order by e.created_at,e.id on conflict(payment_event_id) do nothing;
$$;
select public.dmcrm_track_paid_protection(null);

alter function public.dmcrm_command(uuid,uuid,jsonb) rename to dmcrm_command_before_claim_tracking;
create function public.dmcrm_command(p_org uuid,p_actor uuid,p_command jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare typ text:=p_command->>'type';rid uuid:=(p_command->>'request_id')::uuid;sid uuid:=(p_command->>'id')::uuid;
 c public.dmcrm_protection_contracts%rowtype;cl public.dmcrm_protection_claims%rowtype;e public.dmcrm_protection_claim_events%rowtype;
 d jsonb;submitted date;service_date date;m numeric;qty numeric;requested numeric;dt date;v jsonb;result uuid;
 today date:=(now() at time zone 'America/New_York')::date;
begin
 if typ not in('submit_protection_claim','update_protection_claim','pay_protection_claim','close_protection_claim') then
  result:=public.dmcrm_command_before_claim_tracking(p_org,p_actor,p_command);
  if typ='record_protection_claim' then perform public.dmcrm_track_paid_protection(rid);end if;
  return result;
 end if;
 if not exists(select 1 from public.dmcrm_members m join public.dmcrm_staff st on st.org_id=m.org_id and st.user_id=m.user_id
  where m.org_id=p_org and m.user_id=p_actor and m.active and st.active and m.role in('owner','manager')) then raise exception 'Manager access required' using errcode='42501';end if;
 if rid is null or sid is null then raise exception 'Claim details are invalid.';end if;
 perform pg_advisory_xact_lock(hashtextextended('dmcrm:protection:'||p_org::text,0));
 select * into e from public.dmcrm_protection_claim_events where id=rid;
 if found then
  if e.org_id=p_org and e.created_by=p_actor and e.command=p_command then return e.claim_id;end if;
  raise exception 'Use a new request key for changed details.';
 end if;
 if exists(select 1 from public.dmcrm_protection_events where id=rid) then raise exception 'Use a new request key for changed details.';end if;
 select * into cl from public.dmcrm_protection_claims where org_id=p_org and id=sid for update;
 if typ='submit_protection_claim' then
  if cl.id is not null then raise exception 'This claim already exists.';end if;
  select * into c from public.dmcrm_protection_contracts where org_id=p_org and id=(p_command->>'contract_id')::uuid for update;
  if c.id is null then raise exception 'Contract unavailable.';end if;
  if c.status='canceled' then raise exception 'Contract is already canceled.';end if;
 else
  if cl.id is null then raise exception 'Claim unavailable.';end if;
  if jsonb_typeof(p_command->'revision') is distinct from 'number' or cl.revision::numeric is distinct from (p_command->>'revision')::numeric then raise exception 'Claim changed. Refresh before continuing.';end if;
  if cl.status<>'open' then raise exception 'This claim is already paid or closed.';end if;
  select * into c from public.dmcrm_protection_contracts where org_id=p_org and id=cl.contract_id for update;
 end if;
 if typ in('submit_protection_claim','update_protection_claim') then
  d:=p_command->'details';submitted:=(d->>'submitted_on')::date;service_date:=(d->>'service_on')::date;
  m:=(d->>'mileage')::numeric;qty:=(d->>'units')::numeric;requested:=(d->>'requested_amount')::numeric;
  if jsonb_typeof(d) is distinct from 'object' or submitted is null or service_date is null or submitted<c.issued_on or submitted>today
   or service_date<c.issued_on or service_date>submitted or m is null or m<c.start_miles or m>6000000 or trunc(m)<>m
   or qty is null or qty not between 1 and 2 or trunc(qty)<>qty or (c.plan<>'key_replacement' and qty<>1)
   or jsonb_typeof(d->'mileage') is distinct from 'number' or jsonb_typeof(d->'units') is distinct from 'number' then raise exception 'Claim dates, mileage or quantity are invalid.';end if;
  if length(trim(coalesce(d->>'description',''))) not between 3 and 2000 or jsonb_typeof(d->'description') is distinct from 'string'
   or jsonb_typeof(d->'repairer') is distinct from 'string' or length(d->>'repairer')>250
   or (d->'requested_amount' is distinct from 'null'::jsonb and (jsonb_typeof(d->'requested_amount') is distinct from 'number' or requested<=0 or requested>1000000 or round(requested,2)<>requested)) then raise exception 'Claim details are invalid.';end if;
  if typ='submit_protection_claim' then
   insert into public.dmcrm_protection_claims(id,org_id,contract_id,status,submitted_on,service_on,mileage,units,description,repairer,requested_amount,created_by,updated_by)
   values(sid,p_org,c.id,'open',submitted,service_date,m::integer,qty::integer,trim(d->>'description'),trim(d->>'repairer'),requested,p_actor,p_actor);
  else
   update public.dmcrm_protection_claims set submitted_on=submitted,service_on=service_date,mileage=m::integer,units=qty::integer,description=trim(d->>'description'),repairer=trim(d->>'repairer'),requested_amount=requested,revision=revision+1,updated_at=now(),updated_by=p_actor where id=sid;
  end if;
 elsif typ='close_protection_claim' then
  dt:=(p_command->>'closed_on')::date;
  if dt is null or dt<cl.submitted_on or dt>today then raise exception 'Claim dates, mileage or quantity are invalid.';end if;
  if length(trim(coalesce(p_command->>'reason',''))) not between 3 and 1000 then raise exception 'Claim details are invalid.';end if;
  update public.dmcrm_protection_claims set status='closed',closed_on=dt,closure_reason=trim(p_command->>'reason'),revision=revision+1,updated_at=now(),updated_by=p_actor where id=sid;
 else
  dt:=(p_command->>'paid_on')::date;
  if dt is null or dt<cl.submitted_on then raise exception 'Payment cannot precede claim submission.';end if;
  if jsonb_typeof(p_command->'contract_revision') is distinct from 'number' or c.revision::numeric is distinct from (p_command->>'contract_revision')::numeric then raise exception 'Contract changed. Refresh before continuing.';end if;
  if jsonb_typeof(p_command->'paid_from_fund') is distinct from 'boolean' then raise exception 'Claim details are invalid.';end if;
  -- Reuse all existing benefit, key/maintenance, duplicate reference, audit and fund checks.
  perform public.dmcrm_command_before_claim_tracking(p_org,p_actor,jsonb_build_object(
    'type','record_protection_claim','request_id',rid,'id',c.id,'revision',c.revision,
    'amount',p_command->'amount','paid_on',dt,'reference',p_command->>'reference','description',cl.description,
    'service_on',cl.service_on,'mileage',cl.mileage,'units',cl.units,'paid_from_fund',p_command->'paid_from_fund'));
  update public.dmcrm_protection_claims set status='paid',paid_on=dt,amount=(p_command->>'amount')::numeric,payment_reference=p_command->>'reference',
   paid_from_fund=(p_command->>'paid_from_fund')::boolean,payment_event_id=rid,revision=revision+1,updated_at=now(),updated_by=p_actor where id=sid;
 end if;
 select to_jsonb(x) into v from public.dmcrm_protection_claims x where id=sid;
 insert into public.dmcrm_protection_claim_events(id,org_id,claim_id,command,result,created_by) values(rid,p_org,sid,p_command,v,p_actor);
 return sid;
end $$;
revoke all on function public.dmcrm_command_before_claim_tracking(uuid,uuid,jsonb),public.dmcrm_track_paid_protection(uuid),public.dmcrm_claim_immutable() from public,anon,authenticated,service_role;
revoke all on function public.dmcrm_command(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.dmcrm_command(uuid,uuid,jsonb) to service_role;
notify pgrst,'reload schema';
