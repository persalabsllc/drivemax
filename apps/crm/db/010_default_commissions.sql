-- Existing earnings stay manual and unchanged. New sales receive the default pay plan.
alter table public.dmcrm_commissions
 add column calculation text not null default 'manual' check(calculation in('manual','default')),
 add column pending boolean not null default false;

create function public.dmcrm_default_commission(p_sale jsonb,p_category text) returns numeric
language plpgsql immutable set search_path='' as $$
declare q jsonb:=nullif(p_sale->'snapshot'->'quote','null');v jsonb;a jsonb:=p_sale->'accounting';vehicle jsonb;t jsonb;item jsonb;
 cost numeric;recon numeric;basis numeric;revenue numeric:=0;costs numeric:=0;pc numeric;
begin
 if q is null then return null;end if;
 v:=q->'values';
 if p_category='sales' then
  vehicle:=coalesce(nullif(q->'vehicle_details','null'),p_sale->'snapshot'->'opportunity'->'vehicle_details');
  cost:=coalesce((a->>'vehicle_cost')::numeric,(vehicle->>'cost')::numeric);
  recon:=coalesce((a->>'recon')::numeric,(vehicle->>'recon')::numeric);
  if cost is null or recon is null then return null;end if;
  t:=coalesce(nullif(q->'trade_snapshot','null'),nullif(p_sale->'snapshot'->'opportunity'->'trade','null'));
  basis:=(v->>'price')::numeric-cost-recon+coalesce((v->>'addOns')::numeric,0)-coalesce((a->>'accessory_cost')::numeric,0)
   -coalesce((a->>'other_cost')::numeric,0)-coalesce((a->>'pack')::numeric,0);
  if t is not null then basis:=basis+coalesce((v->>'acv')::numeric,(t->>'acv')::numeric)-coalesce((v->>'tradeAllowance')::numeric,(t->>'allowance')::numeric);end if;
  -- Doc fees remain dealership income, but never enter this commission basis.
  return round(greatest(round(basis,2),0)*0.25,2);
 elsif p_category='fi' then
  if jsonb_typeof(v->'products')='array' then
   for item in select value from jsonb_array_elements(v->'products') loop
    revenue:=revenue+(item->>'price')::numeric;
    pc:=case when a->'product_costs' ? (item->>'id') then (a->'product_costs'->>(item->>'id'))::numeric else (item->>'cost')::numeric end;
    if pc is null then return null;end if;
    costs:=costs+pc;
   end loop;
  else
   revenue:=coalesce((v->>'serviceContract')::numeric,0);
   if revenue<>0 then costs:=(a->>'legacy_product_cost')::numeric;if costs is null then return null;end if;end if;
  end if;
  basis:=round(revenue-costs,2)+coalesce((a->>'finance_reserve')::numeric,0);
  return round(greatest(round(basis,2),0)*0.05,2);
 end if;
 return 0;
end $$;
revoke all on function public.dmcrm_default_commission(jsonb,text) from public,anon,authenticated,service_role;

create function public.dmcrm_seed_commissions() returns trigger language plpgsql security definer set search_path='' as $$
declare who public.dmcrm_staff%rowtype;category text;earned numeric;
begin
 select * into who from public.dmcrm_staff where org_id=new.org_id and id=(new.snapshot->'salesperson'->>'id')::uuid;
 if new.status<>'sold' or who.id is null then return new;end if;
 foreach category in array array['sales','fi'] loop
  earned:=public.dmcrm_default_commission(to_jsonb(new),category);
  insert into public.dmcrm_commissions(id,org_id,sale_id,staff_id,staff_name,category,amount,calculation,pending)
   values(gen_random_uuid(),new.org_id,new.id,who.id,who.name,category,coalesce(earned,0),'default',earned is null);
 end loop;
 return new;
end $$;
create trigger dmcrm_sale_default_commissions after insert on public.dmcrm_sales for each row execute function public.dmcrm_seed_commissions();
revoke all on function public.dmcrm_seed_commissions() from public,anon,authenticated,service_role;

alter function public.dmcrm_command(uuid,uuid,jsonb) rename to dmcrm_command_v9;
revoke all on function public.dmcrm_command_v9(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
create function public.dmcrm_command(p_org uuid,p_actor uuid,p_command jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare s public.dmcrm_sales%rowtype;item jsonb;entries jsonb:='[]';earned numeric;rid uuid;
begin
 if p_command->>'type'='save_accounting' then
  if not exists(select 1 from public.dmcrm_members m join public.dmcrm_staff st on st.org_id=m.org_id and st.user_id=m.user_id
   where m.org_id=p_org and m.user_id=p_actor and m.active and st.active and st.role in('owner','manager'))
   then raise exception 'Manager access required' using errcode='42501';end if;
  select * into s from public.dmcrm_sales where org_id=p_org and id=(p_command->>'sale_id')::uuid for update;
  if s.id is null then raise exception 'Sale unavailable' using errcode='42501';end if;
  s.accounting:=p_command->'accounting';
  if jsonb_typeof(p_command->'commissions') is distinct from 'array' then raise exception 'Invalid accounting';end if;
  for item in select value from jsonb_array_elements(p_command->'commissions') loop
   if coalesce(item->>'calculation','manual') not in('default','manual') then raise exception 'Invalid commission calculation';end if;
   if item->>'calculation'='default' then
    if item->>'category' not in('sales','fi') then raise exception 'Only sales and F&I use default commissions';end if;
    earned:=public.dmcrm_default_commission(to_jsonb(s),item->>'category');
    if (item->>'paid_amount')::numeric>coalesce(earned,0) then raise exception 'Default commission is below the paid amount. Review costs or keep the agreed amount as a manual entry.';end if;
    item:=item||jsonb_build_object('amount',coalesce(earned,0),'pending',earned is null);
   else item:=item||jsonb_build_object('calculation','manual','pending',false);end if;
   entries:=entries||jsonb_build_array(item);
  end loop;
  p_command:=jsonb_set(p_command,'{commissions}',entries);
 end if;
 rid:=public.dmcrm_command_v9(p_org,p_actor,p_command);
 if p_command->>'type'='save_accounting' then
  for item in select value from jsonb_array_elements(entries) loop
   update public.dmcrm_commissions set calculation=item->>'calculation',pending=(item->>'pending')::boolean
    where org_id=p_org and sale_id=rid and id=(item->>'id')::uuid;
  end loop;
 end if;
 return rid;
end $$;
revoke all on function public.dmcrm_command(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.dmcrm_command(uuid,uuid,jsonb) to service_role;
