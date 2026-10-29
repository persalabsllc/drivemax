create table public.dmcrm_money_plans (
 id uuid primary key,org_id uuid not null references public.dmcrm_orgs(id),
 expected_lender numeric(12,2) not null check(expected_lender between 0 and 1000000),
 expected_customer numeric(12,2) not null check(expected_customer between 0 and 1000000),
 lender text not null default '' check(length(lender)<=250),lender_due date,customer_due date,notes text not null default '' check(length(notes)<=2000),
 revision integer not null default 1 check(revision>0),updated_at timestamptz not null default now(),updated_by uuid not null,
 foreign key(org_id,id) references public.dmcrm_sales(org_id,id)
);
create table public.dmcrm_money_entries (
 id uuid primary key,org_id uuid not null references public.dmcrm_orgs(id),sale_id uuid not null,
 kind text not null check(kind in('lender','customer')),amount numeric(12,2) not null check(amount>0 and amount<=1000000),
 received_on date not null,method text not null check(method in('ACH','Check','Cash','Card','Wire','Other')),
 reference text not null default '' check(length(reference)<=250),notes text not null default '' check(length(notes)<=2000),
 reversal_of uuid unique references public.dmcrm_money_entries(id),created_at timestamptz not null default now(),created_by uuid not null,
 unique(org_id,id),foreign key(org_id,sale_id) references public.dmcrm_sales(org_id,id)
);
create index on public.dmcrm_money_entries(org_id,sale_id);
create table public.dmcrm_ad_spend (
 id uuid primary key,org_id uuid not null references public.dmcrm_orgs(id),spent_on date not null,
 source text not null check(length(trim(source)) between 1 and 80),amount numeric(12,2) not null check(amount between 0 and 1000000),
 campaign text not null default '' check(length(campaign)<=250),notes text not null default '' check(length(notes)<=2000),
 revision integer not null default 1 check(revision>0),voided_at timestamptz,void_reason text not null default '',
 created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create index on public.dmcrm_ad_spend(org_id,spent_on);
create table public.dmcrm_business_events (
 id uuid primary key,org_id uuid not null references public.dmcrm_orgs(id),subject_id uuid not null,action text not null,
 payload jsonb not null,created_at timestamptz not null default now(),created_by uuid not null
);
create index on public.dmcrm_business_events(org_id,subject_id,created_at);
create function public.dmcrm_business_immutable() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'Financial history cannot be overwritten. Record a correction.';end $$;
create trigger dmcrm_money_immutable before update or delete on public.dmcrm_money_entries for each row execute function public.dmcrm_business_immutable();
create trigger dmcrm_business_events_immutable before update or delete on public.dmcrm_business_events for each row execute function public.dmcrm_business_immutable();
alter table public.dmcrm_money_plans enable row level security;
alter table public.dmcrm_money_entries enable row level security;
alter table public.dmcrm_ad_spend enable row level security;
alter table public.dmcrm_business_events enable row level security;
revoke all on public.dmcrm_money_plans,public.dmcrm_money_entries,public.dmcrm_ad_spend,public.dmcrm_business_events from public,anon,authenticated;
grant all on public.dmcrm_money_plans,public.dmcrm_money_entries,public.dmcrm_ad_spend,public.dmcrm_business_events to service_role;
revoke all on function public.dmcrm_business_immutable() from public,anon,authenticated;

alter function public.dmcrm_command(uuid,uuid,jsonb) rename to dmcrm_command_before_business;
create function public.dmcrm_command(p_org uuid,p_actor uuid,p_command jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare typ text:=p_command->>'type';sid uuid;rid uuid:=(p_command->>'request_id')::uuid;eid uuid;v jsonb;
 s public.dmcrm_sales%rowtype;p public.dmcrm_money_plans%rowtype;e public.dmcrm_money_entries%rowtype;
 ad public.dmcrm_ad_spend%rowtype;event public.dmcrm_business_events%rowtype;today date:=(now() at time zone 'America/New_York')::date;
begin
 if typ not in('save_money_plan','record_money','reverse_money','save_ad_spend','void_ad_spend') then return public.dmcrm_command_before_business(p_org,p_actor,p_command);end if;
 if not exists(select 1 from public.dmcrm_members m join public.dmcrm_staff st on st.org_id=m.org_id and st.user_id=m.user_id
  where m.org_id=p_org and m.user_id=p_actor and m.active and st.active and m.role in('owner','manager')) then raise exception 'Manager access required' using errcode='42501';end if;
 if rid is null then raise exception 'Request key required';end if;
 perform pg_advisory_xact_lock(hashtextextended('dmcrm:business:'||rid::text,0));
 select * into event from public.dmcrm_business_events where id=rid;
 if found then
  if event.org_id=p_org and event.created_by=p_actor and event.payload=p_command then return event.subject_id;end if;
  raise exception 'Use a new request key for changed details.';
 end if;
 if typ in('save_money_plan','record_money','reverse_money') then
  sid:=(p_command->>'sale_id')::uuid;
  select * into s from public.dmcrm_sales where id=sid and org_id=p_org for update;
  if s.id is null then raise exception 'Sale unavailable' using errcode='42501';end if;
  if s.status<>'sold' then raise exception 'Only sold deals can be updated in Money owed.';end if;
  select * into p from public.dmcrm_money_plans where id=sid and org_id=p_org for update;
  if coalesce(p.revision,0) is distinct from (p_command->>'revision')::integer then raise exception 'Money records changed. Refresh before saving.';end if;
  if typ='save_money_plan' then
   v:=p_command->'plan';
   if jsonb_typeof(v->'expected_lender') is distinct from 'number' or jsonb_typeof(v->'expected_customer') is distinct from 'number'
    or (v->>'expected_lender')::numeric not between 0 and 1000000 or (v->>'expected_customer')::numeric not between 0 and 1000000
    or round((v->>'expected_lender')::numeric,2)<>(v->>'expected_lender')::numeric or round((v->>'expected_customer')::numeric,2)<>(v->>'expected_customer')::numeric then raise exception 'Check the expected amounts and payment details.';end if;
   insert into public.dmcrm_money_plans(id,org_id,expected_lender,expected_customer,lender,lender_due,customer_due,notes,updated_by)
    values(sid,p_org,(v->>'expected_lender')::numeric,(v->>'expected_customer')::numeric,coalesce(v->>'lender',''),nullif(v->>'lender_due','')::date,nullif(v->>'customer_due','')::date,coalesce(v->>'notes',''),p_actor)
    on conflict(id) do update set expected_lender=excluded.expected_lender,expected_customer=excluded.expected_customer,lender=excluded.lender,
      lender_due=excluded.lender_due,customer_due=excluded.customer_due,notes=excluded.notes,revision=dmcrm_money_plans.revision+1,updated_at=now(),updated_by=p_actor;
  else
   if p.id is null then raise exception 'Review the expected amounts before recording receipts.';end if;
   if (p_command->>'received_on')::date>today then raise exception 'Receipt and spending dates cannot be in the future.';end if;
   eid:=(p_command->>'id')::uuid;
   if typ='record_money' then
    if jsonb_typeof(p_command->'amount') is distinct from 'number' or round((p_command->>'amount')::numeric,2)<>(p_command->>'amount')::numeric then raise exception 'Check the expected amounts and payment details.';end if;
    insert into public.dmcrm_money_entries(id,org_id,sale_id,kind,amount,received_on,method,reference,notes,created_by)
    values(eid,p_org,sid,p_command->>'kind',(p_command->>'amount')::numeric,(p_command->>'received_on')::date,p_command->>'method',coalesce(p_command->>'reference',''),coalesce(p_command->>'notes',''),p_actor);
   else
    select * into e from public.dmcrm_money_entries where id=(p_command->>'original_id')::uuid and org_id=p_org and sale_id=sid and reversal_of is null;
    if e.id is null then raise exception 'Receipt unavailable.';end if;
    if exists(select 1 from public.dmcrm_money_entries where reversal_of=e.id) then raise exception 'This receipt has already been reversed.';end if;
    if length(trim(coalesce(p_command->>'reason','')))<3 then raise exception 'Enter a correction reason';end if;
    insert into public.dmcrm_money_entries(id,org_id,sale_id,kind,amount,received_on,method,reference,notes,reversal_of,created_by)
    values(eid,p_org,sid,e.kind,e.amount,(p_command->>'received_on')::date,e.method,e.reference,p_command->>'reason',e.id,p_actor);
   end if;
   update public.dmcrm_money_plans set revision=revision+1,updated_at=now(),updated_by=p_actor where id=sid;
  end if;
 else
  sid:=(p_command->>'id')::uuid;
  perform pg_advisory_xact_lock(hashtextextended('dmcrm:ad-spend:'||sid::text,0));
  select * into ad from public.dmcrm_ad_spend where id=sid for update;
  if ad.id is not null and ad.org_id<>p_org then raise exception 'Advertising entry unavailable' using errcode='42501';end if;
  if coalesce(ad.revision,0) is distinct from (p_command->>'revision')::integer then raise exception 'Advertising entry changed. Refresh before saving.';end if;
  if ad.voided_at is not null then raise exception 'This advertising entry was voided.';end if;
  if typ='save_ad_spend' then
   v:=p_command->'spend';
   if (v->>'spent_on')::date>today then raise exception 'Receipt and spending dates cannot be in the future.';end if;
   if jsonb_typeof(v->'amount') is distinct from 'number' or round((v->>'amount')::numeric,2)<>(v->>'amount')::numeric then raise exception 'Check the expected amounts and payment details.';end if;
   insert into public.dmcrm_ad_spend(id,org_id,spent_on,source,amount,campaign,notes)
    values(sid,p_org,(v->>'spent_on')::date,regexp_replace(trim(v->>'source'),'\s+',' ','g'),(v->>'amount')::numeric,coalesce(v->>'campaign',''),coalesce(v->>'notes',''))
    on conflict(id) do update set spent_on=excluded.spent_on,source=excluded.source,amount=excluded.amount,campaign=excluded.campaign,notes=excluded.notes,revision=dmcrm_ad_spend.revision+1,updated_at=now();
  else
   if ad.id is null or length(trim(coalesce(p_command->>'reason','')))<3 then raise exception 'Enter a correction reason';end if;
   update public.dmcrm_ad_spend set voided_at=now(),void_reason=p_command->>'reason',revision=revision+1,updated_at=now() where id=sid;
  end if;
 end if;
 insert into public.dmcrm_business_events(id,org_id,subject_id,action,payload,created_by) values(rid,p_org,sid,typ,p_command,p_actor);
 insert into public.dmcrm_audit(org_id,actor,action,record_id) values(p_org,p_actor,typ,sid);
 return sid;
end $$;
revoke all on function public.dmcrm_command_before_business(uuid,uuid,jsonb),public.dmcrm_command(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.dmcrm_command(uuid,uuid,jsonb) to service_role;
