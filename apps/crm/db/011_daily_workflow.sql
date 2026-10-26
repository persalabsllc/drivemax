-- Daily workflow polish: reversible vehicle removal, a per-user attention feed,
-- and task events in the customer's complete activity timeline.
alter table public.dmcrm_inventory add column deleted_at timestamptz, add column deleted_by uuid, add column deletion_reason text;
alter table public.dmcrm_trades add column deleted_at timestamptz, add column deleted_by uuid, add column deletion_reason text;
-- Deleted identities remain available to historical snapshots and foreign keys.
alter table public.dmcrm_inventory drop constraint dmcrm_inventory_org_id_vin_key;
create unique index dmcrm_inventory_live_vin on public.dmcrm_inventory(org_id,vin) where deleted_at is null;
drop index public.dmcrm_inventory_stock;
create unique index dmcrm_inventory_stock on public.dmcrm_inventory(org_id,lower(stock_number)) where deleted_at is null;

create function public.dmcrm_deleted_inventory_guard() returns trigger language plpgsql set search_path='' as $$
begin
 if old.deleted_at is not null and (new.deleted_at is null or new.status<>'archived') then
  raise exception 'This vehicle was deleted. Refresh and select another vehicle.';
 end if;
 return new;
end $$;
create trigger dmcrm_deleted_inventory_guard before update on public.dmcrm_inventory for each row execute function public.dmcrm_deleted_inventory_guard();
create function public.dmcrm_opportunity_inventory_guard() returns trigger language plpgsql set search_path='' as $$
begin
 if new.inventory_id is not null and new.status<>'lost' then
  perform 1 from public.dmcrm_inventory where org_id=new.org_id and id=new.inventory_id and deleted_at is null for share;
  if not found then raise exception 'This vehicle was deleted. Refresh and select another vehicle.';end if;
 end if;
 return new;
end $$;
create trigger dmcrm_opportunity_inventory_guard before insert or update on public.dmcrm_opportunities for each row execute function public.dmcrm_opportunity_inventory_guard();
revoke all on function public.dmcrm_deleted_inventory_guard(),public.dmcrm_opportunity_inventory_guard() from public,anon,authenticated,service_role;

create table public.dmcrm_attention_reads (
 org_id uuid not null references public.dmcrm_orgs(id), actor uuid not null,
 alert_key text not null, reviewed_at timestamptz not null default now(), primary key(org_id,actor,alert_key)
);
alter table public.dmcrm_attention_reads enable row level security;
revoke all on public.dmcrm_attention_reads from public,anon,authenticated;
grant all on public.dmcrm_attention_reads to service_role;
create index dmcrm_attention_messages on public.dmcrm_messages(org_id,updated_at desc) where (direction='inbound' and status='received') or (direction='outbound' and status='failed');

-- All sources are scoped to the dealership and current assignment. Reviewing an
-- alert only clears it for that user; tasks stay visible until completed.
create function public.dmcrm_attention_items(p_org uuid,p_actor uuid)
returns table(key text,kind text,id uuid,customer_id uuid,customer_name text,opportunity_id uuid,channel text,title text,detail text,created_at timestamptz)
language plpgsql security definer set search_path='' as $$
declare a public.dmcrm_staff%rowtype;manager boolean;today date:=(now() at time zone 'America/New_York')::date;
begin
 select st.* into a from public.dmcrm_staff st join public.dmcrm_members m on m.org_id=st.org_id and m.user_id=st.user_id
 where st.org_id=p_org and st.user_id=p_actor and st.active and m.active;
 if a.id is null then raise exception 'CRM membership required' using errcode='42501';end if;
 manager:=a.role in('owner','manager');
 return query
 select 'lead:'||c.id,'lead'::text,c.id,c.id,c.name,null::uuid,null::text,'New customer lead'::text,c.source,c.created_at
 from public.dmcrm_customers c where c.org_id=p_org and c.status='new' and (manager or c.assigned_to=a.id)
 union all
 select (case when m.direction='inbound' then 'reply:' else 'failed:' end)||m.id,
  case when m.direction='inbound' then 'reply' else 'failed' end,m.id,c.id,c.name,m.opportunity_id,m.channel,
  (case when m.channel='sms' then 'Text' else 'Email' end)||(case when m.direction='inbound' then ' received' else ' delivery failed' end),
  left(coalesce(nullif(m.subject,''),m.body),160),m.updated_at
 from public.dmcrm_messages m join public.dmcrm_customers c on c.org_id=m.org_id and c.id=m.customer_id
 left join public.dmcrm_opportunities o on o.org_id=m.org_id and o.id=m.opportunity_id
 where m.org_id=p_org and ((m.direction='inbound' and m.status='received') or (m.direction='outbound' and m.status='failed'))
  and (manager or (case when m.opportunity_id is null then c.assigned_to else o.assigned_to end)=a.id)
 union all
 select 'task:'||t.id,'task'::text,t.id,t.customer_id,coalesce(c.name,'Team task'),t.opportunity_id,null::text,t.title,
  (case when t.due_date<today then 'Past due' else 'Due today' end)||' · '||t.due_date,
  t.due_date::timestamp at time zone 'America/New_York'
 from public.dmcrm_tasks t left join public.dmcrm_customers c on c.org_id=t.org_id and c.id=t.customer_id
 where t.org_id=p_org and t.completed_at is null and t.canceled_at is null and t.due_date<=today and (manager or t.assigned_to=a.id);
end $$;
create function public.dmcrm_attention(p_org uuid,p_actor uuid) returns jsonb
language sql security definer set search_path='' as $$
 with unread as materialized (
  select e.* from public.dmcrm_attention_items(p_org,p_actor) e
  where e.kind='task' or not exists(select 1 from public.dmcrm_attention_reads r where r.org_id=p_org and r.actor=p_actor and r.alert_key=e.key)
 ), page as (
  select * from unread order by case when kind in('reply','failed') then 0 else 1 end,created_at desc,key desc limit 100
 )
 select jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(page)) from page),'[]'::jsonb),'total',(select count(*) from unread));
$$;
revoke all on function public.dmcrm_attention_items(uuid,uuid),public.dmcrm_attention(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.dmcrm_attention(uuid,uuid) to service_role;

create function public.dmcrm_task_activity() returns trigger language plpgsql security definer set search_path='' as $$
declare label text;actor_name text;
begin
 if new.customer_id is null then return new;end if;
 if tg_op='INSERT' then label:='Task scheduled: '||new.title||' · due '||new.due_date;
 elsif old.completed_at is null and new.completed_at is not null then label:='Task completed: '||new.title;
 elsif old.canceled_at is null and new.canceled_at is not null then label:='Task canceled: '||new.title;
 end if;
 if label is not null then
  select name into actor_name from public.dmcrm_staff where org_id=new.org_id and user_id=nullif(current_setting('dmcrm.actor_id',true),'')::uuid;
  insert into public.dmcrm_activities(org_id,customer_id,opportunity_id,kind,body,created_by)
   values(new.org_id,new.customer_id,new.opportunity_id,'system',label,coalesce(actor_name,'System'));
 end if;
 return new;
end $$;
create trigger dmcrm_task_activity after insert or update on public.dmcrm_tasks for each row execute function public.dmcrm_task_activity();
revoke all on function public.dmcrm_task_activity() from public,anon,authenticated,service_role;

alter function public.dmcrm_command(uuid,uuid,jsonb) rename to dmcrm_command_v10;
revoke all on function public.dmcrm_command_v10(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
create function public.dmcrm_command(p_org uuid,p_actor uuid,p_command jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare typ text:=p_command->>'type';a public.dmcrm_staff%rowtype;iv public.dmcrm_inventory%rowtype;t public.dmcrm_trades%rowtype;
 rid uuid:=(p_command->>'id')::uuid;vid uuid;why text:=trim(coalesce(p_command->>'reason',''));event_key text;
begin
 select st.* into a from public.dmcrm_staff st join public.dmcrm_members m on m.org_id=st.org_id and m.user_id=st.user_id
 where st.org_id=p_org and st.user_id=p_actor and st.active and m.active for share of st,m;
 if a.id is null then raise exception 'CRM membership required' using errcode='42501';end if;
 perform set_config('dmcrm.actor_id',p_actor::text,true);
 -- Serialize stock/deal changes against deletion, including the legacy wrappers.
 if typ in('delete_inventory','delete_trade_intake','save_inventory','create_customer','update_customer','create_opportunity','update_opportunity','close_opportunity','mark_sold','unwind_sale','update_trade_intake','convert_quick_quote') then
  perform pg_advisory_xact_lock(hashtextextended('dmcrm-stock:'||p_org::text,0));
 end if;
 if typ='review_attention' then
  event_key:=(p_command->>'kind')||':'||rid;
  if p_command->>'kind' not in('reply','failed','lead') or not exists(select 1 from public.dmcrm_attention_items(p_org,p_actor) e where e.key=event_key) then
   raise exception 'This alert is no longer available. Refresh the attention feed.' using errcode='42501';end if;
  insert into public.dmcrm_attention_reads(org_id,actor,alert_key) values(p_org,p_actor,event_key) on conflict do nothing;
  return rid;
 end if;
 if typ='save_inventory' and exists(select 1 from public.dmcrm_inventory where org_id=p_org and id=rid and deleted_at is not null) then
  raise exception 'This vehicle was deleted. Refresh and select another vehicle.';end if;
 if typ='update_trade_intake' and exists(select 1 from public.dmcrm_trades where org_id=p_org and id=rid and deleted_at is not null) then
  raise exception 'This trade was deleted. Refresh the trade list.';end if;
 if typ in('delete_inventory','delete_trade_intake') then
  if a.role not in('owner','manager') then raise exception 'Manager access required' using errcode='42501';end if;
  if length(why) not between 3 and 2000 then raise exception 'Enter a reason for deleting this vehicle';end if;
  if typ='delete_inventory' then
   vid:=rid;
   if exists(select 1 from public.dmcrm_trades where org_id=p_org and inventory_id=vid and deleted_at is null and status<>'returned') then
    raise exception 'Delete this vehicle from Trade-ins to also remove its intake record.';end if;
  else
   select * into t from public.dmcrm_trades where org_id=p_org and id=rid and deleted_at is null for update;
   if t.id is null then raise exception 'Trade unavailable' using errcode='42501';end if;
   if t.revision is distinct from (p_command->>'revision')::integer then raise exception 'Trade changed in another session. Reload before saving.';end if;
   if t.status='wholesaled' then raise exception 'A completed wholesale sale cannot be deleted.';end if;
   -- A returned trade may share a historical identity with a later intake.
   if t.status<>'returned' then vid:=t.inventory_id;end if;
  end if;
  if vid is not null then
   select * into iv from public.dmcrm_inventory where org_id=p_org and id=vid and deleted_at is null for update;
   if iv.id is null then raise exception 'Inventory unavailable' using errcode='42501';end if;
   if typ='delete_inventory' and iv.updated_at is distinct from (p_command->>'updated_at')::timestamptz then
    raise exception 'Vehicle changed in another session. Reload before deleting.';end if;
   if iv.status in('pending','sold') or exists(select 1 from public.dmcrm_opportunities where org_id=p_org and inventory_id=vid and status<>'lost') then
    raise exception 'This vehicle is attached to an active or sold deal. Resolve that deal before deleting.';end if;
   update public.dmcrm_inventory set deleted_at=now(),deleted_by=p_actor,deletion_reason=why,status='archived',updated_at=now() where org_id=p_org and id=vid;
  end if;
  if typ='delete_trade_intake' then
   update public.dmcrm_trades set deleted_at=now(),deleted_by=p_actor,deletion_reason=why,revision=revision+1 where org_id=p_org and id=t.id;
   insert into public.dmcrm_activities(org_id,customer_id,opportunity_id,kind,body,created_by)
    values(p_org,t.customer_id,t.opportunity_id,'system','Trade-in '||t.stock_number||' deleted: '||why||'. Original sale and trade accounting retained.',a.name);
  else
   insert into public.dmcrm_activities(org_id,customer_id,opportunity_id,kind,body,created_by)
    select p_org,o.customer_id,o.id,'system','Inventory vehicle '||iv.stock_number||' deleted: '||why,a.name from public.dmcrm_opportunities o where o.org_id=p_org and o.inventory_id=vid;
  end if;
  insert into public.dmcrm_audit(org_id,actor,action,record_id) values(p_org,p_actor,typ,rid);
  return rid;
 end if;
 return public.dmcrm_command_v10(p_org,p_actor,p_command);
end $$;
revoke all on function public.dmcrm_command(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.dmcrm_command(uuid,uuid,jsonb) to service_role;

-- Preserve sold/unwind accounting while excluding deleted stock from reuse.
create or replace function public.dmcrm_record_sale(p_org uuid,p_opportunity uuid,p_recover boolean default false) returns uuid language plpgsql security definer set search_path='' as $$
declare o public.dmcrm_opportunities%rowtype;s public.dmcrm_sales%rowtype;q jsonb;t jsonb;v jsonb;stock text;
begin
 select * into o from public.dmcrm_opportunities where org_id=p_org and id=p_opportunity for update;
 if o.status<>'sold' then return null;end if;
 select * into s from public.dmcrm_sales where org_id=p_org and opportunity_id=o.id and status='sold';
 if s.id is not null then return s.id;end if;
 q:=nullif(o.sale_snapshot->'quote','null');
 insert into public.dmcrm_sales(org_id,opportunity_id,customer_id,sold_on,snapshot)
 values(p_org,o.id,o.customer_id,o.sold_on,jsonb_build_object('customer',coalesce(o.sale_snapshot->'customer',(select to_jsonb(c) from public.dmcrm_customers c where c.org_id=p_org and c.id=o.customer_id)),
 'opportunity',to_jsonb(o),'quote',q,'salesperson',o.sale_snapshot->'salesperson')) returning * into s;
 t:=coalesce(nullif(q->'trade_snapshot','null'),o.trade);
 if t is not null and t<>'null'::jsonb then
  -- Serialize intake by VIN. Historical backfill preserves every original deal;
  -- inventory uniqueness still requires staff to resolve any legacy duplicates.
  perform pg_advisory_xact_lock(hashtextextended(p_org::text||':'||(t->>'vin'),0));
  if not p_recover and exists(select 1 from public.dmcrm_trades tr left join public.dmcrm_inventory i on i.org_id=tr.org_id and i.id=tr.inventory_id
   where tr.org_id=p_org and tr.deleted_at is null and tr.vin=t->>'vin' and (tr.status in('received','wholesale') or (tr.status='retail' and i.status not in('sold','archived')))) then
   raise exception 'This trade is already in intake. Review its existing disposition first.';
  end if;
  v:=coalesce(nullif(q->'vehicle_details','null'),o.vehicle_details);
  stock:=coalesce(nullif(v->>'stock_number',''),(select stock_number from public.dmcrm_inventory where org_id=p_org and id=o.inventory_id),'TR-'||upper(substr(s.id::text,1,8)))||'A';
  insert into public.dmcrm_trades(org_id,sale_id,opportunity_id,customer_id,stock_number,vin,year,make,model,trim,mileage,cost,acquired_on,allowance,acv,payoff)
  values(p_org,s.id,o.id,o.customer_id,stock,t->>'vin',(t->>'year')::integer,coalesce(t->>'make',''),coalesce(t->>'model',''),coalesce(t->>'trim',''),(t->>'mileage')::integer,
   (t->>'acv')::numeric,o.sold_on,(t->>'allowance')::numeric,(t->>'acv')::numeric,(t->>'payoff')::numeric);
 end if;
 return s.id;
end $$;

create or replace function public.dmcrm_command_v5(p_org uuid,p_actor uuid,p_command jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare typ text:=p_command->>'type';a public.dmcrm_staff%rowtype;o public.dmcrm_opportunities%rowtype;s public.dmcrm_sales%rowtype;
 t public.dmcrm_trades%rowtype;iv public.dmcrm_inventory%rowtype;msg public.dmcrm_messages%rowtype;
 rid uuid;sid uuid;vid uuid;data jsonb;item jsonb;old_item public.dmcrm_commissions%rowtype;total numeric;manager boolean;old_status text;today date:=(now() at time zone 'America/New_York')::date;
begin
 select st.* into a from public.dmcrm_staff st join public.dmcrm_members m on m.org_id=st.org_id and m.user_id=st.user_id where st.org_id=p_org and st.user_id=p_actor and st.active and m.active for share of st,m;
 if a.id is null then raise exception 'CRM membership required' using errcode='42501';end if;
 manager:=a.role in('owner','manager');
 perform set_config('dmcrm.actor_id',p_actor::text,true);
 if typ in('unwind_sale','save_accounting','update_trade_intake') and not manager then raise exception 'Manager access required' using errcode='42501';end if;
 if typ='unwind_sale' then
  if length(trim(coalesce(p_command->>'reason',''))) not between 3 and 2000 then raise exception 'Enter an unwind reason';end if;
  select * into o from public.dmcrm_opportunities where org_id=p_org and id=(p_command->>'opportunity_id')::uuid for update;
  if o.id is null then raise exception 'Opportunity unavailable' using errcode='42501';end if;
  select * into s from public.dmcrm_sales where org_id=p_org and opportunity_id=o.id and status='sold' for update;
  if s.id is null or o.status<>'sold' then raise exception 'Only a currently sold deal can be unwound';end if;
  select * into t from public.dmcrm_trades where org_id=p_org and sale_id=s.id for update;
  if t.status='wholesaled' then raise exception 'This trade was sold wholesale. Resolve its disposition before unwinding.';end if;
  if t.inventory_id is not null then
   select * into iv from public.dmcrm_inventory where org_id=p_org and id=t.inventory_id for update;
   if iv.status in('sold','pending') or exists(select 1 from public.dmcrm_opportunities where org_id=p_org and inventory_id=iv.id and status not in('lost')) then
    raise exception 'This trade is attached to another opportunity. Resolve that deal before unwinding.';
   end if;
   update public.dmcrm_inventory set status='archived',updated_at=now() where org_id=p_org and id=iv.id;
  end if;
  if o.inventory_id is not null then
   perform 1 from public.dmcrm_inventory where org_id=p_org and id=o.inventory_id for update;
   if exists(select 1 from public.dmcrm_opportunities where org_id=p_org and inventory_id=o.inventory_id and status='sold' and id<>o.id) then raise exception 'This inventory vehicle belongs to another sold deal';end if;
   update public.dmcrm_inventory set status='in_stock',updated_at=now() where org_id=p_org and id=o.inventory_id;
  end if;
  update public.dmcrm_trades set status='returned',revision=revision+1 where org_id=p_org and sale_id=s.id;
  update public.dmcrm_sales set status='unwound',unwound_at=now(),unwound_by=p_actor,unwind_reason=trim(p_command->>'reason'),revision=revision+1 where id=s.id;
  update public.dmcrm_tasks set canceled_at=case when completed_at is null and canceled_at is null then now() else canceled_at end,
   origin_key=case when origin_key is null then null else origin_key||':unwound:'||s.id end where org_id=p_org and opportunity_id=o.id and kind in('sold_followup','anniversary');
  update public.dmcrm_visits set outcome='unsold' where org_id=p_org and opportunity_id=o.id and outcome='sold';
  update public.dmcrm_opportunities set status='working',sold_on=null,closed_at=null,sale_snapshot=null,lost_reason='',paperwork='{}',paperwork_revision=paperwork_revision+1,updated_at=now() where org_id=p_org and id=o.id;
  insert into public.dmcrm_tasks(org_id,customer_id,opportunity_id,assigned_to,title,due_date,kind,origin_key) values(p_org,o.customer_id,o.id,o.assigned_to,'Follow up after unwound deal',today+1,'unsold_followup','unwind:'||s.id);
  insert into public.dmcrm_activities(org_id,customer_id,opportunity_id,kind,body,created_by) values(p_org,o.customer_id,o.id,'system','Sold deal unwound: '||trim(p_command->>'reason')||'. Vehicle returned to inventory; original sale retained in deal history.',a.name);
  rid:=o.id;
 elsif typ='save_accounting' then
  select * into s from public.dmcrm_sales where org_id=p_org and id=(p_command->>'sale_id')::uuid for update;
  if s.id is null then raise exception 'Sale unavailable' using errcode='42501';end if;
  if s.status<>'sold' then raise exception 'Unwound accounting is retained read-only';end if;
  if s.revision<>(p_command->>'revision')::integer then raise exception 'Accounting changed in another session. Reload before saving.';end if;
  data:=p_command->'accounting';
  if jsonb_typeof(data)<>'object' or jsonb_typeof(p_command->'commissions')<>'array' or jsonb_array_length(p_command->'commissions')>50 then raise exception 'Invalid accounting';end if;
  for item in select value from jsonb_each(data) where key in('vehicle_cost','recon','accessory_cost','other_cost','finance_reserve','pack','legacy_product_cost') loop
   if item<>'null' and ((item::text)::numeric<0 or (item::text)::numeric>1000000) then raise exception 'Invalid accounting amount';end if;
  end loop;
  if (select count(*) from jsonb_array_elements(p_command->'commissions'))<>(select count(distinct value->>'id') from jsonb_array_elements(p_command->'commissions')) then raise exception 'Duplicate commission entry';end if;
  for old_item in select * from public.dmcrm_commissions where org_id=p_org and sale_id=s.id and paid_amount>0 loop
   select value into item from jsonb_array_elements(p_command->'commissions') where value->>'id'=old_item.id::text;
   if item is null or (item->>'paid_amount')::numeric<old_item.paid_amount or item->>'staff_id'<>old_item.staff_id::text then raise exception 'Previously paid commissions must be retained';end if;
  end loop;
  insert into public.dmcrm_accounting_history(org_id,sale_id,actor,accounting,commissions,revision)
  values(p_org,s.id,p_actor,s.accounting,coalesce((select jsonb_agg(to_jsonb(c)) from public.dmcrm_commissions c where c.org_id=p_org and c.sale_id=s.id),'[]'),s.revision);
  for item in select value from jsonb_array_elements(p_command->'commissions') loop
   if not exists(select 1 from public.dmcrm_staff where org_id=p_org and id=(item->>'staff_id')::uuid) then raise exception 'Select a dealership team member';end if;
   if exists(select 1 from public.dmcrm_commissions where id=(item->>'id')::uuid and (org_id<>p_org or sale_id<>s.id)) then raise exception 'Commission unavailable' using errcode='42501';end if;
   insert into public.dmcrm_commissions(id,org_id,sale_id,staff_id,staff_name,category,amount,paid_amount,paid_on,notes)
   values((item->>'id')::uuid,p_org,s.id,(item->>'staff_id')::uuid,(select name from public.dmcrm_staff where org_id=p_org and id=(item->>'staff_id')::uuid),item->>'category',(item->>'amount')::numeric,(item->>'paid_amount')::numeric,nullif(item->>'paid_on','')::date,coalesce(item->>'notes',''))
   on conflict(id) do update set staff_id=excluded.staff_id,staff_name=excluded.staff_name,category=excluded.category,amount=excluded.amount,paid_amount=excluded.paid_amount,paid_on=excluded.paid_on,notes=excluded.notes;
  end loop;
  delete from public.dmcrm_commissions where org_id=p_org and sale_id=s.id and id not in(select (value->>'id')::uuid from jsonb_array_elements(p_command->'commissions'));
  update public.dmcrm_sales set accounting=data,revision=revision+1 where org_id=p_org and id=s.id;
  insert into public.dmcrm_activities(org_id,customer_id,opportunity_id,kind,body,created_by) values(p_org,s.customer_id,s.opportunity_id,'system','Deal accounting and commissions updated',a.name);rid:=s.id;
 elsif typ='update_trade_intake' then
  select * into t from public.dmcrm_trades where org_id=p_org and id=(p_command->>'id')::uuid for update;
  if t.id is null or t.deleted_at is not null then raise exception 'Trade unavailable' using errcode='42501';end if;
  if t.status in('returned','wholesaled') then raise exception 'This trade disposition is read-only';end if;
  if t.revision<>(p_command->>'revision')::integer then raise exception 'Trade changed in another session. Reload before saving.';end if;
  data:=p_command->'trade';vid:=t.inventory_id;
  -- A resold deal may receive a previously returned trade again. Reuse only
  -- its archived inventory identity; preserve both sale/intake histories.
  if vid is null and data->>'status'='retail' then
   select i.id into vid from public.dmcrm_inventory i where i.org_id=p_org and i.deleted_at is null and i.vin=t.vin and i.status='archived'
    and exists(select 1 from public.dmcrm_trades old where old.org_id=p_org and old.inventory_id=i.id and old.status='returned')
    and not exists(select 1 from public.dmcrm_opportunities op where op.org_id=p_org and op.inventory_id=i.id and op.status<>'lost') for update;
  end if;
  if data->>'status' not in('received','retail','wholesale','wholesaled') then raise exception 'Invalid trade disposition';end if;
  if vid is not null then
   select * into iv from public.dmcrm_inventory where org_id=p_org and id=vid for update;
   if iv.status in('sold','pending') then raise exception 'Edit this vehicle through its current inventory or deal';end if;
   if data->>'status'<>'retail' and exists(select 1 from public.dmcrm_opportunities where org_id=p_org and inventory_id=vid and status not in('lost')) then raise exception 'This trade is attached to another opportunity';end if;
  end if;
  if data->>'status'='retail' then
   if nullif(data->>'year','') is null or trim(coalesce(data->>'make',''))='' or trim(coalesce(data->>'model',''))='' then raise exception 'Complete the vehicle details before moving to inventory';end if;
   if exists(select 1 from public.dmcrm_inventory where org_id=p_org and deleted_at is null and (vin=t.vin or lower(stock_number)=lower(data->>'stock_number')) and id is distinct from vid) then raise exception 'Trade VIN or stock number already exists in inventory. Review the existing vehicle first.';end if;
   rid:=public.dmcrm_command_v4(p_org,p_actor,jsonb_build_object('type','save_inventory','vehicle',data||jsonb_build_object('vin',t.vin,'acquired_on',t.acquired_on,'status','in_stock'))||case when vid is null then '{}'::jsonb else jsonb_build_object('id',vid) end);
   vid:=rid;
  elsif vid is not null then update public.dmcrm_inventory set status='archived',updated_at=now() where org_id=p_org and id=vid;end if;
  update public.dmcrm_trades set stock_number=trim(data->>'stock_number'),year=(data->>'year')::integer,make=data->>'make',model=data->>'model',trim=data->>'trim',mileage=(data->>'mileage')::integer,color=data->>'color',cost=(data->>'cost')::numeric,recon=(data->>'recon')::numeric,price=(data->>'price')::numeric,status=data->>'status',inventory_id=vid,
   wholesale_price=case when data->>'status'='wholesaled' then (data->>'wholesale_price')::numeric end,wholesale_on=case when data->>'status'='wholesaled' then nullif(data->>'wholesale_on','')::date end,notes=data->>'notes',revision=revision+1 where org_id=p_org and id=t.id;
  insert into public.dmcrm_activities(org_id,customer_id,opportunity_id,kind,body,created_by) values(p_org,t.customer_id,t.opportunity_id,'system','Trade-in '||(data->>'stock_number')||' disposition: '||(data->>'status'),a.name);rid:=t.id;
 elsif typ in('save_message','delete_message_draft') then
  select * into msg from public.dmcrm_messages where org_id=p_org and id=(p_command->>'id')::uuid for update;
  if msg.id is not null and (msg.status<>'draft' or (msg.created_by<>p_actor and not manager)) then raise exception 'Only your unsent drafts can be edited' using errcode='42501';end if;
  if msg.id is not null and msg.revision<>(p_command->>'revision')::integer then raise exception 'Draft changed in another session. Reload before saving.';end if;
  if typ='delete_message_draft' then
   if msg.id is null then raise exception 'Draft unavailable';end if;
   update public.dmcrm_messages set status='canceled',updated_at=now(),revision=revision+1 where org_id=p_org and id=msg.id;rid:=msg.id;
  else
   if not exists(select 1 from public.dmcrm_customers where org_id=p_org and id=(p_command->>'customer_id')::uuid) then raise exception 'Customer unavailable' using errcode='42501';end if;
   if msg.id is not null and (msg.customer_id<>(p_command->>'customer_id')::uuid or msg.channel<>p_command->>'channel') then raise exception 'Draft customer and channel cannot change';end if;
   if p_command->>'task_id' is not null and not exists(select 1 from public.dmcrm_tasks where org_id=p_org and id=(p_command->>'task_id')::uuid and customer_id=(p_command->>'customer_id')::uuid and (manager or assigned_to=a.id)) then raise exception 'Task unavailable' using errcode='42501';end if;
   if p_command->>'quote_id' is not null and not exists(select 1 from public.dmcrm_quotes where org_id=p_org and id=(p_command->>'quote_id')::uuid and customer_id=(p_command->>'customer_id')::uuid and opportunity_id is not distinct from (p_command->>'opportunity_id')::uuid) then raise exception 'Quote unavailable' using errcode='42501';end if;
   insert into public.dmcrm_messages(id,org_id,customer_id,opportunity_id,task_id,quote_id,channel,recipient,subject,body,created_by)
   values((p_command->>'id')::uuid,p_org,(p_command->>'customer_id')::uuid,(p_command->>'opportunity_id')::uuid,(p_command->>'task_id')::uuid,(p_command->>'quote_id')::uuid,p_command->>'channel',p_command->>'recipient',coalesce(p_command->>'subject',''),p_command->>'body',p_actor)
   on conflict(id) do update set opportunity_id=excluded.opportunity_id,task_id=excluded.task_id,quote_id=excluded.quote_id,recipient=excluded.recipient,subject=excluded.subject,body=excluded.body,updated_at=now(),revision=dmcrm_messages.revision+1
    where dmcrm_messages.org_id=p_org and dmcrm_messages.status='draft' and (dmcrm_messages.created_by=p_actor or manager) and dmcrm_messages.revision=(p_command->>'revision')::integer and dmcrm_messages.customer_id=excluded.customer_id and dmcrm_messages.channel=excluded.channel returning id into rid;
   if rid is null then raise exception 'Draft unavailable' using errcode='42501';end if;
  end if;
 else
  if typ='save_quote' then p_command:=jsonb_set(p_command,'{values}',public.dmcrm_fi_values(p_command->'values'));end if;
  rid:=public.dmcrm_command_v4(p_org,p_actor,p_command);
  if typ='save_quote' and p_command->'values' ? 'fiMenu' then
   -- Snapshot the actual customer identity; do not trust copied/client names.
   update public.dmcrm_quotes q set values=jsonb_set(q.values,'{fiMenu}',(q.values->'fiMenu')||jsonb_build_object(
     'customer_name',c.name,'co_buyer_name',trim(concat_ws(' ',c.co_buyer->>'first_name',nullif(c.co_buyer->>'middle_name',''),c.co_buyer->>'last_name',nullif(c.co_buyer->>'suffix','')))))
    from public.dmcrm_customers c where q.org_id=p_org and q.id=rid and c.org_id=q.org_id and c.id=q.customer_id;
   if (p_command->'values'->'fiMenu'->'selected')<>'null'::jsonb then
    update public.dmcrm_opportunities menu_op set paperwork=public.dmcrm_fi_paperwork(menu_op.paperwork),paperwork_revision=menu_op.paperwork_revision+1
     from public.dmcrm_quotes q where q.org_id=p_org and q.id=rid and menu_op.org_id=q.org_id and menu_op.id=q.opportunity_id and menu_op.paperwork is distinct from public.dmcrm_fi_paperwork(menu_op.paperwork);
   end if;
   insert into public.dmcrm_activities(org_id,customer_id,opportunity_id,kind,body,created_by)
    select p_org,q.customer_id,q.opportunity_id,'system',case when p_command->'values'->'fiMenu'->'selected'='null'::jsonb then 'F&I menu saved; selection pending'
      when p_command->'values'->'fiMenu'->>'selected'='declined' then 'F&I menu applied: all optional products declined'
      else 'F&I menu applied: '||(p_command->'values'->'fiMenu'->'packages'->((p_command->'values'->'fiMenu'->>'selected')::int)->>'name') end,a.name
    from public.dmcrm_quotes q where q.org_id=p_org and q.id=rid;
  end if;
  if typ in('close_opportunity','mark_sold') then perform public.dmcrm_record_sale(p_org,rid);end if;
  if typ='create_task' then update public.dmcrm_tasks set channel=coalesce(p_command->>'channel','call') where org_id=p_org and id=rid;end if;
  if typ='complete_task' then
   update public.dmcrm_tasks n set channel=old.channel from public.dmcrm_tasks old where old.org_id=p_org and old.id=(p_command->>'id')::uuid and old.kind in('birthday','anniversary') and n.org_id=p_org and n.customer_id=old.customer_id and n.opportunity_id is not distinct from old.opportunity_id and n.kind=old.kind and n.completed_at is null and n.canceled_at is null;
  end if;
  return rid;
 end if;
 insert into public.dmcrm_audit(org_id,actor,action,record_id) values(p_org,p_actor,typ,rid);
 return rid;
end $$;
revoke all on function public.dmcrm_command_v5(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
