create table public.dmcrm_service_orders (
 id uuid primary key,org_id uuid not null references public.dmcrm_orgs(id),order_number bigint generated always as identity unique,
 kind text not null check(kind in('reconditioning','we_owe','customer_pay','warranty')),
 customer_id uuid,opportunity_id uuid,inventory_id uuid,customer_name text not null default '',
 vehicle text not null check(length(trim(vehicle)) between 1 and 250),vin text not null default '' check(vin='' or vin ~ '^[A-HJ-NPR-Z0-9]{17}$'),stock_number text not null default '' check(length(stock_number)<=250),
 mileage integer check(mileage between 0 and 3000000),assigned_to uuid,vendor text not null default '' check(length(vendor)<=250),due_on date,
 concern text not null check(length(trim(concern)) between 1 and 4000),findings text not null default '' check(length(findings)<=4000),internal_notes text not null default '' check(length(internal_notes)<=4000),
 items jsonb not null check(jsonb_typeof(items)='array' and jsonb_array_length(items) between 1 and 50),tax numeric(12,2) not null default 0 check(tax between 0 and 1000000),
 status text not null default 'draft' check(status in('draft','awaiting_approval','approved','in_progress','waiting_parts','ready','completed','canceled')),
 "authorization" jsonb,revision integer not null default 1 check(revision>0),created_by uuid not null,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),completed_at timestamptz,canceled_reason text not null default '',
 unique(org_id,id),foreign key(org_id,customer_id) references public.dmcrm_customers(org_id,id),foreign key(org_id,opportunity_id) references public.dmcrm_opportunities(org_id,id),
 foreign key(org_id,inventory_id) references public.dmcrm_inventory(org_id,id),foreign key(org_id,assigned_to) references public.dmcrm_staff(org_id,id),
 check((kind='reconditioning' and inventory_id is not null) or (kind<>'reconditioning' and customer_id is not null))
);
create index on public.dmcrm_service_orders(org_id,customer_id);
create index on public.dmcrm_service_orders(org_id,inventory_id,status);
create table public.dmcrm_service_receipts (
 id uuid primary key,org_id uuid not null references public.dmcrm_orgs(id),order_id uuid not null,amount numeric(12,2) not null check(amount>0 and amount<=1000000),received_on date not null,
 method text not null check(method in('Cash','Check','Card','ACH','Other')),reference text not null default '' check(length(reference)<=250),notes text not null default '' check(length(notes)<=4000),
 reversal_of uuid unique references public.dmcrm_service_receipts(id),created_by uuid not null,created_at timestamptz not null default now(),foreign key(org_id,order_id) references public.dmcrm_service_orders(org_id,id)
);
create index on public.dmcrm_service_receipts(org_id,order_id);
create table public.dmcrm_saved_reports (
 id uuid primary key,org_id uuid not null references public.dmcrm_orgs(id),name text not null check(length(trim(name)) between 1 and 100),definition jsonb not null,schedule jsonb not null,archived boolean not null default false,
 revision integer not null default 1 check(revision>0),created_by uuid not null,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),next_run_at timestamptz,unique(org_id,id)
);
create table public.dmcrm_report_runs (
 id uuid primary key default gen_random_uuid(),org_id uuid not null,report_id uuid not null,report_revision integer not null,name text not null,definition jsonb not null,
 scheduled_for timestamptz not null,trigger text not null check(trigger in('manual','scheduled')),state text not null default 'pending' check(state in('pending','running','completed','failed','canceled')),
 attempts integer not null default 0,lease_id uuid,leased_at timestamptz,snapshot jsonb,error text not null default '',created_at timestamptz not null default now(),completed_at timestamptz,
 foreign key(org_id,report_id) references public.dmcrm_saved_reports(org_id,id)
);
create unique index on public.dmcrm_report_runs(report_id,scheduled_for) where trigger='scheduled';
create index on public.dmcrm_report_runs(org_id,state,created_at);
create table public.dmcrm_management_events (
 id uuid primary key,org_id uuid not null references public.dmcrm_orgs(id),subject_id uuid not null,action text not null,command jsonb not null,before_value jsonb,created_by uuid not null,created_at timestamptz not null default now()
);
create index on public.dmcrm_management_events(org_id,subject_id);
create trigger dmcrm_service_receipts_immutable before update or delete on public.dmcrm_service_receipts for each row execute function public.dmcrm_business_immutable();
create trigger dmcrm_management_events_immutable before update or delete on public.dmcrm_management_events for each row execute function public.dmcrm_business_immutable();
do $$declare t text;begin foreach t in array array['service_orders','service_receipts','saved_reports','report_runs','management_events'] loop
 execute format('alter table public.dmcrm_%I enable row level security',t);
 execute format('revoke all on public.dmcrm_%I from public,anon,authenticated',t);
 execute format('grant all on public.dmcrm_%I to service_role',t);
end loop;end $$;
grant usage,select on sequence public.dmcrm_service_orders_order_number_seq to service_role;

create function public.dmcrm_service_amount(p_items jsonb,p_key text) returns numeric language sql immutable set search_path='' as $$
 select case when p_key='actual_cost' and exists(select 1 from jsonb_array_elements(p_items) i where i->>p_key is null) then null
 else coalesce((select sum(round((i->>'quantity')::numeric*(i->>p_key)::numeric,2)) from jsonb_array_elements(p_items) i),0) end
$$;
create function public.dmcrm_service_scope(p_value jsonb) returns jsonb language sql immutable set search_path='' as $$
 select jsonb_build_object('kind',p_value->'kind','customer_id',p_value->'customer_id','inventory_id',p_value->'inventory_id','opportunity_id',p_value->'opportunity_id','vehicle',p_value->'vehicle','vin',p_value->'vin','concern',p_value->'concern','tax',p_value->'tax',
 'items',(select jsonb_agg(i-'actual_cost' order by n) from jsonb_array_elements(p_value->'items') with ordinality a(i,n)))
$$;
create function public.dmcrm_report_next_run(p_schedule jsonb,p_after timestamptz) returns timestamptz language plpgsql immutable set search_path='' as $$
declare d date:=(p_after at time zone 'America/New_York')::date;c timestamptz;i integer;f text:=p_schedule->>'frequency';begin
 if f='off' then return null;end if;
 for i in 0..39 loop
  if (f<>'weekly' or extract(dow from d+i)::integer=(p_schedule->>'weekday')::integer) and (f<>'monthly' or extract(day from d+i)::integer=(p_schedule->>'month_day')::integer) then
   c:=((d+i)+(make_time((p_schedule->>'hour')::integer,(p_schedule->>'minute')::integer,0))) at time zone 'America/New_York';
   if c>p_after then return c;end if;
  end if;
 end loop;
 raise exception 'Report settings are invalid.';
end $$;

alter function public.dmcrm_command(uuid,uuid,jsonb) rename to dmcrm_command_before_management;
create function public.dmcrm_command(p_org uuid,p_actor uuid,p_command jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare typ text:=p_command->>'type';rid uuid:=(p_command->>'request_id')::uuid;sid uuid:=(p_command->>'id')::uuid;eid uuid;v jsonb;i jsonb;before_value jsonb;estimate numeric;actual numeric;paid numeric;total numeric;v_recon numeric;
 o public.dmcrm_service_orders%rowtype;n public.dmcrm_service_orders%rowtype;r public.dmcrm_saved_reports%rowtype;e public.dmcrm_management_events%rowtype;receipt public.dmcrm_service_receipts%rowtype;inv public.dmcrm_inventory%rowtype;
 today date:=(now() at time zone 'America/New_York')::date;who text;result uuid;
begin
 if typ not in('save_service_order','authorize_service_order','set_service_status','record_service_receipt','reverse_service_receipt','apply_service_recon','save_management_report','queue_management_report') then
  result:=public.dmcrm_command_before_management(p_org,p_actor,p_command);
  if typ='merge_customers' then
   update public.dmcrm_service_orders set customer_id=(p_command->>'target_id')::uuid,revision=revision+1,updated_at=now() where org_id=p_org and customer_id=(p_command->>'source_id')::uuid;
  end if;
  return result;
 end if;
 if not exists(select 1 from public.dmcrm_members m join public.dmcrm_staff st on st.org_id=m.org_id and st.user_id=m.user_id where m.org_id=p_org and m.user_id=p_actor and m.active and st.active and m.role in('owner','manager')) then raise exception 'Manager access required' using errcode='42501';end if;
 if rid is null then raise exception 'Request key required';end if;
 perform pg_advisory_xact_lock(hashtextextended('dmcrm:management:'||p_org::text,0));
 select * into e from public.dmcrm_management_events where id=rid;
 if found then
  if e.org_id=p_org and e.created_by=p_actor and e.command=p_command then return e.subject_id;end if;
  raise exception 'Use a new request key for changed details.';
 end if;
 if typ='apply_service_recon' then
  sid:=(p_command->>'inventory_id')::uuid;
  select * into inv from public.dmcrm_inventory where id=sid and org_id=p_org for update;
  if inv.id is null or inv.status not in('in_stock','pending') or inv.deleted_at is not null then raise exception 'Only available inventory recon can be updated.';end if;
  if inv.updated_at is distinct from (p_command->>'expected_updated_at')::timestamptz then raise exception 'Record changed. Refresh before saving.';end if;
  if not exists(select 1 from public.dmcrm_service_orders where org_id=p_org and inventory_id=sid and kind='reconditioning' and status='completed') then raise exception 'Complete a recon order before applying costs.';end if;
  if jsonb_typeof(p_command->'other_costs') is distinct from 'number' or (p_command->>'other_costs')::numeric not between 0 and 1000000 or round((p_command->>'other_costs')::numeric,2)<>(p_command->>'other_costs')::numeric then raise exception 'Order details are invalid.';end if;
  select sum(public.dmcrm_service_amount(items,'actual_cost'))+(p_command->>'other_costs')::numeric into v_recon from public.dmcrm_service_orders where org_id=p_org and inventory_id=sid and kind='reconditioning' and status='completed';
  if v_recon>1000000 then raise exception 'Order details are invalid.';end if;
  before_value:=to_jsonb(inv);
  update public.dmcrm_inventory set recon=v_recon,updated_at=now() where id=sid;
 elsif typ in('save_management_report','queue_management_report') then
  select * into r from public.dmcrm_saved_reports where id=sid for update;
  if r.id is not null and r.org_id<>p_org then raise exception 'Record unavailable.' using errcode='42501';end if;
  if coalesce(r.revision,0) is distinct from (p_command->>'revision')::integer then raise exception 'Record changed. Refresh before saving.';end if;
  before_value:=case when r.id is null then null else to_jsonb(r) end;
  if typ='save_management_report' then
   v:=p_command->'definition';i:=p_command->'schedule';
   if coalesce(v->>'kind','') not in('overview','funding','inventory','salespeople','followup','service') or coalesce(v->>'period','') not in('month_to_date','last_month','last_7_days','last_30_days','yesterday','custom')
    or coalesce(i->>'frequency','') not in('off','daily','weekly','monthly') or coalesce((i->>'hour')::integer,0) not between 6 and 20 or coalesce((i->>'minute')::integer,-1) not in(0,15,30,45)
    or coalesce((i->>'weekday')::integer,-1) not between 0 and 6 or coalesce((i->>'month_day')::integer,0) not between 1 and 28
    or coalesce((v->>'min_age')::integer,-1) not between 0 and 3650 or length(coalesce(v->>'source',''))>80
    or jsonb_typeof(v->'metrics') is distinct from 'array' or jsonb_array_length(v->'metrics') not between 1 and 9
    or exists(select 1 from jsonb_array_elements_text(v->'metrics') k where k not in('sold','gross','pvr','leads','funding','aged','tasks','repairs','promises'))
    or jsonb_typeof(v->'no_appointments') is distinct from 'boolean' or jsonb_typeof(v->'overdue_only') is distinct from 'boolean'
    or (v->>'unit_target')::numeric not between 0 and 10000 or (v->>'gross_target')::numeric not between 0 and 10000000
    or (v->>'period'='custom' and (v->>'from' is null or v->>'to' is null or (v->>'from')::date>(v->>'to')::date or (v->>'to')::date-(v->>'from')::date>366))
    then raise exception 'Report settings are invalid.';end if;
   if v->>'staff_id' is not null and not exists(select 1 from public.dmcrm_staff where id=(v->>'staff_id')::uuid and org_id=p_org) then raise exception 'Select an active team member.';end if;
   if r.id is null and (select count(*) from public.dmcrm_saved_reports where org_id=p_org)>=100 then raise exception 'Too many saved reports.';end if;
   insert into public.dmcrm_saved_reports(id,org_id,name,definition,schedule,archived,created_by,next_run_at) values(sid,p_org,p_command->>'name',v,i,(p_command->>'archived')::boolean,p_actor,case when (p_command->>'archived')::boolean then null else public.dmcrm_report_next_run(i,now()) end)
   on conflict(id) do update set name=excluded.name,definition=excluded.definition,schedule=excluded.schedule,archived=excluded.archived,created_by=p_actor,revision=dmcrm_saved_reports.revision+1,updated_at=now(),next_run_at=excluded.next_run_at;
   update public.dmcrm_report_runs set state='canceled',error='Report changed before completion',lease_id=null where report_id=sid and state in('pending','running','failed');
  else
   if r.id is null or r.archived then raise exception 'Record unavailable.';end if;
   insert into public.dmcrm_report_runs(id,org_id,report_id,report_revision,name,definition,scheduled_for,trigger) values((p_command->>'run_id')::uuid,p_org,sid,r.revision,r.name,r.definition,now(),'manual');
  end if;
 else
  select * into o from public.dmcrm_service_orders where id=sid for update;
  if o.id is not null and o.org_id<>p_org then raise exception 'Record unavailable.' using errcode='42501';end if;
  if coalesce(o.revision,0) is distinct from (p_command->>'revision')::integer then raise exception 'Record changed. Refresh before saving.';end if;
  before_value:=case when o.id is null then null else to_jsonb(o) end;
  if typ not in('record_service_receipt','reverse_service_receipt') and o.status in('completed','canceled') then raise exception 'Completed or canceled orders cannot be edited.';end if;
  select coalesce(sum(case when reversal_of is null then amount else -amount end),0) into paid from public.dmcrm_service_receipts where org_id=p_org and order_id=sid;
  if typ='save_service_order' then
   v:=p_command->'order';n:=jsonb_populate_record(null::public.dmcrm_service_orders,v);
   if n.kind is null or n.kind not in('reconditioning','we_owe','customer_pay','warranty') or n.items is null or jsonb_typeof(n.items)<>'array' or jsonb_array_length(n.items) not between 1 and 50 or n.tax is null or jsonb_typeof(v->'tax') is distinct from 'number' or round((v->>'tax')::numeric,2)<>(v->>'tax')::numeric then raise exception 'Order details are invalid.';end if;
   for i in select * from jsonb_array_elements(n.items) loop
    if i->>'id' is null or coalesce(i->>'kind','') not in('labor','parts','sublet','fee') or length(trim(coalesce(i->>'description',''))) not between 1 and 250
     or jsonb_typeof(i->'quantity') is distinct from 'number' or (i->>'quantity')::numeric not between 0.01 and 10000 or round((i->>'quantity')::numeric,2)<>(i->>'quantity')::numeric
     or jsonb_typeof(i->'estimated_cost') is distinct from 'number' or (i->>'estimated_cost')::numeric not between 0 and 1000000 or round((i->>'estimated_cost')::numeric,2)<>(i->>'estimated_cost')::numeric
     or jsonb_typeof(i->'price') is distinct from 'number' or (i->>'price')::numeric not between 0 and 1000000 or round((i->>'price')::numeric,2)<>(i->>'price')::numeric
     or (i->>'actual_cost' is not null and (jsonb_typeof(i->'actual_cost')<>'number' or (i->>'actual_cost')::numeric not between 0 and 1000000 or round((i->>'actual_cost')::numeric,2)<>(i->>'actual_cost')::numeric)) then raise exception 'Order details are invalid.';end if;
    perform (i->>'id')::uuid;
   end loop;
   if (select count(distinct item_value->>'id') from jsonb_array_elements(n.items) item_value)<>jsonb_array_length(n.items) then raise exception 'Order details are invalid.';end if;
   if greatest(public.dmcrm_service_amount(n.items,'estimated_cost'),public.dmcrm_service_amount(n.items,'actual_cost'),public.dmcrm_service_amount(n.items,'price')+n.tax)>1000000 then raise exception 'Order details are invalid.';end if;
   if (n.customer_id is not null and not exists(select 1 from public.dmcrm_customers where id=n.customer_id and org_id=p_org and merged_into is null))
    or (n.opportunity_id is not null and not exists(select 1 from public.dmcrm_opportunities where id=n.opportunity_id and org_id=p_org and customer_id=n.customer_id))
    or (n.inventory_id is not null and not exists(select 1 from public.dmcrm_inventory where id=n.inventory_id and org_id=p_org and deleted_at is null)) then raise exception 'Customer, deal, or vehicle link is invalid.';end if;
   if n.assigned_to is not null and not exists(select 1 from public.dmcrm_staff where id=n.assigned_to and org_id=p_org and active) then raise exception 'Select an active team member.';end if;
   if paid<>0 and (o.customer_id is distinct from n.customer_id or o.kind is distinct from n.kind) then raise exception 'Reverse receipts before canceling.';end if;
   select name into who from public.dmcrm_customers where id=n.customer_id and org_id=p_org;
   insert into public.dmcrm_service_orders(id,org_id,kind,customer_id,opportunity_id,inventory_id,customer_name,vehicle,vin,stock_number,mileage,assigned_to,vendor,due_on,concern,findings,items,tax,internal_notes,created_by)
   values(sid,p_org,n.kind,n.customer_id,n.opportunity_id,n.inventory_id,coalesce(who,''),n.vehicle,coalesce(n.vin,''),coalesce(n.stock_number,''),n.mileage,n.assigned_to,coalesce(n.vendor,''),n.due_on,n.concern,coalesce(n.findings,''),n.items,n.tax,coalesce(n.internal_notes,''),p_actor)
   on conflict(id) do update set kind=excluded.kind,customer_id=excluded.customer_id,opportunity_id=excluded.opportunity_id,inventory_id=excluded.inventory_id,customer_name=excluded.customer_name,vehicle=excluded.vehicle,vin=excluded.vin,stock_number=excluded.stock_number,mileage=excluded.mileage,assigned_to=excluded.assigned_to,vendor=excluded.vendor,due_on=excluded.due_on,concern=excluded.concern,findings=excluded.findings,items=excluded.items,tax=excluded.tax,internal_notes=excluded.internal_notes,revision=dmcrm_service_orders.revision+1,updated_at=now(),
    "authorization"=case when public.dmcrm_service_scope(to_jsonb(o))=public.dmcrm_service_scope(v) then o."authorization" else null end,
    status=case when o."authorization" is not null and public.dmcrm_service_scope(to_jsonb(o)) is distinct from public.dmcrm_service_scope(v) then 'awaiting_approval' else o.status end;
  else
   if o.id is null then raise exception 'Record unavailable.';end if;
   estimate:=public.dmcrm_service_amount(o.items,'estimated_cost');actual:=public.dmcrm_service_amount(o.items,'actual_cost');total:=public.dmcrm_service_amount(o.items,'price')+o.tax;
   if typ='authorize_service_order' then
    if length(trim(coalesce(p_command->>'by',''))) not between 1 and 250 or coalesce(p_command->>'method','') not in('in_person','phone','email','written','internal') or jsonb_typeof(p_command->'limit') is distinct from 'number' or (p_command->>'limit')::numeric not between 0 and 1000000 or round((p_command->>'limit')::numeric,2)<>(p_command->>'limit')::numeric then raise exception 'Order details are invalid.';end if;
    if (p_command->>'limit')::numeric < (case when o.kind='customer_pay' then total else greatest(estimate,coalesce(actual,0)) end) then raise exception 'Authorization must cover the estimate.';end if;
    update public.dmcrm_service_orders set "authorization"=jsonb_build_object('by',p_command->>'by','method',p_command->>'method','limit',(p_command->>'limit')::numeric,'notes',coalesce(p_command->>'notes',''),'at',now(),'actor',p_actor),status=case when status in('draft','awaiting_approval') then 'approved' else status end,revision=revision+1,updated_at=now() where id=sid;
   elsif typ='set_service_status' then
    who:=p_command->>'status';
    if coalesce(who,'') not in('draft','awaiting_approval','approved','in_progress','waiting_parts','ready','completed','canceled') then raise exception 'Order details are invalid.';end if;
    if who in('approved','in_progress','waiting_parts','ready','completed') and o."authorization" is null then raise exception 'Record authorization before starting work.';end if;
    if who='completed' and actual is null then raise exception 'Enter actual costs before completing the order.';end if;
    if who='completed' and (case when o.kind='customer_pay' then total else actual end)>(o."authorization"->>'limit')::numeric then raise exception 'Actual costs exceed the authorized budget. Record a new authorization.';end if;
    if who='canceled' and length(trim(coalesce(p_command->>'reason','')))<3 then raise exception 'Enter a cancellation reason.';end if;
    if who='canceled' and paid<>0 then raise exception 'Reverse receipts before canceling.';end if;
    update public.dmcrm_service_orders set status=who,revision=revision+1,updated_at=now(),completed_at=case when who='completed' then now() else null end,canceled_reason=case when who='canceled' then p_command->>'reason' else '' end,"authorization"=case when who in('draft','awaiting_approval') then null else "authorization" end where id=sid;
   else
    if o.kind<>'customer_pay' or o.status='canceled' then raise exception 'Receipts can only be recorded for customer-pay orders.';end if;
    if (p_command->>'received_on')::date>today then raise exception 'Receipt date cannot be in the future.';end if;
    eid:=(p_command->>'receipt_id')::uuid;
    if typ='record_service_receipt' then
     if jsonb_typeof(p_command->'amount') is distinct from 'number' or round((p_command->>'amount')::numeric,2)<>(p_command->>'amount')::numeric then raise exception 'Order details are invalid.';end if;
     insert into public.dmcrm_service_receipts(id,org_id,order_id,amount,received_on,method,reference,notes,created_by) values(eid,p_org,sid,(p_command->>'amount')::numeric,(p_command->>'received_on')::date,p_command->>'method',coalesce(p_command->>'reference',''),coalesce(p_command->>'notes',''),p_actor);
    else
     select * into receipt from public.dmcrm_service_receipts where id=(p_command->>'original_id')::uuid and org_id=p_org and order_id=sid and reversal_of is null;
     if receipt.id is null or exists(select 1 from public.dmcrm_service_receipts where reversal_of=receipt.id) then raise exception 'Receipt unavailable or already reversed.';end if;
     if length(trim(coalesce(p_command->>'reason','')))<3 then raise exception 'Order details are invalid.';end if;
     insert into public.dmcrm_service_receipts(id,org_id,order_id,amount,received_on,method,reference,notes,reversal_of,created_by) values(eid,p_org,sid,receipt.amount,(p_command->>'received_on')::date,receipt.method,receipt.reference,p_command->>'reason',receipt.id,p_actor);
    end if;
    update public.dmcrm_service_orders set revision=revision+1,updated_at=now() where id=sid;
   end if;
  end if;
  if o.customer_id is not null or n.customer_id is not null then
   insert into public.dmcrm_activities(org_id,customer_id,opportunity_id,kind,body,created_by) values(p_org,coalesce(n.customer_id,o.customer_id),coalesce(n.opportunity_id,o.opportunity_id),'note','Service order updated · '||replace(typ,'_',' '),(select name from public.dmcrm_staff where org_id=p_org and user_id=p_actor));
  end if;
 end if;
 insert into public.dmcrm_management_events(id,org_id,subject_id,action,command,before_value,created_by) values(rid,p_org,sid,typ,p_command,before_value,p_actor);
 insert into public.dmcrm_audit(org_id,actor,action,record_id) values(p_org,p_actor,typ,sid);
 return sid;
end $$;
revoke all on function public.dmcrm_command_before_management(uuid,uuid,jsonb),public.dmcrm_command(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.dmcrm_command(uuid,uuid,jsonb) to service_role;

create function public.dmcrm_claim_reports(p_org uuid default null) returns setof public.dmcrm_report_runs language plpgsql security definer set search_path='' as $$
declare r public.dmcrm_saved_reports%rowtype;j public.dmcrm_report_runs%rowtype;begin
 update public.dmcrm_report_runs rr set state='canceled',lease_id=null,error='Report changed or access ended'
  where rr.state in('pending','running','failed') and (p_org is null or rr.org_id=p_org) and not exists(
   select 1 from public.dmcrm_saved_reports sr join public.dmcrm_members m on m.org_id=sr.org_id and m.user_id=sr.created_by
   join public.dmcrm_staff s on s.org_id=m.org_id and s.user_id=m.user_id
   where sr.id=rr.report_id and not sr.archived and sr.revision=rr.report_revision and m.active and s.active and m.role in('owner','manager'));
 update public.dmcrm_report_runs set state='failed',lease_id=null,error='Generation interrupted three times. Use Generate now to create a fresh run.'
  where state='running' and attempts>=3 and leased_at<now()-interval '5 minutes' and (p_org is null or org_id=p_org);
 for r in select sr.* from public.dmcrm_saved_reports sr where not sr.archived and sr.next_run_at<=now() and (p_org is null or sr.org_id=p_org)
  and exists(select 1 from public.dmcrm_members m join public.dmcrm_staff s on s.org_id=m.org_id and s.user_id=m.user_id where m.org_id=sr.org_id and m.user_id=sr.created_by and m.active and s.active and m.role in('owner','manager')) for update skip locked limit 20 loop
   insert into public.dmcrm_report_runs(org_id,report_id,report_revision,name,definition,scheduled_for,trigger) values(r.org_id,r.id,r.revision,r.name,r.definition,r.next_run_at,'scheduled') on conflict do nothing;
   update public.dmcrm_saved_reports set next_run_at=public.dmcrm_report_next_run(schedule,now()) where id=r.id;
 end loop;
 for j in select rr.* from public.dmcrm_report_runs rr join public.dmcrm_saved_reports sr on sr.id=rr.report_id where (p_org is null or rr.org_id=p_org) and not sr.archived and sr.revision=rr.report_revision and rr.attempts<3
  and (rr.state in('pending','failed') or (rr.state='running' and rr.leased_at<now()-interval '5 minutes'))
  and exists(select 1 from public.dmcrm_members m join public.dmcrm_staff s on s.org_id=m.org_id and s.user_id=m.user_id where m.org_id=sr.org_id and m.user_id=sr.created_by and m.active and s.active and m.role in('owner','manager'))
  order by rr.scheduled_for for update of rr skip locked limit 5 loop
   update public.dmcrm_report_runs set state='running',attempts=attempts+1,lease_id=gen_random_uuid(),leased_at=now(),error='' where id=j.id returning * into j;
   return next j;
 end loop;
end $$;
create function public.dmcrm_finish_report(p_id uuid,p_lease uuid,p_snapshot jsonb,p_error text default '') returns boolean language plpgsql security definer set search_path='' as $$
declare j public.dmcrm_report_runs%rowtype;r public.dmcrm_saved_reports%rowtype;begin
 select * into j from public.dmcrm_report_runs where id=p_id for update;
 if j.id is null or j.state<>'running' or j.lease_id is distinct from p_lease then return false;end if;
 select * into r from public.dmcrm_saved_reports where id=j.report_id;
 if r.archived or r.revision<>j.report_revision or not exists(select 1 from public.dmcrm_members m join public.dmcrm_staff s on s.org_id=m.org_id and s.user_id=m.user_id where m.org_id=r.org_id and m.user_id=r.created_by and m.active and s.active and m.role in('owner','manager')) then
  update public.dmcrm_report_runs set state='canceled',lease_id=null,error='Report changed or access ended' where id=p_id;return false;
 end if;
 if p_snapshot is not null and (jsonb_typeof(p_snapshot)<>'object' or p_snapshot->>'version' is distinct from '1' or octet_length(p_snapshot::text)>4000000) then raise exception 'Invalid report snapshot';end if;
 update public.dmcrm_report_runs set state=case when p_snapshot is null then 'failed' else 'completed' end,snapshot=p_snapshot,error=case when p_snapshot is null then left(p_error,200) else '' end,completed_at=case when p_snapshot is null then null else now() end,lease_id=null where id=p_id;
 return true;
end $$;
revoke all on function public.dmcrm_service_amount(jsonb,text),public.dmcrm_service_scope(jsonb),public.dmcrm_report_next_run(jsonb,timestamptz),public.dmcrm_claim_reports(uuid),public.dmcrm_finish_report(uuid,uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.dmcrm_claim_reports(uuid),public.dmcrm_finish_report(uuid,uuid,jsonb,text) to service_role;
