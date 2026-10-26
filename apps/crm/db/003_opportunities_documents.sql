-- Separate the enduring customer record from every purchase opportunity.
-- Existing records are copied into their first opportunity before any new behavior is enabled.
alter table public.dmcrm_customers add column person jsonb,add column co_buyer jsonb,add column insurance jsonb,
 add check(person is null or jsonb_typeof(person)='object'),add check(co_buyer is null or jsonb_typeof(co_buyer)='object'),add check(insurance is null or jsonb_typeof(insurance)='object');
create table public.dmcrm_opportunities(
 id uuid primary key default gen_random_uuid(),org_id uuid not null references public.dmcrm_orgs(id),customer_id uuid not null,
 title text not null default 'Vehicle purchase',source text not null default 'Walk-in',status text not null default 'new' check(status in('new','working','appointment','sold','lost')),
 inventory_id uuid,vehicle_interest text not null default '',vehicle_details jsonb,trade_vehicle text not null default '',trade jsonb,
 sold_on date,lost_reason text not null default '',closed_at timestamptz,sale_snapshot jsonb,
 paperwork jsonb not null default '{}'::jsonb check(jsonb_typeof(paperwork)='object'),paperwork_revision integer not null default 0,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(org_id,id),unique(org_id,id,customer_id),foreign key(org_id,customer_id) references public.dmcrm_customers(org_id,id),foreign key(org_id,inventory_id) references public.dmcrm_inventory(org_id,id),
 check(trade is null or coalesce(jsonb_typeof(trade)='object' and trade ?& array['vin','mileage','allowance','acv','payoff'] and trade->>'vin' ~ '^[A-HJ-NPR-Z0-9]{17}$' and (trade->>'mileage')::numeric between 0 and 3000000 and (trade->>'allowance')::numeric between 0 and 1000000 and (trade->>'acv')::numeric between 0 and 1000000 and (trade->>'payoff')::numeric between 0 and 1000000,false))
);
alter table public.dmcrm_opportunities enable row level security;
revoke all on public.dmcrm_opportunities from public,anon,authenticated;
grant all on public.dmcrm_opportunities to service_role;
create index dmcrm_opportunity_customer on public.dmcrm_opportunities(org_id,customer_id,created_at desc);
create index dmcrm_opportunity_status on public.dmcrm_opportunities(org_id,status,sold_on);
alter table public.dmcrm_quotes add column opportunity_id uuid,add foreign key(org_id,opportunity_id,customer_id) references public.dmcrm_opportunities(org_id,id,customer_id);
alter table public.dmcrm_activities add column opportunity_id uuid,add foreign key(org_id,opportunity_id,customer_id) references public.dmcrm_opportunities(org_id,id,customer_id);
alter table public.dmcrm_visits add column opportunity_id uuid,add foreign key(org_id,opportunity_id,customer_id) references public.dmcrm_opportunities(org_id,id,customer_id);
alter table public.dmcrm_tasks add column opportunity_id uuid,add foreign key(org_id,opportunity_id,customer_id) references public.dmcrm_opportunities(org_id,id,customer_id),add check(opportunity_id is null or customer_id is not null);
alter table public.dmcrm_activities drop constraint dmcrm_activities_kind_check;
alter table public.dmcrm_activities add check(kind in('note','call','system','email','sms'));
insert into public.dmcrm_opportunities(org_id,customer_id,title,source,status,inventory_id,vehicle_interest,vehicle_details,trade_vehicle,trade,sold_on,closed_at,created_at,updated_at)
 select org_id,id,coalesce(nullif(vehicle_interest,''),'Original opportunity'),source,status,inventory_id,vehicle_interest,vehicle_details,trade_vehicle,trade,sold_on,case when status in('sold','lost') then updated_at end,created_at,updated_at from public.dmcrm_customers;
update public.dmcrm_quotes q set opportunity_id=o.id from public.dmcrm_opportunities o where q.org_id=o.org_id and q.customer_id=o.customer_id;
update public.dmcrm_activities a set opportunity_id=o.id from public.dmcrm_opportunities o where a.org_id=o.org_id and a.customer_id=o.customer_id;
update public.dmcrm_visits v set opportunity_id=o.id from public.dmcrm_opportunities o where v.org_id=o.org_id and v.customer_id=o.customer_id;
update public.dmcrm_tasks t set opportunity_id=o.id from public.dmcrm_opportunities o where t.org_id=o.org_id and t.customer_id=o.customer_id and t.kind<>'birthday';
update public.dmcrm_opportunities o set sale_snapshot=jsonb_build_object('customer',to_jsonb(c),'insurance',c.insurance,'quote',(select to_jsonb(q) from public.dmcrm_quotes q where q.org_id=o.org_id and q.opportunity_id=o.id order by q.created_at desc limit 1)) from public.dmcrm_customers c where c.org_id=o.org_id and c.id=o.customer_id and o.status in('sold','lost');

alter function public.dmcrm_command(uuid,uuid,jsonb) rename to dmcrm_command_v2;
revoke all on function public.dmcrm_command_v2(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
create function public.dmcrm_command(p_org uuid,p_actor uuid,p_command jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare typ text:=p_command->>'type';actor_name text;cid uuid;oid uuid;rid uuid;c jsonb:=p_command->'customer';o jsonb:=p_command->'opportunity';v jsonb;vals jsonb;
 cust public.dmcrm_customers%rowtype;opp public.dmcrm_opportunities%rowtype;inv public.dmcrm_inventory%rowtype;vr public.dmcrm_visits%rowtype;tr public.dmcrm_tasks%rowtype;
 today date:=(now() at time zone 'America/New_York')::date;prior_bday date;n integer;closing_outcome text;old_iv uuid;
begin
 select name into actor_name from public.dmcrm_members where org_id=p_org and user_id=p_actor and active;
 if actor_name is null then raise exception 'CRM membership required' using errcode='42501';end if;
 if typ='save_inventory' then return public.dmcrm_command_v2(p_org,p_actor,p_command);end if;
 if p_command->>'customer_id' is not null then
  cid:=(p_command->>'customer_id')::uuid;
  select * into cust from public.dmcrm_customers where org_id=p_org and id=cid;
  if cust.id is null then raise exception 'Customer unavailable' using errcode='42501';end if;
 end if;
 if p_command->>'opportunity_id' is not null then
  oid:=(p_command->>'opportunity_id')::uuid;
  select * into opp from public.dmcrm_opportunities where org_id=p_org and id=oid for update;
  if opp.id is null or (cid is not null and cid<>opp.customer_id) then raise exception 'Opportunity unavailable' using errcode='42501';end if;
  cid:=opp.customer_id;
  select * into cust from public.dmcrm_customers where org_id=p_org and id=cid;
 end if;
 if typ in('update_opportunity','close_opportunity') then
  oid:=(p_command->>'id')::uuid;
  select * into opp from public.dmcrm_opportunities where org_id=p_org and id=oid for update;
  if opp.id is null then raise exception 'Opportunity unavailable' using errcode='42501';end if;
  cid:=opp.customer_id;select * into cust from public.dmcrm_customers where org_id=p_org and id=cid;
 end if;
 if typ in('save_quote','mark_sold') and oid is null then
  select * into opp from public.dmcrm_opportunities where org_id=p_org and customer_id=cid and status not in('sold','lost') order by created_at desc limit 1 for update;
  oid:=opp.id;
  if oid is null then raise exception 'Select an active opportunity';end if;
 end if;
 if typ in('create_customer','update_customer') then
  if typ='create_customer' then
   insert into public.dmcrm_customers(org_id,name,email,phone,source,birthday,person,co_buyer)
   values(p_org,c->>'name',c->>'email',c->>'phone',c->>'source',nullif(c->>'birthday','')::date,nullif(c->'person','null'),nullif(c->'co_buyer','null')) returning id into cid;
  else
   cid:=(p_command->>'id')::uuid;
   select * into cust from public.dmcrm_customers where org_id=p_org and id=cid for update;
   if cust.id is null then raise exception 'Customer unavailable' using errcode='42501';end if;
   prior_bday:=cust.birthday;
   -- Vehicle/status fields from old clients cannot overwrite either current or historical opportunities.
   update public.dmcrm_customers set name=c->>'name',email=c->>'email',phone=c->>'phone',source=c->>'source',birthday=nullif(c->>'birthday','')::date,person=case when c ? 'person' then nullif(c->'person','null') else person end,co_buyer=case when c ? 'co_buyer' then nullif(c->'co_buyer','null') else co_buyer end,updated_at=now() where org_id=p_org and id=cid;
  end if;
  if prior_bday is distinct from nullif(c->>'birthday','')::date then
   update public.dmcrm_tasks set canceled_at=now() where org_id=p_org and customer_id=cid and kind='birthday' and completed_at is null and canceled_at is null;
   if nullif(c->>'birthday','') is not null then insert into public.dmcrm_tasks(org_id,customer_id,title,due_date,kind) values(p_org,cid,(c->>'name')||' · birthday',public.dmcrm_next_annual((c->>'birthday')::date,today),'birthday');end if;
  end if;
  insert into public.dmcrm_activities(org_id,customer_id,kind,body,created_by) values(p_org,cid,'system',case when typ='create_customer' then 'Customer profile created' else 'Customer contact details updated' end,actor_name);
  if typ='create_customer' and coalesce((c->>'initial_opportunity')::boolean,true) then
   o:=jsonb_build_object('title',coalesce(nullif(c->>'vehicle_interest',''),'Vehicle purchase'),'source',c->>'source','status','new','inventory_id',c->'inventory_id','vehicle_interest',coalesce(c->>'vehicle_interest',''),'vehicle_details',c->'vehicle_details','trade_vehicle',coalesce(c->>'trade_vehicle',''),'trade',c->'trade');
   perform public.dmcrm_command(p_org,p_actor,jsonb_build_object('type','create_opportunity','customer_id',cid,'opportunity',o));
  end if;
  rid:=cid;
 elsif typ in('create_opportunity','update_opportunity') then
  if typ='update_opportunity' and opp.status in('sold','lost') then raise exception 'Closed opportunity is read-only';end if;
  if o->>'status' not in('new','working','appointment') then raise exception 'Invalid opportunity status';end if;
  old_iv:=opp.inventory_id;
  if o->>'inventory_id' is not null then
   select * into inv from public.dmcrm_inventory where org_id=p_org and id=(o->>'inventory_id')::uuid for update;
   if inv.id is null then raise exception 'Vehicle unavailable' using errcode='42501';end if;
   if inv.status<>'in_stock' and inv.id is distinct from old_iv then raise exception 'Select an in-stock vehicle';end if;
   o:=o||jsonb_build_object('vehicle_interest',trim(concat_ws(' ',inv.year,inv.make,inv.model,nullif(inv.trim,''))),'vehicle_details',to_jsonb(inv)-array['id','org_id','created_at','updated_at','status']);
  end if;
  if nullif(o->'trade','null') is not null then o:=o||jsonb_build_object('trade_vehicle',coalesce(nullif(o->'trade'->>'description',''),nullif(trim(concat_ws(' ',o->'trade'->>'year',o->'trade'->>'make',o->'trade'->>'model',o->'trade'->>'trim')),''),o->'trade'->>'vin'));end if;
  if typ='create_opportunity' then
   insert into public.dmcrm_opportunities(org_id,customer_id,title,source,status,inventory_id,vehicle_interest,vehicle_details,trade_vehicle,trade)
   values(p_org,cid,o->>'title',coalesce(o->>'source','Walk-in'),o->>'status',(o->>'inventory_id')::uuid,coalesce(o->>'vehicle_interest',''),nullif(o->'vehicle_details','null'),coalesce(o->>'trade_vehicle',''),nullif(o->'trade','null')) returning id into oid;
   insert into public.dmcrm_tasks(org_id,customer_id,opportunity_id,title,due_date,kind,origin_key) values(p_org,cid,oid,'Follow up · '||(o->>'title'),today+1,'unsold_followup','opportunity:'||oid);
  else
   update public.dmcrm_opportunities set title=o->>'title',source=o->>'source',status=o->>'status',inventory_id=(o->>'inventory_id')::uuid,vehicle_interest=o->>'vehicle_interest',vehicle_details=nullif(o->'vehicle_details','null'),trade_vehicle=o->>'trade_vehicle',trade=nullif(o->'trade','null'),updated_at=now() where org_id=p_org and id=oid;
  end if;
  insert into public.dmcrm_activities(org_id,customer_id,opportunity_id,kind,body,created_by) values(p_org,cid,oid,'system',case when typ='create_opportunity' then 'Opportunity created' else 'Opportunity vehicle and trade updated' end,actor_name);
  rid:=oid;
 elsif typ in('close_opportunity','mark_sold') then
  closing_outcome:=case when typ='mark_sold' then 'sold' else p_command->>'outcome' end;
  if closing_outcome not in('sold','lost') then raise exception 'Invalid outcome';end if;
  if opp.status=closing_outcome then return oid;end if;
  if opp.status in('sold','lost') then raise exception 'Closed opportunity is read-only';end if;
  if opp.inventory_id is not null then
   select * into inv from public.dmcrm_inventory where org_id=p_org and id=opp.inventory_id for update;
   if closing_outcome='sold' and inv.status='sold' then raise exception 'This inventory vehicle has already been sold';end if;
   if closing_outcome='sold' then update public.dmcrm_inventory set status='sold',updated_at=now() where org_id=p_org and id=inv.id;end if;
   v:=to_jsonb(inv)-array['id','org_id','created_at','updated_at','status'];
  else v:=opp.vehicle_details;end if;
  update public.dmcrm_opportunities set status=closing_outcome,sold_on=case when closing_outcome='sold' then today end,closed_at=now(),lost_reason=coalesce(p_command->>'reason',''),vehicle_details=v,
    sale_snapshot=jsonb_build_object('customer',to_jsonb(cust),'insurance',cust.insurance,'quote',(select to_jsonb(q) from public.dmcrm_quotes q where q.org_id=p_org and q.opportunity_id=oid and q.inventory_id is not distinct from opp.inventory_id and (opp.inventory_id is not null or q.vehicle=opp.vehicle_interest) order by q.created_at desc limit 1)),updated_at=now() where org_id=p_org and id=oid;
  update public.dmcrm_tasks set canceled_at=now() where org_id=p_org and opportunity_id=oid and kind in('unsold_followup','appointment') and completed_at is null and canceled_at is null;
  if closing_outcome='sold' then
   update public.dmcrm_visits set outcome='sold' where org_id=p_org and opportunity_id=oid and (departed_at is null or id=(select id from public.dmcrm_visits where org_id=p_org and opportunity_id=oid and (arrived_at at time zone 'America/New_York')::date=today order by arrived_at desc limit 1));
   foreach n in array array[2,7,30] loop
    insert into public.dmcrm_tasks(org_id,customer_id,opportunity_id,title,due_date,kind,origin_key) values(p_org,cid,oid,n||'-day sold follow-up · '||opp.title,today+n,'sold_followup','sold:'||oid||':'||n) on conflict do nothing;
   end loop;
   insert into public.dmcrm_tasks(org_id,customer_id,opportunity_id,title,due_date,kind,origin_key) values(p_org,cid,oid,'Purchase anniversary · '||opp.title,public.dmcrm_next_annual(today,today+1),'anniversary','anniversary:'||oid||':'||public.dmcrm_next_annual(today,today+1)) on conflict do nothing;
  end if;
  insert into public.dmcrm_activities(org_id,customer_id,opportunity_id,kind,body,created_by) values(p_org,cid,oid,'system','Opportunity marked '||closing_outcome||case when coalesce(p_command->>'reason','')<>'' then ' · '||(p_command->>'reason') else '' end,actor_name);
  rid:=oid;
 elsif typ='add_activity' then
  if p_command->>'kind' not in('note','call','email','sms') or length(trim(p_command->>'body')) not between 1 and 8000 then raise exception 'Invalid activity';end if;
  insert into public.dmcrm_activities(org_id,customer_id,opportunity_id,kind,body,created_by) values(p_org,cid,oid,p_command->>'kind',p_command->>'body',actor_name) returning id into rid;
 elsif typ='save_insurance' then
  update public.dmcrm_customers set insurance=p_command->'insurance',updated_at=now() where org_id=p_org and id=cid;
  insert into public.dmcrm_activities(org_id,customer_id,kind,body,created_by) values(p_org,cid,'system','Automobile insurance updated',actor_name);rid:=cid;
 elsif typ='save_paperwork' then
  if jsonb_typeof(p_command->'paperwork')<>'object' then raise exception 'Invalid document fields';end if;
  update public.dmcrm_opportunities set paperwork=p_command->'paperwork',paperwork_revision=paperwork_revision+1 where org_id=p_org and id=oid and paperwork_revision=(p_command->>'revision')::integer returning id into rid;
  if rid is null then raise exception 'Paperwork changed in another session. Reload before saving.';end if;
 elsif typ='check_in' then
  if oid is not null and opp.status='lost' then raise exception 'Choose an active opportunity or general customer visit';end if;
  insert into public.dmcrm_visits(org_id,customer_id,opportunity_id) values(p_org,cid,oid) on conflict(org_id,customer_id) where departed_at is null do nothing returning id into rid;
  if rid is not null then insert into public.dmcrm_activities(org_id,customer_id,opportunity_id,kind,body,created_by) values(p_org,cid,oid,'system','Checked into the showroom',actor_name);end if;
 elsif typ='check_out' then
  update public.dmcrm_visits set departed_at=now(),outcome=case when outcome='sold' then 'sold' else 'unsold' end where org_id=p_org and id=(p_command->>'id')::uuid and departed_at is null returning * into vr;
  if vr.id is not null then
   rid:=vr.id;cid:=vr.customer_id;oid:=vr.opportunity_id;
   if vr.outcome='unsold' and (oid is null or exists(select 1 from public.dmcrm_opportunities where org_id=p_org and id=oid and status not in('sold','lost'))) then insert into public.dmcrm_tasks(org_id,customer_id,opportunity_id,title,due_date,kind,origin_key) values(p_org,cid,oid,'Follow up after showroom visit',today+1,'unsold_followup','visit:'||rid) on conflict do nothing;end if;
   insert into public.dmcrm_activities(org_id,customer_id,opportunity_id,kind,body,created_by) values(p_org,cid,oid,'system','Visit ended · customer left',actor_name);
  end if;
 elsif typ='create_task' then
  insert into public.dmcrm_tasks(org_id,customer_id,opportunity_id,title,due_date,kind) values(p_org,cid,oid,p_command->>'title',(p_command->>'due_date')::date,p_command->>'kind') returning id into rid;
 elsif typ='complete_task' then
  update public.dmcrm_tasks set completed_at=now() where org_id=p_org and id=(p_command->>'id')::uuid and completed_at is null and canceled_at is null returning * into tr;rid:=tr.id;
  if tr.kind in('birthday','anniversary') then insert into public.dmcrm_tasks(org_id,customer_id,opportunity_id,title,due_date,kind,origin_key) values(p_org,tr.customer_id,tr.opportunity_id,tr.title,public.dmcrm_next_annual(tr.due_date,tr.due_date+1),tr.kind,tr.kind||':'||coalesce(tr.opportunity_id,tr.customer_id)||':'||public.dmcrm_next_annual(tr.due_date,tr.due_date+1)) on conflict do nothing;end if;
 elsif typ='save_quote' then
  if opp.status in('sold','lost') then raise exception 'Closed opportunity is read-only';end if;
  v:=opp.vehicle_details;
  if opp.inventory_id is not null then select to_jsonb(i)-array['id','org_id','created_at','updated_at','status'] into v from public.dmcrm_inventory i where i.org_id=p_org and i.id=opp.inventory_id;end if;
  vals:=p_command->'values';
  if vals->>'taxMode'='auto' then vals:=jsonb_set(vals,'{tax}',to_jsonb(round(greatest(0,(vals->>'price')::numeric+(vals->>'docFee')::numeric+coalesce((vals->>'addOns')::numeric,0)-(vals->>'tradeAllowance')::numeric)*0.03,2)));end if;
  insert into public.dmcrm_quotes(org_id,customer_id,opportunity_id,vehicle,values,inventory_id,vehicle_details,trade_input,trade_snapshot,snapshot_version)
  values(p_org,cid,oid,p_command->>'vehicle',vals,opp.inventory_id,v,opp.trade,case when opp.trade is not null then opp.trade||jsonb_build_object('allowance',vals->'tradeAllowance','acv',vals->'acv','payoff',vals->'payoff') end,1) returning id into rid;
 else raise exception 'Unknown CRM command';
 end if;
 insert into public.dmcrm_audit(org_id,actor,action,record_id) values(p_org,p_actor,typ,rid);
 return rid;
end $$;
revoke all on function public.dmcrm_command(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.dmcrm_command(uuid,uuid,jsonb) to service_role;
