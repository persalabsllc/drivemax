-- Additive CRM namespace. Existing website tables, functions and policies are unchanged.
create table public.dmcrm_orgs (id uuid primary key default gen_random_uuid(), name text not null, slug text unique not null, created_at timestamptz not null default now());
create table public.dmcrm_members (org_id uuid not null references public.dmcrm_orgs(id), user_id uuid not null references auth.users(id), name text not null, role text not null check(role in ('owner','manager','sales')), active boolean not null default true, primary key(org_id,user_id));
create table public.dmcrm_customers (id uuid primary key default gen_random_uuid(),org_id uuid not null references public.dmcrm_orgs(id),name text not null,email text not null default '',phone text not null default '',source text not null default 'Walk-in',status text not null default 'new' check(status in('new','working','appointment','sold','lost')),vehicle_interest text not null default '',trade_vehicle text not null default '',birthday date,sold_on date,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(org_id,id));
create table public.dmcrm_visits (id uuid primary key default gen_random_uuid(),org_id uuid not null references public.dmcrm_orgs(id),customer_id uuid not null,arrived_at timestamptz not null default now(),departed_at timestamptz,outcome text not null default 'browsing' check(outcome in('browsing','unsold','sold')),foreign key(org_id,customer_id) references public.dmcrm_customers(org_id,id),check(departed_at is null or departed_at>=arrived_at));
create unique index dmcrm_one_open_visit on public.dmcrm_visits(org_id,customer_id) where departed_at is null;
create table public.dmcrm_activities (id uuid primary key default gen_random_uuid(),org_id uuid not null references public.dmcrm_orgs(id),customer_id uuid not null,kind text not null check(kind in('note','call','system')),body text not null,created_at timestamptz not null default now(),created_by text not null,foreign key(org_id,customer_id) references public.dmcrm_customers(org_id,id));
create table public.dmcrm_tasks (id uuid primary key default gen_random_uuid(),org_id uuid not null references public.dmcrm_orgs(id),customer_id uuid,title text not null,due_date date not null,kind text not null check(kind in('appointment','unsold_followup','sold_followup','birthday','anniversary','task')),completed_at timestamptz,canceled_at timestamptz,origin_key text,foreign key(org_id,customer_id) references public.dmcrm_customers(org_id,id),unique(org_id,origin_key));
create table public.dmcrm_quotes (id uuid primary key default gen_random_uuid(),org_id uuid not null references public.dmcrm_orgs(id),customer_id uuid not null,vehicle text not null,values jsonb not null,created_at timestamptz not null default now(),foreign key(org_id,customer_id) references public.dmcrm_customers(org_id,id));
create table public.dmcrm_audit (id bigint generated always as identity primary key,org_id uuid not null references public.dmcrm_orgs(id),actor uuid not null,action text not null,record_id uuid,created_at timestamptz not null default now());
create index dmcrm_customer_org on public.dmcrm_customers(org_id,updated_at desc);
create index dmcrm_activity_customer on public.dmcrm_activities(org_id,customer_id,created_at desc);
create index dmcrm_tasks_due on public.dmcrm_tasks(org_id,due_date);
create index dmcrm_visits_date on public.dmcrm_visits(org_id,arrived_at desc);
create index dmcrm_quote_customer on public.dmcrm_quotes(org_id,customer_id,created_at desc);
-- Fail closed: browser roles have no business-table privileges. Server checks membership on every read and command.
alter table public.dmcrm_orgs enable row level security;
alter table public.dmcrm_members enable row level security;
alter table public.dmcrm_customers enable row level security;
alter table public.dmcrm_visits enable row level security;
alter table public.dmcrm_activities enable row level security;
alter table public.dmcrm_tasks enable row level security;
alter table public.dmcrm_quotes enable row level security;
alter table public.dmcrm_audit enable row level security;
revoke all on public.dmcrm_orgs,public.dmcrm_members,public.dmcrm_customers,public.dmcrm_visits,public.dmcrm_activities,public.dmcrm_tasks,public.dmcrm_quotes,public.dmcrm_audit from public,anon,authenticated;
grant all on public.dmcrm_orgs,public.dmcrm_members,public.dmcrm_customers,public.dmcrm_visits,public.dmcrm_activities,public.dmcrm_tasks,public.dmcrm_quotes,public.dmcrm_audit to service_role;
grant usage,select on sequence public.dmcrm_audit_id_seq to service_role;

create function public.dmcrm_next_annual(original date, after_day date) returns date language plpgsql immutable set search_path='' as $$
declare y int:=extract(year from after_day); candidate date;
begin
 candidate:=make_date(y,extract(month from original)::int,least(extract(day from original)::int,extract(day from (date_trunc('month',make_date(y,extract(month from original)::int,1))+interval '1 month - 1 day'))::int));
 if candidate<after_day then y:=y+1;candidate:=make_date(y,extract(month from original)::int,least(extract(day from original)::int,extract(day from (date_trunc('month',make_date(y,extract(month from original)::int,1))+interval '1 month - 1 day'))::int));end if;
 return candidate;
end $$;

create function public.dmcrm_command(p_org uuid,p_actor uuid,p_command jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare typ text:=p_command->>'type'; cid uuid; rid uuid; actor_name text; c jsonb:=p_command->'customer'; today date:=(now() at time zone 'America/New_York')::date; prior text; bday date; task_row public.dmcrm_tasks%rowtype; visit_row public.dmcrm_visits%rowtype; n int;
begin
 select name into actor_name from public.dmcrm_members where org_id=p_org and user_id=p_actor and active;
 if actor_name is null then raise exception 'CRM membership required' using errcode='42501';end if;
 if p_command ? 'customer_id' and p_command->>'customer_id' is not null then
  cid:=(p_command->>'customer_id')::uuid;
  if not exists(select 1 from public.dmcrm_customers where org_id=p_org and id=cid) then raise exception 'Customer unavailable' using errcode='42501';end if;
 end if;
 if typ='create_customer' then
  insert into public.dmcrm_customers(org_id,name,email,phone,source,status,vehicle_interest,trade_vehicle,birthday)
  values(p_org,c->>'name',c->>'email',c->>'phone',c->>'source','new',c->>'vehicle_interest',c->>'trade_vehicle',nullif(c->>'birthday','')::date) returning id into cid;
  rid:=cid;
  insert into public.dmcrm_activities(org_id,customer_id,kind,body,created_by) values(p_org,cid,'system','Customer profile created',actor_name);
  insert into public.dmcrm_tasks(org_id,customer_id,title,due_date,kind,origin_key) values(p_org,cid,'Follow up with '||(c->>'name'),today+1,'unsold_followup','new:'||cid);
  bday:=nullif(c->>'birthday','')::date;
  if bday is not null then insert into public.dmcrm_tasks(org_id,customer_id,title,due_date,kind,origin_key) values(p_org,cid,(c->>'name')||' · birthday',public.dmcrm_next_annual(bday,today),'birthday','birthday:'||cid||':'||public.dmcrm_next_annual(bday,today));end if;
 elsif typ='update_customer' then
  cid:=(p_command->>'id')::uuid;
  select status,birthday into prior,bday from public.dmcrm_customers where org_id=p_org and id=cid for update;
  if prior is null then raise exception 'Customer unavailable' using errcode='42501';end if;
  -- Sold transitions must go through mark_sold so task generation remains atomic.
  if c->>'status'='sold' and prior<>'sold' then raise exception 'Use Mark sold';end if;
  if prior='sold' and c->>'status'<>'sold' then raise exception 'Sold history cannot be changed here';end if;
  update public.dmcrm_customers set name=c->>'name',email=c->>'email',phone=c->>'phone',source=c->>'source',status=c->>'status',vehicle_interest=c->>'vehicle_interest',trade_vehicle=c->>'trade_vehicle',birthday=nullif(c->>'birthday','')::date,updated_at=now() where org_id=p_org and id=cid;
  if bday is distinct from nullif(c->>'birthday','')::date then
   update public.dmcrm_tasks set canceled_at=now() where org_id=p_org and customer_id=cid and kind='birthday' and completed_at is null and canceled_at is null;
   bday:=nullif(c->>'birthday','')::date;
   if bday is not null then insert into public.dmcrm_tasks(org_id,customer_id,title,due_date,kind) values(p_org,cid,(c->>'name')||' · birthday',public.dmcrm_next_annual(bday,today),'birthday');end if;
  end if;
  rid:=cid;
 elsif typ='add_activity' then
  if p_command->>'kind' not in ('note','call') or length(trim(p_command->>'body')) not between 1 and 8000 then raise exception 'Invalid activity';end if;
  insert into public.dmcrm_activities(org_id,customer_id,kind,body,created_by) values(p_org,cid,p_command->>'kind',p_command->>'body',actor_name) returning id into rid;
 elsif typ='check_in' then
  insert into public.dmcrm_visits(org_id,customer_id) values(p_org,cid) on conflict(org_id,customer_id) where departed_at is null do nothing returning id into rid;
  if rid is not null then insert into public.dmcrm_activities(org_id,customer_id,kind,body,created_by) values(p_org,cid,'system','Checked into the showroom',actor_name);end if;
 elsif typ='check_out' then
  update public.dmcrm_visits set departed_at=now(),outcome=case when outcome='sold' then 'sold' else 'unsold' end where org_id=p_org and id=(p_command->>'id')::uuid and departed_at is null returning * into visit_row;
  if visit_row.id is not null then
   rid:=visit_row.id;cid:=visit_row.customer_id;
   if visit_row.outcome='unsold' then insert into public.dmcrm_tasks(org_id,customer_id,title,due_date,kind,origin_key) values(p_org,cid,'Follow up after showroom visit',today+1,'unsold_followup','visit:'||rid) on conflict do nothing;end if;
   insert into public.dmcrm_activities(org_id,customer_id,kind,body,created_by) values(p_org,cid,'system','Checked out of the showroom',actor_name);
  end if;
 elsif typ='mark_sold' then
  select status into prior from public.dmcrm_customers where org_id=p_org and id=cid for update;
  if prior<>'sold' then
   update public.dmcrm_customers set status='sold',sold_on=today,updated_at=now() where org_id=p_org and id=cid;
   update public.dmcrm_visits set outcome='sold' where org_id=p_org and customer_id=cid and departed_at is null;
   update public.dmcrm_tasks set canceled_at=now() where org_id=p_org and customer_id=cid and kind='unsold_followup' and completed_at is null and canceled_at is null;
   foreach n in array array[2,7,30] loop
    insert into public.dmcrm_tasks(org_id,customer_id,title,due_date,kind,origin_key) values(p_org,cid,n||'-day sold follow-up',today+n,'sold_followup','sold:'||cid||':'||n) on conflict do nothing;
   end loop;
   insert into public.dmcrm_tasks(org_id,customer_id,title,due_date,kind,origin_key) values(p_org,cid,'Purchase anniversary',public.dmcrm_next_annual(today,today+1),'anniversary','anniversary:'||cid||':'||public.dmcrm_next_annual(today,today+1)) on conflict do nothing;
   insert into public.dmcrm_activities(org_id,customer_id,kind,body,created_by) values(p_org,cid,'system','Deal marked sold. Follow-up tasks created.',actor_name);
  end if;rid:=cid;
 elsif typ='create_task' then
  insert into public.dmcrm_tasks(org_id,customer_id,title,due_date,kind) values(p_org,cid,p_command->>'title',(p_command->>'due_date')::date,p_command->>'kind') returning id into rid;
 elsif typ='complete_task' then
  update public.dmcrm_tasks set completed_at=now() where org_id=p_org and id=(p_command->>'id')::uuid and completed_at is null and canceled_at is null returning * into task_row;
  rid:=task_row.id;
  if task_row.kind in ('birthday','anniversary') then
   insert into public.dmcrm_tasks(org_id,customer_id,title,due_date,kind,origin_key) values(p_org,task_row.customer_id,task_row.title,public.dmcrm_next_annual(task_row.due_date,task_row.due_date+1),task_row.kind,task_row.kind||':'||task_row.customer_id||':'||public.dmcrm_next_annual(task_row.due_date,task_row.due_date+1)) on conflict do nothing;
  end if;
 elsif typ='save_quote' then
  insert into public.dmcrm_quotes(org_id,customer_id,vehicle,values) values(p_org,cid,p_command->>'vehicle',p_command->'values') returning id into rid;
 else raise exception 'Unknown CRM command';
 end if;
 insert into public.dmcrm_audit(org_id,actor,action,record_id) values(p_org,p_actor,typ,rid);
 return rid;
end $$;
revoke all on function public.dmcrm_command(uuid,uuid,jsonb),public.dmcrm_next_annual(date,date) from public,anon,authenticated;
grant execute on function public.dmcrm_command(uuid,uuid,jsonb),public.dmcrm_next_annual(date,date) to service_role;
insert into public.dmcrm_orgs(id,name,slug) values('d5a1c100-0000-4000-8000-000000000001','Drive Max Used Cars','drive-max');
-- Reuse existing owner identities only. This does not create or alter sign-in accounts.
insert into public.dmcrm_members(org_id,user_id,name,role) select 'd5a1c100-0000-4000-8000-000000000001',id,name,'owner' from public.staff where active and role='owner';
