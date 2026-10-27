create table public.dmcrm_deal_progress (
 id uuid primary key,org_id uuid not null,stage text not null default 'new' check(stage in('new','contacted','appointment','shown','numbers','delivery')),
 funding text not null default 'not_started' check(funding in('cash','not_started','submitted','approved','stipulations','contracted','funded')),
 lender text not null default '' check(length(lender)<=150),stipulations text not null default '' check(length(stipulations)<=3000),funded_on text not null default '',credit_url text not null default '' check(credit_url='' or credit_url like 'https://%'),
 delivery jsonb not null default '{}' check(jsonb_typeof(delivery)='object'),notes text not null default '' check(length(notes)<=3000),revision integer not null default 0,updated_at timestamptz not null default now(),foreign key(org_id,id) references public.dmcrm_opportunities(org_id,id)
);
create table public.dmcrm_buyer_preferences (
 id uuid primary key,org_id uuid not null,active boolean not null default true,max_price numeric check(max_price>=0),max_miles integer check(max_miles>=0),min_year integer check(min_year between 1900 and 2100),make text not null default '',model text not null default '',body text not null default '',transmission text not null default '',features text not null default '',notes text not null default '',revision integer not null default 0,foreign key(org_id,id) references public.dmcrm_customers(org_id,id)
);
create table public.dmcrm_inventory_prep (
 id uuid primary key,org_id uuid not null,stage text not null default 'intake' check(stage in('intake','inspection','repair','detail','ready','published')),
 assigned_to uuid,due_on text not null default '',title_received boolean not null default false,blocker text not null default '' check(length(blocker)<=2000),body text not null default '',transmission text not null default '',features text not null default '',items jsonb not null default '[]' check(jsonb_typeof(items)='array' and jsonb_array_length(items)<=50),revision integer not null default 0,updated_at timestamptz not null default now(),foreign key(org_id,id) references public.dmcrm_inventory(org_id,id),foreign key(org_id,assigned_to) references public.dmcrm_staff(org_id,id)
);
create table public.dmcrm_sales_events (
 id uuid primary key default gen_random_uuid(),org_id uuid not null,opportunity_id uuid not null,customer_id uuid not null,event text not null,
 created_at timestamptz not null default now(),foreign key(org_id,opportunity_id) references public.dmcrm_opportunities(org_id,id),foreign key(org_id,customer_id) references public.dmcrm_customers(org_id,id)
);
create index dmcrm_sales_event_report on public.dmcrm_sales_events(org_id,opportunity_id,created_at);
create table public.dmcrm_deal_files (
 id uuid primary key default gen_random_uuid(),org_id uuid not null,customer_id uuid not null,opportunity_id uuid,name text not null check(length(name) between 1 and 200),kind text not null check(kind in('signed','insurance','identification','stipulation','packet','other')),size integer not null check(size between 1 and 10485760),mime text not null,path text not null unique,created_at timestamptz not null default now(),created_by uuid not null,
 foreign key(org_id,customer_id) references public.dmcrm_customers(org_id,id),foreign key(org_id,opportunity_id) references public.dmcrm_opportunities(org_id,id)
);
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('dmcrm-deal-files','dmcrm-deal-files',false,10485760,array['application/pdf','image/jpeg','image/png']) on conflict(id) do nothing;
do $$ declare tbl text;begin
 foreach tbl in array array['dmcrm_deal_progress','dmcrm_buyer_preferences','dmcrm_inventory_prep','dmcrm_sales_events','dmcrm_deal_files'] loop
 execute format('alter table public.%I enable row level security',tbl);execute format('revoke all on public.%I from public,anon,authenticated',tbl);execute format('grant all on public.%I to service_role',tbl);
 end loop;
end $$;
create function public.dmcrm_sales_event_record() returns trigger language plpgsql security definer set search_path='' as $$
declare oid uuid;cid uuid;org uuid;event_name text;
begin
 if tg_table_name='dmcrm_opportunities' then
  oid:=new.id;cid:=new.customer_id;org:=new.org_id;
  if tg_op='INSERT' then event_name:='new';elsif old.status is distinct from new.status then event_name:=case when new.status='sold' then 'sold' when new.status='lost' then 'lost' when old.status='sold' then 'unwound' else null end;end if;
 elsif tg_table_name='dmcrm_messages' then
  oid:=new.opportunity_id;cid:=new.customer_id;org:=new.org_id;
  if new.direction='outbound' and new.status in('sent','delivered') and new.created_by<>'00000000-0000-4000-8000-000000000000'::uuid and (tg_op='INSERT' or old.status not in('sent','delivered')) then event_name:='contacted';end if;
 elsif tg_table_name='dmcrm_activities' then
  oid:=new.opportunity_id;cid:=new.customer_id;org:=new.org_id;if new.kind='call' then event_name:='contacted';end if;
 elsif tg_table_name='dmcrm_appointments' then
  oid:=new.opportunity_id;cid:=new.customer_id;org:=new.org_id;
  if tg_op='INSERT' then event_name:='appointment';elsif new.status in('arrived','completed') and old.status not in('arrived','completed') then event_name:='shown';end if;
 elsif tg_table_name='dmcrm_visits' then
  oid:=new.opportunity_id;cid:=new.customer_id;org:=new.org_id;event_name:='shown';
 elsif tg_table_name='dmcrm_quotes' then oid:=new.opportunity_id;cid:=new.customer_id;org:=new.org_id;event_name:='numbers';
 end if;
 if oid is not null and event_name is not null then
  insert into public.dmcrm_sales_events(org_id,opportunity_id,customer_id,event) values(org,oid,cid,event_name);
  if event_name not in('sold','lost','unwound') then
   insert into public.dmcrm_deal_progress(id,org_id,stage) values(oid,org,event_name)
   on conflict(id) do update set stage=excluded.stage,revision=dmcrm_deal_progress.revision+1,updated_at=now()
    where array_position(array['new','contacted','appointment','shown','numbers','delivery'],dmcrm_deal_progress.stage)<array_position(array['new','contacted','appointment','shown','numbers','delivery'],excluded.stage);
  end if;
 end if;return new;
end $$;
create trigger dmcrm_sales_opportunity after insert or update of status on public.dmcrm_opportunities for each row execute function public.dmcrm_sales_event_record();
create trigger dmcrm_sales_message after insert or update of status on public.dmcrm_messages for each row execute function public.dmcrm_sales_event_record();
create trigger dmcrm_sales_activity after insert on public.dmcrm_activities for each row execute function public.dmcrm_sales_event_record();
create trigger dmcrm_sales_appointment after insert or update of status on public.dmcrm_appointments for each row execute function public.dmcrm_sales_event_record();
create trigger dmcrm_sales_visit after insert on public.dmcrm_visits for each row execute function public.dmcrm_sales_event_record();
create trigger dmcrm_sales_quote after insert on public.dmcrm_quotes for each row execute function public.dmcrm_sales_event_record();
-- Historical records retain their true dates; stage events are recorded from this release onward.
alter function public.dmcrm_command(uuid,uuid,jsonb) rename to dmcrm_command_v15;
create function public.dmcrm_command(p_org uuid,p_actor uuid,p_command jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare typ text:=p_command->>'type';a public.dmcrm_staff%rowtype;rid uuid:=(p_command->>'id')::uuid;rev integer:=(p_command->>'revision')::integer;oldrev integer;v jsonb;o public.dmcrm_opportunities%rowtype;oldstage text;total numeric;
begin
 if typ not in('save_deal_progress','save_buyer_preferences','save_inventory_prep') then return public.dmcrm_command_v15(p_org,p_actor,p_command);end if;
 select s.* into a from public.dmcrm_staff s join public.dmcrm_members m on m.org_id=s.org_id and m.user_id=s.user_id where s.org_id=p_org and s.user_id=p_actor and s.active and m.active for share of s,m;
 if a.id is null then raise exception 'CRM membership required' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended('dmcrm:'||typ||':'||rid::text,0));
 if typ='save_deal_progress' then
  select * into o from public.dmcrm_opportunities where id=rid and org_id=p_org for update;
  if o.id is null or (a.role not in('owner','manager') and o.assigned_to is distinct from a.id) then raise exception 'Assigned salesperson or manager required' using errcode='42501';end if;
  select revision,stage into oldrev,oldstage from public.dmcrm_deal_progress where id=rid;
  if rev is distinct from coalesce(oldrev,0) then raise exception 'Record changed. Refresh before saving.';end if;v:=p_command->'progress';
  if a.role not in('owner','manager') and exists(select 1 from public.dmcrm_deal_progress where id=rid and (funding is distinct from v->>'funding' or lender is distinct from v->>'lender' or stipulations is distinct from v->>'stipulations' or funded_on is distinct from v->>'funded_on')) then raise exception 'Manager access required for funding changes' using errcode='42501';end if;
  if a.role not in('owner','manager') and oldrev is null and (v->>'funding'<>'not_started' or v->>'lender'<>'' or v->>'funded_on'<>'') then raise exception 'Manager access required for funding changes' using errcode='42501';end if;
  if v->>'funding'='funded' and coalesce(v->>'funded_on','')='' then raise exception 'Enter the funded date';end if;
  insert into public.dmcrm_deal_progress(id,org_id,stage,funding,lender,stipulations,funded_on,credit_url,delivery,notes) values(rid,p_org,v->>'stage',v->>'funding',v->>'lender',v->>'stipulations',v->>'funded_on',v->>'credit_url',v->'delivery',v->>'notes')
   on conflict(id) do update set stage=excluded.stage,funding=excluded.funding,lender=excluded.lender,stipulations=excluded.stipulations,funded_on=excluded.funded_on,credit_url=excluded.credit_url,delivery=excluded.delivery,notes=excluded.notes,revision=dmcrm_deal_progress.revision+1,updated_at=now();
  if oldstage is distinct from v->>'stage' then insert into public.dmcrm_sales_events(org_id,opportunity_id,customer_id,event) values(p_org,rid,o.customer_id,v->>'stage');end if;
  insert into public.dmcrm_activities(org_id,customer_id,opportunity_id,kind,body,created_by) values(p_org,o.customer_id,rid,'system','Deal progress updated · '||replace(v->>'stage','_',' ')||' · Funding: '||replace(v->>'funding','_',' '),a.name);
 elsif typ='save_buyer_preferences' then
  if not exists(select 1 from public.dmcrm_customers where org_id=p_org and id=rid) then raise exception 'Customer unavailable' using errcode='42501';end if;
  select revision into oldrev from public.dmcrm_buyer_preferences where id=rid;
  if rev is distinct from coalesce(oldrev,0) then raise exception 'Record changed. Refresh before saving.';end if;v:=p_command->'preferences';
  insert into public.dmcrm_buyer_preferences(id,org_id,active,max_price,max_miles,min_year,make,model,body,transmission,features,notes) values(rid,p_org,(v->>'active')::boolean,(v->>'max_price')::numeric,(v->>'max_miles')::integer,(v->>'min_year')::integer,v->>'make',v->>'model',v->>'body',v->>'transmission',v->>'features',v->>'notes')
   on conflict(id) do update set active=excluded.active,max_price=excluded.max_price,max_miles=excluded.max_miles,min_year=excluded.min_year,make=excluded.make,model=excluded.model,body=excluded.body,transmission=excluded.transmission,features=excluded.features,notes=excluded.notes,revision=dmcrm_buyer_preferences.revision+1;
  insert into public.dmcrm_activities(org_id,customer_id,kind,body,created_by) values(p_org,rid,'system','Vehicle wish list updated.',a.name);
 else
  if a.role not in('owner','manager') then raise exception 'Manager access required' using errcode='42501';end if;
  if not exists(select 1 from public.dmcrm_inventory where org_id=p_org and id=rid and deleted_at is null) then raise exception 'Vehicle unavailable' using errcode='42501';end if;
  select revision into oldrev from public.dmcrm_inventory_prep where id=rid;
  if rev is distinct from coalesce(oldrev,0) then raise exception 'Record changed. Refresh before saving.';end if;v:=p_command->'prep';
  if v->>'assigned_to' is not null and not exists(select 1 from public.dmcrm_staff where org_id=p_org and id=(v->>'assigned_to')::uuid and active) then raise exception 'Select an active team member';end if;
  if exists(select 1 from jsonb_array_elements(v->'items') item where coalesce((item->>'amount')::numeric,-1)<0 or length(coalesce(item->>'description',''))=0) then raise exception 'Check recon items';end if;
  insert into public.dmcrm_inventory_prep(id,org_id,stage,assigned_to,due_on,title_received,blocker,body,transmission,features,items) values(rid,p_org,v->>'stage',(v->>'assigned_to')::uuid,v->>'due_on',(v->>'title_received')::boolean,v->>'blocker',v->>'body',v->>'transmission',v->>'features',v->'items')
   on conflict(id) do update set stage=excluded.stage,assigned_to=excluded.assigned_to,due_on=excluded.due_on,title_received=excluded.title_received,blocker=excluded.blocker,body=excluded.body,transmission=excluded.transmission,features=excluded.features,items=excluded.items,revision=dmcrm_inventory_prep.revision+1,updated_at=now();
  if (p_command->>'sync_recon')::boolean then
   if exists(select 1 from public.dmcrm_inventory where org_id=p_org and id=rid and status='sold') then raise exception 'Sold inventory recon is read-only; adjust the sale accounting';end if;
   select coalesce(sum((item->>'amount')::numeric),0) into total from jsonb_array_elements(v->'items') item;
   update public.dmcrm_inventory set recon=total,updated_at=now() where id=rid and org_id=p_org;
  end if;
 end if;return rid;
end $$;
revoke all on function public.dmcrm_sales_event_record(),public.dmcrm_command_v15(uuid,uuid,jsonb),public.dmcrm_command(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.dmcrm_command(uuid,uuid,jsonb) to service_role;
