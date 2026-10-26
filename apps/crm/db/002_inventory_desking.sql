-- Add inventory and structured trade data without changing existing website tables.
create table public.dmcrm_inventory (
 id uuid primary key default gen_random_uuid(), org_id uuid not null references public.dmcrm_orgs(id),
 vin text not null check(vin ~ '^[A-HJ-NPR-Z0-9]{17}$'), stock_number text not null check(length(trim(stock_number)) between 1 and 250),
 year integer not null check(year between 1900 and 2100), make text not null, model text not null, trim text not null default '',
 mileage integer not null check(mileage between 0 and 3000000), color text not null default '',
 cost numeric(12,2) not null check(cost between 0 and 1000000), recon numeric(12,2) not null default 0 check(recon between 0 and 1000000),
 price numeric(12,2) not null check(price between 0 and 1000000), acquired_on date not null,
 status text not null default 'in_stock' check(status in ('in_stock','pending','sold','archived')),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(org_id,id),unique(org_id,vin)
);
create unique index dmcrm_inventory_stock on public.dmcrm_inventory(org_id,lower(stock_number));
create index dmcrm_inventory_status on public.dmcrm_inventory(org_id,status,acquired_on);
alter table public.dmcrm_inventory enable row level security;
revoke all on public.dmcrm_inventory from public,anon,authenticated;
grant all on public.dmcrm_inventory to service_role;
alter table public.dmcrm_customers add column inventory_id uuid,
 add column vehicle_details jsonb, add column trade jsonb,
 add foreign key(org_id,inventory_id) references public.dmcrm_inventory(org_id,id),
 add check(vehicle_details is null or jsonb_typeof(vehicle_details)='object'),
 add check(trade is null or coalesce((jsonb_typeof(trade)='object'
   and trade ?& array['vin','mileage','allowance','acv','payoff']
   and (trade->>'vin') ~ '^[A-HJ-NPR-Z0-9]{17}$'
   and (trade->>'mileage')::numeric between 0 and 3000000
   and (trade->>'allowance')::numeric between 0 and 1000000
   and (trade->>'acv')::numeric between 0 and 1000000
   and (trade->>'payoff')::numeric between 0 and 1000000),false));
alter table public.dmcrm_quotes add column inventory_id uuid, add column vehicle_details jsonb, add column trade_snapshot jsonb, add column trade_input jsonb, add column snapshot_version integer not null default 0,
 add foreign key(org_id,inventory_id) references public.dmcrm_inventory(org_id,id);

-- Keep the original command implementation private and wrap it with the additive behavior.
alter function public.dmcrm_command(uuid,uuid,jsonb) rename to dmcrm_command_v1;
revoke all on function public.dmcrm_command_v1(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
create function public.dmcrm_command(p_org uuid,p_actor uuid,p_command jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare typ text:=p_command->>'type'; actor_name text; rid uuid; c jsonb:=p_command->'customer'; v jsonb:=p_command->'vehicle';
 inv public.dmcrm_inventory%rowtype; cust public.dmcrm_customers%rowtype; iv_id uuid; old_iv_id uuid; prior_status text;
begin
 select name into actor_name from public.dmcrm_members where org_id=p_org and user_id=p_actor and active;
 if actor_name is null then raise exception 'CRM membership required' using errcode='42501';end if;
 if typ='save_inventory' then
  rid:=coalesce((p_command->>'id')::uuid,gen_random_uuid());
  if p_command ? 'id' then
   select * into inv from public.dmcrm_inventory where org_id=p_org and id=rid for update;
   if inv.id is null then raise exception 'Vehicle unavailable' using errcode='42501';end if;
  end if;
  insert into public.dmcrm_inventory(id,org_id,vin,stock_number,year,make,model,trim,mileage,color,cost,recon,price,acquired_on,status)
  values(rid,p_org,upper(v->>'vin'),trim(v->>'stock_number'),(v->>'year')::int,v->>'make',v->>'model',coalesce(v->>'trim',''),(v->>'mileage')::int,coalesce(v->>'color',''),(v->>'cost')::numeric,(v->>'recon')::numeric,(v->>'price')::numeric,(v->>'acquired_on')::date,v->>'status')
  on conflict(id) do update set vin=excluded.vin,stock_number=excluded.stock_number,year=excluded.year,make=excluded.make,model=excluded.model,trim=excluded.trim,mileage=excluded.mileage,color=excluded.color,cost=excluded.cost,recon=excluded.recon,price=excluded.price,acquired_on=excluded.acquired_on,status=excluded.status,updated_at=now()
  where public.dmcrm_inventory.org_id=p_org;
  insert into public.dmcrm_audit(org_id,actor,action,record_id) values(p_org,p_actor,typ,rid);
  return rid;
 end if;
 if typ in ('create_customer','update_customer') then
  if typ='update_customer' then
   select inventory_id into old_iv_id from public.dmcrm_customers where org_id=p_org and id=(p_command->>'id')::uuid for update;
  end if;
  if c ? 'inventory_id' and c->>'inventory_id' is not null then
   iv_id:=(c->>'inventory_id')::uuid;
   select * into inv from public.dmcrm_inventory where org_id=p_org and id=iv_id for share;
   if inv.id is null then raise exception 'Vehicle unavailable' using errcode='42501';end if;
   if inv.status<>'in_stock' and iv_id is distinct from old_iv_id then raise exception 'Select an in-stock vehicle';end if;
   c:=c||jsonb_build_object('vehicle_interest',trim(concat_ws(' ',inv.year,inv.make,inv.model,nullif(inv.trim,''))), 'vehicle_details',to_jsonb(inv)-array['id','org_id','created_at','updated_at','status']);
  end if;
  if c->'trade' is not null and c->'trade'<>'null'::jsonb then
   c:=c||jsonb_build_object('trade_vehicle',coalesce(nullif(c->'trade'->>'description',''),nullif(trim(concat_ws(' ',c->'trade'->>'year',c->'trade'->>'make',c->'trade'->>'model',c->'trade'->>'trim')),''),c->'trade'->>'vin'));
  end if;
  p_command:=jsonb_set(p_command,'{customer}',c);
 end if;
 if typ='mark_sold' then
  select status into prior_status from public.dmcrm_customers where org_id=p_org and id=(p_command->>'customer_id')::uuid for update;
 end if;
 rid:=public.dmcrm_command_v1(p_org,p_actor,p_command);
 if typ in ('create_customer','update_customer') then
  update public.dmcrm_customers set
   inventory_id=case when c ? 'inventory_id' then (c->>'inventory_id')::uuid else inventory_id end,
   vehicle_details=case when c ? 'vehicle_details' then nullif(c->'vehicle_details','null'::jsonb) else vehicle_details end,
   trade=case when c ? 'trade' then nullif(c->'trade','null'::jsonb) else trade end
  where org_id=p_org and id=rid;
 elsif typ='save_quote' then
  select * into cust from public.dmcrm_customers where org_id=p_org and id=(p_command->>'customer_id')::uuid;
  v:=cust.vehicle_details;
  if cust.inventory_id is not null then
   select to_jsonb(i)-array['id','org_id','created_at','updated_at','status'] into v from public.dmcrm_inventory i where i.org_id=p_org and i.id=cust.inventory_id;
  end if;
  update public.dmcrm_quotes set inventory_id=cust.inventory_id,vehicle_details=v,trade_input=cust.trade,snapshot_version=1,
   trade_snapshot=case when cust.trade is not null then cust.trade||jsonb_build_object('allowance',p_command->'values'->'tradeAllowance','acv',p_command->'values'->'acv','payoff',p_command->'values'->'payoff') end
  where org_id=p_org and id=rid;
 elsif typ='mark_sold' and prior_status<>'sold' then
  update public.dmcrm_visits set outcome='sold' where org_id=p_org and id=(select id from public.dmcrm_visits where org_id=p_org and customer_id=rid and (arrived_at at time zone 'America/New_York')::date=(now() at time zone 'America/New_York')::date order by arrived_at desc limit 1);
  update public.dmcrm_inventory set status='sold',updated_at=now()
  where org_id=p_org and id=(select inventory_id from public.dmcrm_customers where org_id=p_org and id=rid);
 end if;
 return rid;
end $$;
revoke all on function public.dmcrm_command(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.dmcrm_command(uuid,uuid,jsonb) to service_role;
