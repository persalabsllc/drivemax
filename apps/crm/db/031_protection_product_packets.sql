-- Extend the immutable contract register without changing any issued VSC edition.
alter table public.dmcrm_protection_contracts
  drop constraint dmcrm_protection_contracts_plan_check,
  add constraint dmcrm_protection_contracts_plan_check check(plan in('deluxe','platinum','maintenance','tire_wheel','pdr','appearance','key_replacement')),
  alter column term_miles drop not null,
  alter column expires_miles drop not null,
  alter column claim_limit drop not null,
  add column maintenance_visits integer check(maintenance_visits between 1 and 100),
  add column batch_id uuid,
  add constraint dmcrm_protection_program_limits check(
    (plan in('deluxe','platinum') and term_miles is not null and claim_limit is not null and maintenance_visits is null)
    or (plan='maintenance' and deductible=0 and maintenance_visits is not null and claim_limit is not null and claim_limit=maintenance_visits*125)
    or (plan in('tire_wheel','pdr','key_replacement') and deductible=0 and maintenance_visits is null and claim_limit is null)
    or (plan='appearance' and deductible=0 and term_months=96 and term_miles is null and maintenance_visits is null and claim_limit is null)
  ),
  add constraint dmcrm_protection_mileage_pair check((term_miles is null)=(expires_miles is null));
create index on public.dmcrm_protection_contracts(org_id,batch_id);

create or replace function public.dmcrm_protection_refund(c public.dmcrm_protection_contracts,on_date date,miles integer) returns jsonb language plpgsql immutable set search_path='' as $$
declare elapsed integer:=on_date-c.issued_on;days integer:=c.expires_on-c.issued_on;distance integer:=miles-c.start_miles;tu numeric;mu numeric;prorated numeric;fee numeric;
begin
 if on_date is null or miles is null or elapsed<0 or distance<0 then raise exception 'Contract dates or mileage are invalid.';end if;
 tu:=least(1,elapsed::numeric/days);mu:=case when c.term_miles is null then 0 else least(1,distance::numeric/c.term_miles) end;
 prorated:=round(c.price*(1-greatest(tu,mu)),2);fee:=round(least(100,prorated*0.1),2);
 return jsonb_build_object('elapsed_days',elapsed,'total_days',days,'miles_used',distance,'time_used',tu,'mileage_used',mu,'used',greatest(tu,mu),'prorated',prorated,'admin_fee',fee,'claims_paid',c.claims_paid,'refund',greatest(0,prorated-fee-c.claims_paid));
end $$;

alter function public.dmcrm_command(uuid,uuid,jsonb) rename to dmcrm_command_before_product_packets;
create function public.dmcrm_command(p_org uuid,p_actor uuid,p_command jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare typ text:=p_command->>'type';rid uuid:=(p_command->>'request_id')::uuid;sid uuid:=(p_command->>'id')::uuid;
 c public.dmcrm_protection_contracts%rowtype;n public.dmcrm_protection_contracts%rowtype;e public.dmcrm_protection_events%rowtype;q public.dmcrm_quotes%rowtype;o public.dmcrm_opportunities%rowtype;
 v jsonb;product jsonb;val jsonb;latest_id uuid;item jsonb;first_contract jsonb;common_fields jsonb;contract_ids uuid[];selected_ids uuid[];received_ids uuid[];service_date date;units integer;used_units integer;key_overflow boolean;result uuid;d date;m integer;amt numeric;today date:=(now() at time zone 'America/New_York')::date;
begin
 if typ not in('issue_protection_batch','issue_protection','cancel_protection','record_protection_claim','record_protection_refund') then
  return public.dmcrm_command_before_product_packets(p_org,p_actor,p_command);
 end if;
 if not exists(select 1 from public.dmcrm_members m join public.dmcrm_staff st on st.org_id=m.org_id and st.user_id=m.user_id where m.org_id=p_org and m.user_id=p_actor and m.active and st.active and m.role in('owner','manager')) then raise exception 'Manager access required' using errcode='42501';end if;
 if rid is null or sid is null then raise exception 'Contract details are invalid.';end if;
 perform pg_advisory_xact_lock(hashtextextended('dmcrm:protection:'||p_org::text,0));
 select * into e from public.dmcrm_protection_events where id=rid;
 if found then
  if e.org_id=p_org and e.created_by=p_actor and e.command=p_command then return case when typ='issue_protection_batch' then (e.result->>'batch_id')::uuid else e.contract_id end;end if;
  raise exception 'Use a new request key for changed details.';
 end if;
 if typ='issue_protection_batch' then
  if jsonb_typeof(p_command->'contracts') is distinct from 'array' or jsonb_array_length(p_command->'contracts') not between 1 and 30 or rid=sid then raise exception 'Contract details are invalid.';end if;
  if exists(select 1 from public.dmcrm_protection_contracts where batch_id=sid) then raise exception 'This product already has a contract.';end if;
  first_contract:=p_command#>'{contracts,0,contract}';
  common_fields:=first_contract-array['plan','deductible','price','term_months','term_miles','claim_limit','maintenance_visits','product_id'];
  select array_agg((value->>'id')::uuid),array_agg((value#>>'{contract,product_id}')::uuid order by value#>>'{contract,product_id}') into contract_ids,received_ids from jsonb_array_elements(p_command->'contracts');
  if (select count(*)<>count(distinct value) from unnest(contract_ids) value) or sid=any(contract_ids) or rid=any(contract_ids) or array_position(contract_ids,null) is not null
   or exists(select 1 from jsonb_array_elements(p_command->'contracts') x where ((x->'contract')-array['plan','deductible','price','term_months','term_miles','claim_limit','maintenance_visits','product_id']) is distinct from common_fields)
  then raise exception 'A contract packet must use one customer, vehicle and issue date, with unique contract IDs.';end if;
  if first_contract->>'quote_id' is not null then
   select * into q from public.dmcrm_quotes where org_id=p_org and id=(first_contract->>'quote_id')::uuid;
   select array_agg((p->>'id')::uuid order by p->>'id') into selected_ids from jsonb_array_elements(q.values->'products') p
    where p->>'protection_plan' is not null and not exists(select 1 from public.dmcrm_protection_contracts pc where pc.org_id=p_org and pc.opportunity_id=q.opportunity_id and pc.product_id=(p->>'id')::uuid);
   if selected_ids is distinct from received_ids then raise exception 'Contract all remaining selected Drive Max products together.';end if;
   if exists(select 1 from jsonb_array_elements(q.values->'products') p join public.dmcrm_protection_contracts pc on pc.org_id=p_org and pc.opportunity_id=q.opportunity_id and pc.product_id=(p->>'id')::uuid
    where p->>'protection_plan' is not null and (p->>'protection_plan' is distinct from pc.plan or (p->>'price')::numeric is distinct from pc.price or (p->>'deductible')::integer is distinct from pc.deductible
     or (p->>'term_months')::integer is distinct from pc.term_months or (case when (p->>'unlimited_miles')::boolean then null else (p->>'mileage_limit')::integer end) is distinct from pc.term_miles
     or (p->>'maintenance_visits')::integer is distinct from pc.maintenance_visits or (p->>'claim_limit' is not null and (p->>'claim_limit')::numeric is distinct from pc.claim_limit))) then
    raise exception 'Selected coverage differs from an issued contract. Restore the menu to the issued terms or use a new product for replacement coverage.';end if;
  end if;
  for item in select value from jsonb_array_elements(p_command->'contracts') loop
   perform public.dmcrm_command(p_org,p_actor,jsonb_build_object('type','issue_protection','id',item->'id','request_id',item->'id','contract',item->'contract','batch_id',sid));
  end loop;
  insert into public.dmcrm_protection_events(id,org_id,contract_id,action,command,result,created_by)
   values(rid,p_org,contract_ids[1],typ,p_command,jsonb_build_object('batch_id',sid,'contract_ids',contract_ids),p_actor);
  return sid;
 end if;
 select * into c from public.dmcrm_protection_contracts where id=sid for update;
 if c.id is not null and c.org_id<>p_org then raise exception 'Contract unavailable.' using errcode='42501';end if;
 if typ='issue_protection' then
  if c.id is not null then raise exception 'This product already has a contract.';end if;
  v:=p_command->'contract';n:=jsonb_populate_record(null::public.dmcrm_protection_contracts,v);
  if n.customer_id is null or not exists(select 1 from public.dmcrm_customers where org_id=p_org and id=n.customer_id and merged_into is null)
   or (n.opportunity_id is not null and not exists(select 1 from public.dmcrm_opportunities where org_id=p_org and id=n.opportunity_id and customer_id=n.customer_id))
   or n.issued_on is null or n.issued_on>today or coalesce(n.dealer_sold,false)=false then raise exception 'Contract details are invalid.';end if;
  for val in select value from jsonb_each(v) where key in('price','claim_limit','deductible','start_miles','term_months','term_miles','year','maintenance_visits') and value<>'null'::jsonb loop
   if jsonb_typeof(val) is distinct from 'number' or (val#>>'{}')::numeric<0 or round((val#>>'{}')::numeric,2)<>(val#>>'{}')::numeric then raise exception 'Contract details are invalid.';end if;
  end loop;
  if exists(select 1 from jsonb_each(v) where key in('deductible','start_miles','term_months','term_miles','year','maintenance_visits') and value<>'null'::jsonb and trunc((value#>>'{}')::numeric)<>(value#>>'{}')::numeric) then raise exception 'Contract details are invalid.';end if;
  if n.quote_id is not null then
   select * into q from public.dmcrm_quotes where org_id=p_org and id=n.quote_id and customer_id=n.customer_id and opportunity_id=n.opportunity_id;
   select * into o from public.dmcrm_opportunities where org_id=p_org and id=n.opportunity_id;
   if o.status='sold' then latest_id:=(o.sale_snapshot#>>'{quote,id}')::uuid;
   else select id into latest_id from public.dmcrm_quotes where org_id=p_org and opportunity_id=n.opportunity_id and inventory_id is not distinct from o.inventory_id and (o.inventory_id is not null or vehicle=o.vehicle_interest) order by created_at desc,id desc limit 1;end if;
   if q.id is null or latest_id is distinct from q.id or o.status='lost' or coalesce(q.values#>>'{fiMenu,selected}','') not in('0','1','2','3') then raise exception 'Save and select the current F&I menu before issuing coverage.';end if;
   perform public.dmcrm_fi_values(q.values);
   select value into product from jsonb_array_elements(q.values->'products') where value->>'id'=n.product_id::text;
   if product is null or product->>'kind' is distinct from (case when n.plan in('deluxe','platinum') then 'service_contract' else n.plan end) or product->>'protection_plan' is distinct from n.plan
    or (product->>'price')::numeric is distinct from n.price or (product->>'deductible')::numeric is distinct from n.deductible
    or (product->>'term_months')::numeric is distinct from n.term_months or (case when (product->>'unlimited_miles')::boolean then null else (product->>'mileage_limit')::numeric end) is distinct from n.term_miles
    or (product->>'maintenance_visits')::numeric is distinct from n.maintenance_visits or (product->>'claim_limit' is not null and (product->>'claim_limit')::numeric is distinct from n.claim_limit)
    or (coalesce(q.vehicle_details->>'vin','')<>'' and q.vehicle_details->>'vin'<>n.vin) then raise exception 'Contract coverage must match the selected product.';end if;
   if exists(select 1 from public.dmcrm_protection_contracts where org_id=p_org and opportunity_id=n.opportunity_id and product_id=n.product_id) then raise exception 'This product already has a contract.';end if;
  end if;
  insert into public.dmcrm_protection_contracts(id,org_id,customer_id,opportunity_id,quote_id,product_id,holder_name,co_holder,address,city,state,zip,phone,email,vin,year,make,model,stock_number,plan,deductible,price,issued_on,start_miles,term_months,term_miles,expires_on,expires_miles,claim_limit,lender,lender_address,dealer_sold,terms_version,issuer,created_by,maintenance_visits,batch_id)
  values(sid,p_org,n.customer_id,n.opportunity_id,n.quote_id,n.product_id,n.holder_name,coalesce(n.co_holder,''),n.address,n.city,n.state,n.zip,n.phone,coalesce(n.email,''),n.vin,n.year,n.make,n.model,coalesce(n.stock_number,''),n.plan,n.deductible,n.price,n.issued_on,n.start_miles,n.term_months,n.term_miles,(n.issued_on+make_interval(months=>n.term_months))::date,n.start_miles+n.term_miles,n.claim_limit,coalesce(n.lender,''),coalesce(n.lender_address,''),n.dealer_sold,case when n.plan in('deluxe','platinum') then 'DM-VSC-2026-10-v1' else 'DM-ANC-2026-10-v1' end,'{"name":"Drive Max Used Cars LLC","address":"6210 Old US Hwy 70 W, New Bern, NC 28562","phone":"252-541-0040"}',p_actor,n.maintenance_visits,(p_command->>'batch_id')::uuid);
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
    if c.plan not in('deluxe','platinum') or p_command ? 'service_on' then
     service_date:=(p_command->>'service_on')::date;m:=(p_command->>'mileage')::integer;units:=(p_command->>'units')::integer;
     if service_date is null or service_date<c.issued_on or service_date>=c.expires_on or service_date>d or m is null or m<c.start_miles or (c.expires_miles is not null and m>=c.expires_miles)
      or units is null or units not between 1 and 2 or (c.plan<>'key_replacement' and units<>1) or jsonb_typeof(p_command->'units') is distinct from 'number' or (p_command->>'units')::numeric<>units
      or jsonb_typeof(p_command->'mileage') is distinct from 'number' or (p_command->>'mileage')::numeric<>m or m>6000000 then raise exception 'Claim service date, mileage or quantity is outside coverage.';end if;
     if exists(select 1 from public.dmcrm_protection_events where contract_id=sid and action='record_protection_claim' and lower(trim(command->>'reference'))=lower(trim(p_command->>'reference'))) then raise exception 'This claim reference has already been recorded.';end if;
     if c.plan='key_replacement' then
      with usage as (select coalesce((command->>'service_on')::date,(command->>'paid_on')::date) as on_date,coalesce((command->>'units')::integer,1) as qty from public.dmcrm_protection_events where contract_id=sid and action='record_protection_claim' union all select service_date,units)
      select (select sum(qty) from usage),exists(select 1 from usage a where (select sum(b.qty) from usage b where b.on_date>=a.on_date and b.on_date<(a.on_date+interval '12 months')::date)>2) into used_units,key_overflow;
      if used_units>3 or key_overflow then raise exception 'Key replacement is limited to 3 keys total and 2 in any rolling 12-month period.';end if;
     elsif c.plan='maintenance' then
      select count(*) into used_units from public.dmcrm_protection_events where contract_id=sid and action='record_protection_claim';
      if amt>125 or used_units>=c.maintenance_visits then raise exception 'Maintenance is limited to $125 per visit and the purchased visit count.';end if;
     end if;
    end if;
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
revoke all on function public.dmcrm_command_before_product_packets(uuid,uuid,jsonb),public.dmcrm_protection_immutable(),public.dmcrm_protection_refund(public.dmcrm_protection_contracts,date,integer) from public,anon,authenticated,service_role;
revoke all on function public.dmcrm_command(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.dmcrm_command(uuid,uuid,jsonb) to service_role;
notify pgrst,'reload schema';
