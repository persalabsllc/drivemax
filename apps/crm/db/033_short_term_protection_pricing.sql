-- Keep legacy schedules readable, while allowing coverage to be priced to the
-- first time/mileage limit and discounting service-contract deductibles.
create or replace function public.dmcrm_check_pricing(c jsonb) returns void language plpgsql immutable set search_path='' as $$
declare plan text;r jsonb;k text;n numeric;previous_discount numeric:=0;
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
   or (plan in('deluxe','platinum') and r->>'basis' not in('annual','annual_mileage','first_limit'))
   or (plan in('tire_wheel','pdr','key_replacement') and r->>'basis' not in('annual','annual_mileage')) then raise exception 'Review the product pricing settings.';end if;
  n:=(r->>'amount')::numeric;
  if n not between 0 and 1000000 or round(n,2)<>n then raise exception 'Review the product pricing settings.';end if;
 end loop;
 if c ? 'deductible_discounts' then
  if jsonb_typeof(c->'deductible_discounts') is distinct from 'object' then raise exception 'Review the product pricing settings.';end if;
  foreach k in array array['0','250','500','1000'] loop
   if jsonb_typeof(c#>array['deductible_discounts',k]) is distinct from 'number' then raise exception 'Review the product pricing settings.';end if;
   n:=(c#>>array['deductible_discounts',k])::numeric;
   if n not between 0 and 95 or round(n,2)<>n or (k='0' and n<>0) or n<previous_discount then raise exception 'Review the product pricing settings.';end if;
   previous_discount:=n;
  end loop;
 end if;
end $$;

create or replace function public.dmcrm_protection_cost(p jsonb,c jsonb,rev integer) returns jsonb language plpgsql immutable set search_path='' as $$
declare plan text:=p->>'protection_plan';r jsonb:=c->'rates'->plan;units numeric;scheduled numeric;floor_cost numeric;numerator numeric;denominator numeric:=1;mileage_rated boolean;
 discounted boolean:=plan in('deluxe','platinum') and c ? 'deductible_discounts';discount numeric:=0;deductible numeric:=coalesce((p->>'deductible')::numeric,0);result jsonb;
begin
 if r is null or coalesce((p->>'term_months')::numeric,0)<=0 or p->>'price' is null then return null;end if;
 if r->>'basis' in('annual_mileage','first_limit') and not coalesce((p->>'unlimited_miles')::boolean,false) and coalesce((p->>'mileage_limit')::numeric,0)<=0 then return null;end if;
 mileage_rated:=not coalesce((p->>'unlimited_miles')::boolean,false) and case r->>'basis'
  when 'first_limit' then (p->>'mileage_limit')::numeric*12<(p->>'term_months')::numeric*(c->>'annual_miles')::numeric
  when 'annual_mileage' then (p->>'mileage_limit')::numeric*12>(p->>'term_months')::numeric*(c->>'annual_miles')::numeric else false end;
 if r->>'basis'='flat' then numerator:=1;
 elsif r->>'basis'='visit' then numerator:=(p->>'maintenance_visits')::numeric;
 elsif mileage_rated then numerator:=(p->>'mileage_limit')::numeric;denominator:=(c->>'annual_miles')::numeric;
 else numerator:=(p->>'term_months')::numeric;denominator:=12;end if;
 units:=numerator/denominator;
 if units is null or units<=0 then return null;end if;
 if discounted then
  if deductible not in(0,250,500,1000) then return null;end if;
  discount:=(c#>>array['deductible_discounts',trunc(deductible)::text])::numeric;
 end if;
 scheduled:=round(numerator*(r->>'amount')::numeric*(100-discount)/(denominator*100),2);
 floor_cost:=round((p->>'price')::numeric*(c->>'reserve_percent')::numeric/100,2);
 if greatest(scheduled,floor_cost)>1000000 then raise exception 'Review the product pricing settings.';end if;
 result:=jsonb_build_object('revision',rev,'plan',plan,'basis',r->>'basis','rate',(r->>'amount')::numeric,'units',round(units,6),'scheduled_cost',scheduled,'reserve_floor',floor_cost,'cost',greatest(scheduled,floor_cost));
 if discounted then result:=result||jsonb_build_object('base_cost',round(numerator*(r->>'amount')::numeric/denominator,2),'deductible',deductible,'deductible_discount_percent',discount);end if;
 return result;
end $$;

-- The standalone contracting path must include the selected deductible too.
create or replace function public.dmcrm_contract_product_cost() returns trigger language plpgsql security definer set search_path='' as $$
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
   new.pricing_snapshot:=public.dmcrm_protection_cost(jsonb_build_object('protection_plan',new.plan,'term_months',new.term_months,'mileage_limit',new.term_miles,'unlimited_miles',new.term_miles is null,'maintenance_visits',new.maintenance_visits,'price',new.price,'deductible',new.deductible),s.active,s.active_revision);
   new.internal_cost:=(new.pricing_snapshot->>'cost')::numeric;
  else new.internal_cost:=null;new.pricing_snapshot:=null;end if;
 end if;
 return new;
end $$;

-- Kyle requested correction of the active short-term and deductible pricing.
-- Apply once to settings only; preserve base rates, funding policy, pending
-- draft changes, pauses, historical quotes and issued contract allocations.
do $$
declare org uuid:='d5a1c100-0000-4000-8000-000000000001';rid uuid:='8f1f54a7-d32b-46b3-8389-7ab8fbfe7a16';s public.dmcrm_product_pricing%rowtype;
 owners uuid[];actor uuid;configs jsonb[];c jsonb;i integer;plan text;
begin
 perform pg_advisory_xact_lock(hashtextextended('dmcrm:pricing:'||org::text,0));
 if exists(select 1 from public.dmcrm_pricing_events where id=rid) then return;end if;
 select * into s from public.dmcrm_product_pricing where org_id=org for update;
 if not found then return;end if;
 select array_agg(st.user_id) into owners from public.dmcrm_staff st join public.dmcrm_members m on m.org_id=st.org_id and m.user_id=st.user_id
  where st.org_id=org and st.active and m.active and st.role='owner' and m.role='owner' and st.name='Kyle Kratoville' and m.name='Kyle Kratoville';
 if coalesce(array_length(owners,1),0)<>1 then raise exception 'Approving owner must be uniquely identified';end if;
 actor:=owners[1];configs:=array[s.draft,s.active];
 for i in 1..2 loop
  c:=configs[i];
  if c is null then continue;end if;
  foreach plan in array array['deluxe','platinum'] loop
   if c#>>array['rates',plan,'basis']='annual_mileage' then c:=jsonb_set(c,array['rates',plan,'basis'],'"first_limit"'::jsonb);end if;
  end loop;
  if not(c ? 'deductible_discounts') then c:=c||'{"deductible_discounts":{"0":0,"250":10,"500":20,"1000":35}}'::jsonb;end if;
  perform public.dmcrm_check_pricing(c);configs[i]:=c;
 end loop;
 update public.dmcrm_product_pricing set draft=configs[1],active=configs[2],revision=s.revision+1,
  active_revision=case when configs[2] is null then null else s.revision+1 end,updated_at=now(),updated_by=actor where org_id=org;
 insert into public.dmcrm_pricing_events(id,org_id,command,created_by) values(rid,org,
  jsonb_build_object('type','correct_service_contract_pricing','approval_reference','Owner requested short-term and deductible cost correction in ChatGPT on 2026-10-31',
  'from_revision',s.revision,'to_revision',s.revision+1,'before_draft',s.draft,'before_active',s.active,'draft',configs[1],'active',configs[2]),actor);
end $$;
