-- Immutable issued terms, append-only transactions, and server-calculated refunds.
create table public.dmcrm_protection_contracts (
 id uuid primary key, org_id uuid not null references public.dmcrm_orgs(id),
 serial_no bigint generated always as identity unique,
 contract_number text generated always as ('DMP-'||lpad(serial_no::text,greatest(7,length(serial_no::text)),'0')) stored,
 customer_id uuid not null, opportunity_id uuid, quote_id uuid, product_id uuid,
 holder_name text not null check(length(trim(holder_name)) between 1 and 250),co_holder text not null default '' check(length(co_holder)<=250),
 address text not null check(length(trim(address)) between 1 and 250),city text not null check(length(trim(city)) between 1 and 250),state text not null check(state='NC'),zip text not null check(zip ~ '^\d{5}(-\d{4})?$'),
 phone text not null check(length(trim(phone)) between 7 and 250),email text not null default '' check(length(email)<=250),
 vin text not null check(vin ~ '^[A-HJ-NPR-Z0-9]{17}$'),year integer not null check(year between 1900 and 2100),make text not null check(length(trim(make)) between 1 and 250),model text not null check(length(trim(model)) between 1 and 250),stock_number text not null default '' check(length(stock_number)<=250),
 plan text not null check(plan in('deluxe','platinum')),deductible integer not null check(deductible in(0,250,500,1000)),price numeric(12,2) not null check(price>0 and price<=1000000),
 issued_on date not null,start_miles integer not null check(start_miles between 0 and 3000000),term_months integer not null check(term_months between 1 and 120),term_miles integer not null check(term_miles between 1 and 3000000),
 expires_on date not null,expires_miles integer not null,claim_limit numeric(12,2) not null check(claim_limit>0 and claim_limit<=1000000),
 lender text not null default '' check(length(lender)<=250),lender_address text not null default '' check(length(lender_address)<=250),dealer_sold boolean not null check(dealer_sold),
 status text not null default 'active' check(status in('active','canceled')),terms_version text not null,issuer jsonb not null,
 claims_paid numeric(12,2) not null default 0 check(claims_paid>=0 and claims_paid<=claim_limit),cancellation jsonb,
 revision integer not null default 1,created_at timestamptz not null default now(),created_by uuid not null,
 unique(org_id,id),unique(org_id,contract_number),
 foreign key(org_id,customer_id) references public.dmcrm_customers(org_id,id),
 foreign key(org_id,opportunity_id) references public.dmcrm_opportunities(org_id,id),
 check((quote_id is null and product_id is null) or (quote_id is not null and product_id is not null and opportunity_id is not null)),
 check(expires_on=(issued_on+make_interval(months=>term_months))::date and expires_miles=start_miles+term_miles)
);
create unique index dmcrm_one_protection_product on public.dmcrm_protection_contracts(org_id,opportunity_id,product_id) where product_id is not null;
create index on public.dmcrm_protection_contracts(org_id,vin);
create table public.dmcrm_protection_events (
 id uuid primary key, org_id uuid not null, contract_id uuid not null,action text not null,command jsonb not null,result jsonb not null,
 created_by uuid not null,created_at timestamptz not null default now(),foreign key(org_id,contract_id) references public.dmcrm_protection_contracts(org_id,id)
);
create index on public.dmcrm_protection_events(org_id,contract_id,created_at);
create trigger dmcrm_protection_events_immutable before update or delete on public.dmcrm_protection_events for each row execute function public.dmcrm_business_immutable();
create function public.dmcrm_protection_immutable() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='DELETE' or (to_jsonb(new)-array['contract_number','status','claims_paid','cancellation','revision','customer_id']) is distinct from (to_jsonb(old)-array['contract_number','status','claims_paid','cancellation','revision','customer_id']) then raise exception 'Issued contract terms cannot be changed';end if;
 return new;
end $$;
create trigger dmcrm_protection_terms_immutable before update or delete on public.dmcrm_protection_contracts for each row execute function public.dmcrm_protection_immutable();
do $$declare t text;begin foreach t in array array['protection_contracts','protection_events'] loop
 execute format('alter table public.dmcrm_%I enable row level security',t);
 execute format('revoke all on public.dmcrm_%I from public,anon,authenticated',t);
 execute format('grant all on public.dmcrm_%I to service_role',t);
end loop;end $$;
grant usage,select on sequence public.dmcrm_protection_contracts_serial_no_seq to service_role;

create function public.dmcrm_protection_refund(c public.dmcrm_protection_contracts,on_date date,miles integer) returns jsonb language plpgsql immutable set search_path='' as $$
declare elapsed integer:=on_date-c.issued_on;days integer:=c.expires_on-c.issued_on;distance integer:=miles-c.start_miles;tu numeric;mu numeric;prorated numeric;fee numeric;
begin
 if on_date is null or miles is null or elapsed<0 or distance<0 then raise exception 'Contract dates or mileage are invalid.';end if;
 tu:=least(1,elapsed::numeric/days);mu:=least(1,distance::numeric/c.term_miles);
 prorated:=round(c.price*(1-greatest(tu,mu)),2);fee:=round(least(100,prorated*0.1),2);
 return jsonb_build_object('elapsed_days',elapsed,'total_days',days,'miles_used',distance,'time_used',tu,'mileage_used',mu,'used',greatest(tu,mu),'prorated',prorated,'admin_fee',fee,'claims_paid',c.claims_paid,'refund',greatest(0,prorated-fee-c.claims_paid));
end $$;

alter function public.dmcrm_command(uuid,uuid,jsonb) rename to dmcrm_command_before_protection;
create function public.dmcrm_command(p_org uuid,p_actor uuid,p_command jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare typ text:=p_command->>'type';rid uuid:=(p_command->>'request_id')::uuid;sid uuid:=(p_command->>'id')::uuid;
 c public.dmcrm_protection_contracts%rowtype;n public.dmcrm_protection_contracts%rowtype;e public.dmcrm_protection_events%rowtype;q public.dmcrm_quotes%rowtype;o public.dmcrm_opportunities%rowtype;
 v jsonb;product jsonb;val jsonb;latest_id uuid;result uuid;d date;m integer;amt numeric;today date:=(now() at time zone 'America/New_York')::date;
begin
 if typ not in('issue_protection','cancel_protection','record_protection_claim','record_protection_refund') then
  result:=public.dmcrm_command_before_protection(p_org,p_actor,p_command);
  if typ='merge_customers' then update public.dmcrm_protection_contracts set customer_id=(p_command->>'target_id')::uuid,revision=revision+1 where org_id=p_org and customer_id=(p_command->>'source_id')::uuid;end if;
  return result;
 end if;
 if not exists(select 1 from public.dmcrm_members m join public.dmcrm_staff st on st.org_id=m.org_id and st.user_id=m.user_id where m.org_id=p_org and m.user_id=p_actor and m.active and st.active and m.role in('owner','manager')) then raise exception 'Manager access required' using errcode='42501';end if;
 if rid is null or sid is null then raise exception 'Contract details are invalid.';end if;
 perform pg_advisory_xact_lock(hashtextextended('dmcrm:protection:'||p_org::text,0));
 select * into e from public.dmcrm_protection_events where id=rid;
 if found then
  if e.org_id=p_org and e.created_by=p_actor and e.command=p_command then return e.contract_id;end if;
  raise exception 'Use a new request key for changed details.';
 end if;
 select * into c from public.dmcrm_protection_contracts where id=sid for update;
 if c.id is not null and c.org_id<>p_org then raise exception 'Contract unavailable.' using errcode='42501';end if;
 if typ='issue_protection' then
  if c.id is not null then raise exception 'This product already has a contract.';end if;
  v:=p_command->'contract';n:=jsonb_populate_record(null::public.dmcrm_protection_contracts,v);
  if n.customer_id is null or not exists(select 1 from public.dmcrm_customers where org_id=p_org and id=n.customer_id and merged_into is null)
   or (n.opportunity_id is not null and not exists(select 1 from public.dmcrm_opportunities where org_id=p_org and id=n.opportunity_id and customer_id=n.customer_id))
   or n.issued_on is null or n.issued_on>today or coalesce(n.dealer_sold,false)=false then raise exception 'Contract details are invalid.';end if;
  for val in select value from jsonb_each(v) where key in('price','claim_limit','deductible','start_miles','term_months','term_miles','year') loop
   if jsonb_typeof(val) is distinct from 'number' or (val#>>'{}')::numeric<0 or round((val#>>'{}')::numeric,2)<>(val#>>'{}')::numeric then raise exception 'Contract details are invalid.';end if;
  end loop;
  if exists(select 1 from jsonb_each(v) where key in('deductible','start_miles','term_months','term_miles','year') and trunc((value#>>'{}')::numeric)<>(value#>>'{}')::numeric) then raise exception 'Contract details are invalid.';end if;
  if n.quote_id is not null then
   select * into q from public.dmcrm_quotes where org_id=p_org and id=n.quote_id and customer_id=n.customer_id and opportunity_id=n.opportunity_id;
   select * into o from public.dmcrm_opportunities where org_id=p_org and id=n.opportunity_id;
   if o.status='sold' then latest_id:=(o.sale_snapshot#>>'{quote,id}')::uuid;
   else select id into latest_id from public.dmcrm_quotes where org_id=p_org and opportunity_id=n.opportunity_id and inventory_id is not distinct from o.inventory_id and (o.inventory_id is not null or vehicle=o.vehicle_interest) order by created_at desc,id desc limit 1;end if;
   if q.id is null or latest_id is distinct from q.id or o.status='lost' or coalesce(q.values#>>'{fiMenu,selected}','') not in('0','1','2','3') then raise exception 'Save and select the current F&I menu before issuing coverage.';end if;
   perform public.dmcrm_fi_values(q.values);
   select value into product from jsonb_array_elements(q.values->'products') where value->>'id'=n.product_id::text;
   if product is null or product->>'kind' is distinct from 'service_contract' or product->>'protection_plan' is distinct from n.plan
    or (product->>'price')::numeric is distinct from n.price or (product->>'deductible')::numeric is distinct from n.deductible
    or (product->>'term_months')::numeric is distinct from n.term_months or (product->>'mileage_limit')::numeric is distinct from n.term_miles
    or (coalesce(q.vehicle_details->>'vin','')<>'' and q.vehicle_details->>'vin'<>n.vin) then raise exception 'Contract coverage must match the selected product.';end if;
   if exists(select 1 from public.dmcrm_protection_contracts where org_id=p_org and opportunity_id=n.opportunity_id and product_id=n.product_id) then raise exception 'This product already has a contract.';end if;
  end if;
  insert into public.dmcrm_protection_contracts(id,org_id,customer_id,opportunity_id,quote_id,product_id,holder_name,co_holder,address,city,state,zip,phone,email,vin,year,make,model,stock_number,plan,deductible,price,issued_on,start_miles,term_months,term_miles,expires_on,expires_miles,claim_limit,lender,lender_address,dealer_sold,terms_version,issuer,created_by)
  values(sid,p_org,n.customer_id,n.opportunity_id,n.quote_id,n.product_id,n.holder_name,coalesce(n.co_holder,''),n.address,n.city,n.state,n.zip,n.phone,coalesce(n.email,''),n.vin,n.year,n.make,n.model,coalesce(n.stock_number,''),n.plan,n.deductible,n.price,n.issued_on,n.start_miles,n.term_months,n.term_miles,(n.issued_on+make_interval(months=>n.term_months))::date,n.start_miles+n.term_miles,n.claim_limit,coalesce(n.lender,''),coalesce(n.lender_address,''),n.dealer_sold,'DM-VSC-2026-10-v1','{"name":"Drive Max Used Cars LLC","address":"6210 Old US Hwy 70 W, New Bern, NC 28562","phone":"252-541-0040"}',p_actor);
 else
  if c.id is null then raise exception 'Contract unavailable.';end if;
  if c.revision is distinct from (p_command->>'revision')::integer then raise exception 'Contract changed. Refresh before continuing.';end if;
  if typ='record_protection_refund' then
   if c.cancellation is null or c.cancellation->>'paid_on' is not null or (c.cancellation->>'refund')::numeric<=0 then raise exception 'Refund has already been recorded or no refund is due.';end if;
   d:=(p_command->>'paid_on')::date;
   if d is null or d<(c.cancellation->>'canceled_on')::date or d>today or length(trim(coalesce(p_command->>'reference',''))) not between 1 and 250 then raise exception 'Contract dates or mileage are invalid.';end if;
   update public.dmcrm_protection_contracts set cancellation=cancellation||jsonb_build_object('paid_on',d,'payment_reference',p_command->>'reference'),revision=revision+1 where id=sid;
  else
   if c.status='canceled' then raise exception 'Contract is already canceled.';end if;
   if typ='record_protection_claim' then
    d:=(p_command->>'paid_on')::date;amt:=(p_command->>'amount')::numeric;
    if d is null or d<c.issued_on or d>today or amt is null or jsonb_typeof(p_command->'amount') is distinct from 'number' or amt<=0 or amt>1000000 or round(amt,2)<>amt
     or length(trim(coalesce(p_command->>'reference',''))) not between 1 and 250 or length(trim(coalesce(p_command->>'description',''))) not between 3 and 2000 then raise exception 'Contract details are invalid.';end if;
    if c.claims_paid+amt>c.claim_limit then raise exception 'Paid claims exceed the contract benefit limit.';end if;
    update public.dmcrm_protection_contracts set claims_paid=claims_paid+amt,revision=revision+1 where id=sid;
   else
    d:=(p_command->>'canceled_on')::date;m:=(p_command->>'mileage')::integer;
    if d is null or d>today or m is null or m<0 or m>6000000 or jsonb_typeof(p_command->'mileage') is distinct from 'number' or (p_command->>'mileage')::numeric<>m
     or length(trim(coalesce(p_command->>'reason',''))) not between 3 and 250 or length(trim(coalesce(p_command->>'payee',''))) not between 1 and 250 then raise exception 'Contract dates or mileage are invalid.';end if;
    v:=public.dmcrm_protection_refund(c,d,m)||jsonb_build_object('canceled_on',d,'mileage',m,'reason',p_command->>'reason','payee',p_command->>'payee','paid_on',null,'payment_reference','');
    update public.dmcrm_protection_contracts set status='canceled',cancellation=v,revision=revision+1 where id=sid;
   end if;
  end if;
 end if;
 select to_jsonb(pc) into v from public.dmcrm_protection_contracts pc where id=sid;
 insert into public.dmcrm_protection_events(id,org_id,contract_id,action,command,result,created_by) values(rid,p_org,sid,typ,p_command,v,p_actor);
 return sid;
end $$;
revoke all on function public.dmcrm_command_before_protection(uuid,uuid,jsonb),public.dmcrm_protection_immutable(),public.dmcrm_protection_refund(public.dmcrm_protection_contracts,date,integer) from public,anon,authenticated,service_role;
revoke all on function public.dmcrm_command(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.dmcrm_command(uuid,uuid,jsonb) to service_role;
notify pgrst,'reload schema';
