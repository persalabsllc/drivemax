-- Draft-only rollout: no rate schedule is activated by this migration.
create table public.dmcrm_product_pricing (
 id uuid primary key references public.dmcrm_orgs(id), org_id uuid not null unique references public.dmcrm_orgs(id),
 draft jsonb not null, active jsonb, revision integer not null, active_revision integer,
 updated_at timestamptz not null default now(), updated_by uuid not null,
 check(id=org_id), check(revision>0), check((active is null)=(active_revision is null))
);
create table public.dmcrm_pricing_events (
 id uuid primary key, org_id uuid not null references public.dmcrm_orgs(id), command jsonb not null,
 created_by uuid not null, created_at timestamptz not null default now()
);
create table public.dmcrm_protection_fund_entries (
 id uuid primary key, org_id uuid not null references public.dmcrm_orgs(id), direction text not null check(direction in('in','out')),
 amount numeric(12,2) not null check(amount>0 and amount<=1000000), posted_on date not null,
 reference text not null check(length(trim(reference)) between 1 and 270), notes text not null default '' check(length(notes)<=1000),
 contract_id uuid, reversal_of uuid unique references public.dmcrm_protection_fund_entries(id),
 created_by uuid not null, created_at timestamptz not null default now(),
 foreign key(org_id,contract_id) references public.dmcrm_protection_contracts(org_id,id)
);
create index on public.dmcrm_protection_fund_entries(org_id,posted_on);
create trigger dmcrm_pricing_events_immutable before update or delete on public.dmcrm_pricing_events for each row execute function public.dmcrm_business_immutable();
create trigger dmcrm_fund_entries_immutable before update or delete on public.dmcrm_protection_fund_entries for each row execute function public.dmcrm_business_immutable();
do $$ declare t text; begin foreach t in array array['product_pricing','pricing_events','protection_fund_entries'] loop
 execute format('alter table public.dmcrm_%I enable row level security',t);
 execute format('revoke all on public.dmcrm_%I from public,anon,authenticated',t);
 execute format('grant all on public.dmcrm_%I to service_role',t);
end loop; end $$;
alter table public.dmcrm_protection_contracts add column internal_cost numeric(12,2) check(internal_cost>=0 and internal_cost<=1000000), add column pricing_snapshot jsonb;

create function public.dmcrm_check_pricing(c jsonb) returns void language plpgsql immutable set search_path='' as $$
declare plan text;r jsonb;k text;n numeric;
begin
 if jsonb_typeof(c) is distinct from 'object' or jsonb_typeof(c->'rates') is distinct from 'object'
  or length(trim(coalesce(c->>'account_name',''))) not between 1 and 100 then raise exception 'Review the product pricing settings.';end if;
 foreach k in array array['annual_miles','maintenance_interval','reserve_percent'] loop
  if jsonb_typeof(c->k) is distinct from 'number' then raise exception 'Review the product pricing settings.';end if;
  n:=(c->>k)::numeric;
  if (k='annual_miles' and (n not between 1000 and 100000 or trunc(n)<>n))
   or (k='maintenance_interval' and (n not between 1000 and 20000 or trunc(n)<>n))
   or (k='reserve_percent' and (n not between 0 and 100 or round(n,2)<>n)) then raise exception 'Review the product pricing settings.';end if;
 end loop;
 foreach plan in array array['deluxe','platinum','maintenance','tire_wheel','pdr','appearance','key_replacement'] loop
  r:=c->'rates'->plan;
  if jsonb_typeof(r) is distinct from 'object' or jsonb_typeof(r->'amount') is distinct from 'number'
   or r->>'basis' is null or (plan='maintenance' and r->>'basis'<>'visit')
   or (plan='appearance' and r->>'basis'<>'flat')
   or (plan not in('maintenance','appearance') and r->>'basis' not in('annual','annual_mileage')) then raise exception 'Review the product pricing settings.';end if;
  n:=(r->>'amount')::numeric;
  if n not between 0 and 1000000 or round(n,2)<>n then raise exception 'Review the product pricing settings.';end if;
 end loop;
end $$;
create function public.dmcrm_protection_cost(p jsonb,c jsonb,rev integer) returns jsonb language plpgsql immutable set search_path='' as $$
declare plan text:=p->>'protection_plan';r jsonb:=c->'rates'->plan;units numeric;scheduled numeric;floor_cost numeric;
begin
 if r is null or coalesce((p->>'term_months')::numeric,0)<=0 then return null;end if;
 units:=case r->>'basis' when 'flat' then 1 when 'visit' then (p->>'maintenance_visits')::numeric
  when 'annual_mileage' then greatest((p->>'term_months')::numeric/12,case when coalesce((p->>'unlimited_miles')::boolean,false) then 0 else (p->>'mileage_limit')::numeric/(c->>'annual_miles')::numeric end)
  else (p->>'term_months')::numeric/12 end;
 if units is null or units<=0 then return null;end if;
 scheduled:=round(units*(r->>'amount')::numeric,2);floor_cost:=round((p->>'price')::numeric*(c->>'reserve_percent')::numeric/100,2);
 if greatest(scheduled,floor_cost)>1000000 then raise exception 'Review the product pricing settings.';end if;
 return jsonb_build_object('revision',rev,'plan',plan,'basis',r->>'basis','rate',(r->>'amount')::numeric,'units',round(units,6),'scheduled_cost',scheduled,'reserve_floor',floor_cost,'cost',greatest(scheduled,floor_cost));
end $$;
create function public.dmcrm_quote_product_pricing() returns trigger language plpgsql security definer set search_path='' as $$
declare settings public.dmcrm_product_pricing%rowtype;p jsonb;expected jsonb;c public.dmcrm_protection_contracts%rowtype;source jsonb;
begin
 perform pg_advisory_xact_lock(hashtextextended('dmcrm:pricing:'||new.org_id::text,0));
 select * into settings from public.dmcrm_product_pricing where org_id=new.org_id;
 if settings.active is null then return new;end if;
 for p in select value from jsonb_array_elements(coalesce(new.values->'products','[]'::jsonb)||coalesce(new.values#>'{fiMenu,products}','[]'::jsonb)) loop
  if p->>'protection_plan' is null then continue;end if;
  select * into c from public.dmcrm_protection_contracts where org_id=new.org_id and opportunity_id=new.opportunity_id and product_id=(p->>'id')::uuid;
  if found then
   select product into source from public.dmcrm_quotes q cross join lateral jsonb_array_elements(q.values->'products') product where q.org_id=new.org_id and q.id=c.quote_id and product->>'id'=c.product_id::text;
   if p->'cost' is distinct from coalesce(to_jsonb(c.internal_cost),source->'cost','null'::jsonb) or coalesce(p->'pricing_snapshot','null'::jsonb) is distinct from coalesce(c.pricing_snapshot,source->'pricing_snapshot','null'::jsonb) then
    raise exception 'Product pricing changed. Reopen the product selector and save the updated costs.';
   end if;
   continue;
  end if;
  expected:=public.dmcrm_protection_cost(p,settings.active,settings.active_revision);
  if expected is null or p->'pricing_snapshot' is distinct from expected or p->'cost' is distinct from expected->'cost' then
   raise exception 'Product pricing changed. Reopen the product selector and save the updated costs.';
  end if;
 end loop;
 return new;
end $$;
create trigger dmcrm_quote_product_pricing before insert on public.dmcrm_quotes for each row execute function public.dmcrm_quote_product_pricing();
create function public.dmcrm_contract_product_cost() returns trigger language plpgsql security definer set search_path='' as $$
declare p jsonb;s public.dmcrm_product_pricing%rowtype;
begin
 perform pg_advisory_xact_lock(hashtextextended('dmcrm:pricing:'||new.org_id::text,0));
 if new.quote_id is not null then
  select product into p from public.dmcrm_quotes q cross join lateral jsonb_array_elements(q.values->'products') product
   where q.org_id=new.org_id and q.id=new.quote_id and product->>'id'=new.product_id::text;
  new.internal_cost:=(p->>'cost')::numeric;new.pricing_snapshot:=p->'pricing_snapshot';
 else
  select * into s from public.dmcrm_product_pricing where org_id=new.org_id;
  if s.active is not null then
   new.pricing_snapshot:=public.dmcrm_protection_cost(jsonb_build_object('protection_plan',new.plan,'term_months',new.term_months,'mileage_limit',new.term_miles,'unlimited_miles',new.term_miles is null,'maintenance_visits',new.maintenance_visits,'price',new.price),s.active,s.active_revision);
   new.internal_cost:=(new.pricing_snapshot->>'cost')::numeric;
  else new.internal_cost:=null;new.pricing_snapshot:=null;end if;
 end if;
 return new;
end $$;
create trigger dmcrm_contract_product_cost before insert on public.dmcrm_protection_contracts for each row execute function public.dmcrm_contract_product_cost();

alter function public.dmcrm_command(uuid,uuid,jsonb) rename to dmcrm_command_before_product_pricing;
create function public.dmcrm_command(p_org uuid,p_actor uuid,p_command jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare typ text:=p_command->>'type';rid uuid:=(p_command->>'request_id')::uuid;s public.dmcrm_product_pricing%rowtype;
 prior public.dmcrm_pricing_events%rowtype;e public.dmcrm_protection_fund_entries%rowtype;role_name text;result uuid;
 c public.dmcrm_protection_contracts%rowtype;d date;amount numeric;rev integer;config jsonb;
begin
 if typ not in('save_product_pricing','activate_product_pricing','pause_product_pricing','record_protection_fund','reverse_protection_fund') then
  result:=public.dmcrm_command_before_product_pricing(p_org,p_actor,p_command);
  -- Only explicitly marked payments are recorded against this account. A CRM claim alone is not a bank withdrawal.
  if typ in('record_protection_claim','record_protection_refund') and p_command->'paid_from_fund'='true'::jsonb then
   select * into c from public.dmcrm_protection_contracts where org_id=p_org and id=result;
   amount:=case when typ='record_protection_claim' then (p_command->>'amount')::numeric else (c.cancellation->>'refund')::numeric end;
   insert into public.dmcrm_protection_fund_entries(id,org_id,direction,amount,posted_on,reference,notes,contract_id,created_by)
    values(rid,p_org,'out',amount,(p_command->>'paid_on')::date,p_command->>'reference',case when typ='record_protection_claim' then 'Paid protection claim' else 'Paid cancellation refund' end,c.id,p_actor) on conflict(id) do nothing;
   if not exists(select 1 from public.dmcrm_protection_fund_entries fe where fe.id=rid and fe.org_id=p_org and fe.direction='out' and fe.contract_id=c.id and fe.created_by=p_actor and fe.amount=case when typ='record_protection_claim' then (p_command->>'amount')::numeric else (c.cancellation->>'refund')::numeric end and posted_on=(p_command->>'paid_on')::date and reference=p_command->>'reference' and reversal_of is null) then raise exception 'Use a new request key for changed details.';end if;
  end if;
  return result;
 end if;
 select m.role into role_name from public.dmcrm_members m join public.dmcrm_staff st on st.org_id=m.org_id and st.user_id=m.user_id
  where m.org_id=p_org and m.user_id=p_actor and m.active and st.active;
 if role_name is null or role_name not in('owner','manager') then raise exception 'Manager access required' using errcode='42501';end if;
 if rid is null then raise exception 'Use a new request key for changed details.';end if;
 perform pg_advisory_xact_lock(hashtextextended('dmcrm:pricing:'||p_org::text,0));
 select * into prior from public.dmcrm_pricing_events where id=rid;
 if found then
  if prior.org_id=p_org and prior.created_by=p_actor and prior.command=p_command then return rid;end if;
  raise exception 'Use a new request key for changed details.';
 end if;
 if typ in('save_product_pricing','activate_product_pricing','pause_product_pricing') then
  select * into s from public.dmcrm_product_pricing where org_id=p_org for update;
  rev:=(p_command->>'revision')::integer;
  if rev is null or rev<>coalesce(s.revision,0) then raise exception 'Pricing settings changed. Refresh and review the current draft.';end if;
  if typ='save_product_pricing' then
   config:=p_command->'config';perform public.dmcrm_check_pricing(config);
   insert into public.dmcrm_product_pricing(id,org_id,draft,revision,updated_by) values(p_org,p_org,config,rev+1,p_actor)
    on conflict(id) do update set draft=excluded.draft,revision=excluded.revision,updated_by=p_actor,updated_at=now();
  else
   if role_name<>'owner' or s.id is null or (typ='activate_product_pricing' and p_command->'approved' is distinct from 'true'::jsonb) then raise exception 'Owner approval is required to activate product pricing.';end if;
   perform public.dmcrm_check_pricing(s.draft);
   update public.dmcrm_product_pricing set active=case when typ='activate_product_pricing' then draft else null end,
    active_revision=case when typ='activate_product_pricing' then rev+1 else null end,revision=rev+1,updated_at=now(),updated_by=p_actor where id=p_org;
  end if;
 else
  d:=(p_command->>'posted_on')::date;
  if d is null or d>(now() at time zone 'America/New_York')::date then raise exception 'Enter a valid fund transaction.';end if;
  if typ='record_protection_fund' then
   amount:=(p_command->>'amount')::numeric;
   if jsonb_typeof(p_command->'amount') is distinct from 'number' or amount not between 0.01 and 1000000 or round(amount,2)<>amount
    or p_command->>'direction' is null or p_command->>'direction' not in('in','out') or length(trim(coalesce(p_command->>'reference',''))) not between 1 and 150
    or length(coalesce(p_command->>'notes',''))>1000 then raise exception 'Enter a valid fund transaction.';end if;
   if p_command->>'contract_id' is not null and not exists(select 1 from public.dmcrm_protection_contracts where org_id=p_org and id=(p_command->>'contract_id')::uuid) then raise exception 'Fund entry unavailable.';end if;
   insert into public.dmcrm_protection_fund_entries(id,org_id,direction,amount,posted_on,reference,notes,contract_id,created_by)
    values(rid,p_org,p_command->>'direction',amount,d,trim(p_command->>'reference'),coalesce(p_command->>'notes',''),(p_command->>'contract_id')::uuid,p_actor);
  else
   select * into e from public.dmcrm_protection_fund_entries where org_id=p_org and id=(p_command->>'id')::uuid;
   if e.id is null or e.reversal_of is not null then raise exception 'Fund entry unavailable.';end if;
   if exists(select 1 from public.dmcrm_protection_fund_entries where reversal_of=e.id) then raise exception 'This fund entry has already been reversed.';end if;
   if d<e.posted_on or length(trim(coalesce(p_command->>'reason',''))) not between 3 and 1000 then raise exception 'Enter a valid fund transaction.';end if;
   insert into public.dmcrm_protection_fund_entries(id,org_id,direction,amount,posted_on,reference,notes,contract_id,reversal_of,created_by)
    values(rid,p_org,case when e.direction='in' then 'out' else 'in' end,e.amount,d,'Reversal: '||e.reference,p_command->>'reason',e.contract_id,e.id,p_actor);
  end if;
 end if;
 insert into public.dmcrm_pricing_events(id,org_id,command,created_by) values(rid,p_org,p_command,p_actor);
 return rid;
end $$;
revoke all on function public.dmcrm_command_before_product_pricing(uuid,uuid,jsonb),public.dmcrm_check_pricing(jsonb),public.dmcrm_protection_cost(jsonb,jsonb,integer),public.dmcrm_quote_product_pricing(),public.dmcrm_contract_product_cost() from public,anon,authenticated,service_role;
revoke all on function public.dmcrm_command(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.dmcrm_command(uuid,uuid,jsonb) to service_role;
