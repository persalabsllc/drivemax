-- One title file per sale, including separate files after an unwind and resale.
create table public.dmcrm_title_cases (
 id uuid primary key default gen_random_uuid(), org_id uuid not null, sale_id uuid not null,
 opportunity_id uuid not null, customer_id uuid not null, sold_on date not null,
 customer_name text not null, vehicle_label text not null default '', stock_number text not null default '', vin text not null default '',
 status text not null default 'sold' check(status in('sold','ready','at_dmv','pending','complete')),
 checklist jsonb not null default '{}' check(jsonb_typeof(checklist)='object'),
 notes text not null default '' check(length(notes)<=4000), pending_reason text not null default '' check(length(pending_reason)<=1000),
 next_action_on date, ready_on date, submitted_on date, completed_on date,
 revision integer not null default 0, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(org_id,id), unique(org_id,sale_id),
 foreign key(org_id,sale_id) references public.dmcrm_sales(org_id,id),
 foreign key(org_id,opportunity_id,customer_id) references public.dmcrm_opportunities(org_id,id,customer_id)
);
create table public.dmcrm_temp_tags (
 id uuid primary key default gen_random_uuid(), org_id uuid not null, case_id uuid not null,
 number text not null check(length(number) between 1 and 40 and number ~ '^[A-Z0-9]+(-[A-Z0-9]+)*$'),
 issued_on date not null, expires_on date not null,
 status text not null default 'active' check(status in('active','permanent','replaced','void')),
 closed_on date, notes text not null default '' check(length(notes)<=2000), revision integer not null default 0,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 foreign key(org_id,case_id) references public.dmcrm_title_cases(org_id,id),
 check(expires_on between issued_on and issued_on+60),
 check((status='active' and closed_on is null) or (status<>'active' and closed_on>=issued_on))
);
create unique index dmcrm_temp_tag_number on public.dmcrm_temp_tags(org_id,replace(number,'-',''));
create unique index dmcrm_temp_tag_active_case on public.dmcrm_temp_tags(org_id,case_id) where status='active';
create index dmcrm_title_queue on public.dmcrm_title_cases(org_id,status,sold_on);
alter table public.dmcrm_deal_files add constraint dmcrm_deal_files_org_id_unique unique(org_id,id);
create table public.dmcrm_title_documents (
 id uuid primary key default gen_random_uuid(), org_id uuid not null, case_id uuid not null, file_id uuid not null,
 purpose text not null check(purpose in('dmv_receipt','transfer_proof','temp_tag','supporting')),
 created_by uuid not null, created_at timestamptz not null default now(), unique(org_id,file_id),
 foreign key(org_id,case_id) references public.dmcrm_title_cases(org_id,id),
 foreign key(org_id,file_id) references public.dmcrm_deal_files(org_id,id)
);
create table public.dmcrm_title_events (
 id uuid primary key default gen_random_uuid(), org_id uuid not null, case_id uuid not null,
 event text not null, actor_name text not null, detail jsonb not null default '{}', created_at timestamptz not null default now(),
 foreign key(org_id,case_id) references public.dmcrm_title_cases(org_id,id)
);
create index dmcrm_title_events_case on public.dmcrm_title_events(org_id,case_id,created_at);
do $$ declare tbl text; begin
 foreach tbl in array array['dmcrm_title_cases','dmcrm_temp_tags','dmcrm_title_documents','dmcrm_title_events'] loop
  execute format('alter table public.%I enable row level security',tbl);
  execute format('revoke all on public.%I from public,anon,authenticated',tbl);
  execute format('grant select on public.%I to service_role',tbl);
 end loop;
end $$;

create function public.dmcrm_open_title_case(p_sale uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare s public.dmcrm_sales%rowtype; rid uuid; v jsonb; o jsonb;
begin
 select * into s from public.dmcrm_sales where id=p_sale;
 if s.id is null or s.status<>'sold' then return null; end if;
 o:=s.snapshot->'opportunity'; v:=o->'vehicle_details';
 insert into public.dmcrm_title_cases(org_id,sale_id,opportunity_id,customer_id,sold_on,customer_name,vehicle_label,stock_number,vin)
 values(s.org_id,s.id,s.opportunity_id,s.customer_id,s.sold_on,
  coalesce(s.snapshot#>>'{customer,name}','Customer'),coalesce(nullif(o->>'vehicle_interest',''),trim(concat_ws(' ',v->>'year',v->>'make',v->>'model')),''),coalesce(v->>'stock_number',''),coalesce(v->>'vin',''))
 on conflict(org_id,sale_id) do nothing returning id into rid;
 if rid is not null then
  insert into public.dmcrm_title_events(org_id,case_id,event,actor_name) values(s.org_id,rid,'Title case opened','System');
 else select id into rid from public.dmcrm_title_cases where org_id=s.org_id and sale_id=s.id; end if;
 return rid;
end $$;
create function public.dmcrm_title_sale_changed() returns trigger language plpgsql security definer set search_path='' as $$
declare c public.dmcrm_title_cases%rowtype; t public.dmcrm_temp_tags%rowtype;
begin
 if new.status='sold' then perform public.dmcrm_open_title_case(new.id);
 elsif tg_op='UPDATE' and old.status='sold' and new.status='unwound' then
  select * into c from public.dmcrm_title_cases where org_id=new.org_id and sale_id=new.id for update;
  if c.id is not null then
   insert into public.dmcrm_title_events(org_id,case_id,event,actor_name,detail) values(new.org_id,c.id,'Sale unwound','System',jsonb_build_object('reason',new.unwind_reason));
   for t in select * from public.dmcrm_temp_tags where org_id=new.org_id and case_id=c.id and status='active' for update loop
    update public.dmcrm_temp_tags set status='void',closed_on=(now() at time zone 'America/New_York')::date,
     notes=left(concat_ws(' · ',nullif(notes,''),'Sale unwound'),2000),revision=revision+1,updated_at=now() where id=t.id;
    insert into public.dmcrm_title_events(org_id,case_id,event,actor_name,detail) values(new.org_id,c.id,'Temporary tag voided — sale unwound','System',jsonb_build_object('number',t.number));
   end loop;
  end if;
 end if;
 return new;
end $$;
create trigger dmcrm_title_sale_changed after insert or update of status on public.dmcrm_sales for each row execute function public.dmcrm_title_sale_changed();
select public.dmcrm_open_title_case(id) from public.dmcrm_sales where status='sold';

alter function public.dmcrm_command(uuid,uuid,jsonb) rename to dmcrm_command_before_title_clerk;
create function public.dmcrm_command(p_org uuid,p_actor uuid,p_command jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare typ text:=p_command->>'type'; rid uuid:=(p_command->>'id')::uuid; v jsonb:=p_command->'values';
 a public.dmcrm_staff%rowtype; c public.dmcrm_title_cases%rowtype; t public.dmcrm_temp_tags%rowtype; f public.dmcrm_deal_files%rowtype;
 ck uuid; oldlink uuid; sale_status text; before_value jsonb; event_name text; details jsonb;
 rev integer:=(p_command->>'revision')::integer; today date:=(now() at time zone 'America/New_York')::date;
 ready date; submitted date; completed date; issued date; expires date; closed date;
 checks text[]:=array['title_received','buyer_signatures','title_application','power_of_attorney','damage_disclosure','odometer_disclosure','bill_of_sale','insurance_verified','lienholder_verified','fees_verified','dmv_receipt','transfer_verified'];
begin
 if typ not in('save_title_case','save_temp_tag','attach_title_document') then return public.dmcrm_command_before_title_clerk(p_org,p_actor,p_command); end if;
 select s.* into a from public.dmcrm_staff s join public.dmcrm_members m on m.org_id=s.org_id and m.user_id=s.user_id
 where s.org_id=p_org and s.user_id=p_actor and s.active and m.active for share of s,m;
 if a.id is null then raise exception 'CRM membership required' using errcode='42501'; end if;
 ck:=case when typ='save_temp_tag' then (p_command->>'case_id')::uuid else rid end;
 select * into c from public.dmcrm_title_cases where org_id=p_org and id=ck;
 if c.id is null then raise exception 'Title case unavailable' using errcode='42501'; end if;
 perform 1 from public.dmcrm_opportunities where org_id=p_org and id=c.opportunity_id and (a.role in('owner','manager') or assigned_to=a.id) for share;
 if not found then raise exception 'Assigned salesperson or manager required' using errcode='42501'; end if;
 -- Use the same lock order as sale/unwind: opportunity, sale, then title file.
 select status into sale_status from public.dmcrm_sales where org_id=p_org and id=c.sale_id for share;
 select * into c from public.dmcrm_title_cases where org_id=p_org and id=ck for update;
 if typ<>'attach_title_document' and sale_status<>'sold' then raise exception 'Unwound sale is read-only'; end if;
 if typ='save_title_case' then
  if rev is distinct from c.revision then raise exception 'Record changed. Refresh before saving.'; end if;
  if jsonb_typeof(v) is distinct from 'object' or coalesce(v->>'status','') not in('sold','ready','at_dmv','pending','complete')
   or jsonb_typeof(v->'checklist') is distinct from 'object' or length(coalesce(v->>'notes',''))>4000 or length(coalesce(v->>'pending_reason',''))>1000 then raise exception 'Invalid title clerk information'; end if;
  if exists(select 1 from jsonb_each_text(v->'checklist') kv where not(kv.key=any(checks)) or coalesce(kv.value,'') not in('todo','done','not_needed')) then raise exception 'Invalid title clerk information'; end if;
  if v->>'status'='pending' and length(trim(coalesce(v->>'pending_reason','')))=0 then raise exception 'Enter a pending reason'; end if;
  if v->>'status'='complete' and exists(select 1 from unnest(checks) k where coalesce(v->'checklist'->>k,'todo') not in('done','not_needed')) then raise exception 'Resolve every checklist item before completing paperwork'; end if;
  ready:=nullif(v->>'ready_on','')::date; submitted:=nullif(v->>'submitted_on','')::date; completed:=nullif(v->>'completed_on','')::date;
  if (ready is not null and (ready<c.sold_on or ready>today)) or (submitted is not null and (submitted<c.sold_on or submitted>today))
   or (completed is not null and (completed<c.sold_on or completed>today)) or ready>submitted or submitted>completed or ready>completed
   or (v->>'status'='ready' and ready is null) or (v->>'status'='at_dmv' and submitted is null)
   or ((v->>'status'='complete')<>(completed is not null)) then raise exception 'Check the DMV milestone dates'; end if;
  before_value:=to_jsonb(c);
  update public.dmcrm_title_cases set status=v->>'status',checklist=v->'checklist',notes=coalesce(v->>'notes',''),pending_reason=coalesce(v->>'pending_reason',''),
   next_action_on=nullif(v->>'next_action_on','')::date,ready_on=ready,submitted_on=submitted,completed_on=completed,revision=revision+1,updated_at=now() where id=c.id;
  event_name:='Paperwork updated';details:=jsonb_build_object('before',before_value,'after',v);
 elsif typ='save_temp_tag' then
  if rid is null or rev is null or rev<0 or jsonb_typeof(v) is distinct from 'object' or (length(coalesce(v->>'number','')) not between 1 and 40 or coalesce(v->>'number','') !~ '^[A-Z0-9]+(-[A-Z0-9]+)*$')
   or coalesce(v->>'status','') not in('active','permanent','replaced','void') or length(coalesce(v->>'notes',''))>2000 then raise exception 'Invalid title clerk information';end if;
  select * into t from public.dmcrm_temp_tags where id=rid for update;
  if t.id is not null and (t.org_id<>p_org or t.case_id<>c.id) then raise exception 'Title case unavailable' using errcode='42501'; end if;
  if rev is distinct from coalesce(t.revision,0) then raise exception 'Record changed. Refresh before saving.'; end if;
  if t.id is not null and t.status<>'active' and v->>'status'='active' then raise exception 'Closed tags cannot be reactivated'; end if;
  issued:=(v->>'issued_on')::date; expires:=(v->>'expires_on')::date; closed:=nullif(v->>'closed_on','')::date;
  if issued is null or expires is null or issued<c.sold_on or issued>today or expires<issued or expires>issued+60
   or ((v->>'status'='active')=(closed is not null)) or closed<issued or closed>today then raise exception 'Check the temporary tag dates (up to 60 days)'; end if;
  if v->>'status' in('void','replaced') and length(trim(coalesce(v->>'notes','')))=0 then raise exception 'Enter a reason for replacing or voiding a tag'; end if;
  if exists(select 1 from public.dmcrm_temp_tags where org_id=p_org and id<>rid and replace(number,'-','')=replace(v->>'number','-','')) then raise exception 'This tag number is already recorded'; end if;
  if v->>'status'='active' and exists(select 1 from public.dmcrm_temp_tags where org_id=p_org and case_id=c.id and id<>rid and status='active') then raise exception 'Close the current tag before recording another'; end if;
  insert into public.dmcrm_temp_tags(id,org_id,case_id,number,issued_on,expires_on,status,closed_on,notes)
   values(rid,p_org,c.id,v->>'number',issued,expires,v->>'status',closed,coalesce(v->>'notes',''))
   on conflict(id) do update set number=excluded.number,issued_on=excluded.issued_on,expires_on=excluded.expires_on,status=excluded.status,closed_on=excluded.closed_on,notes=excluded.notes,revision=dmcrm_temp_tags.revision+1,updated_at=now();
  event_name:=case when t.id is null then 'Temporary tag recorded' else 'Temporary tag updated' end;
  details:=jsonb_build_object('before',case when t.id is null then null else to_jsonb(t) end,'after',v);
 else
  if coalesce(p_command->>'purpose','') not in('dmv_receipt','transfer_proof','temp_tag','supporting') then raise exception 'Invalid title clerk information';end if;
  select * into f from public.dmcrm_deal_files where org_id=p_org and id=(p_command->>'file_id')::uuid for share;
  if f.id is null or f.customer_id is distinct from c.customer_id or f.opportunity_id is distinct from c.opportunity_id then raise exception 'Document does not belong to this sale'; end if;
  perform pg_advisory_xact_lock(hashtextextended('title-document:'||f.id,22));
  select case_id into oldlink from public.dmcrm_title_documents where org_id=p_org and file_id=f.id;
  if oldlink=c.id then return c.id; elsif oldlink is not null then raise exception 'Document is already filed with another title case'; end if;
  insert into public.dmcrm_title_documents(org_id,case_id,file_id,purpose,created_by) values(p_org,c.id,f.id,p_command->>'purpose',p_actor);
  event_name:='Document filed';details:=jsonb_build_object('name',f.name,'purpose',p_command->>'purpose','file_id',f.id);
 end if;
 insert into public.dmcrm_title_events(org_id,case_id,event,actor_name,detail) values(p_org,c.id,event_name,a.name,details);
 return rid;
end $$;
revoke all on function public.dmcrm_open_title_case(uuid),public.dmcrm_title_sale_changed(),public.dmcrm_command_before_title_clerk(uuid,uuid,jsonb),public.dmcrm_command(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.dmcrm_command(uuid,uuid,jsonb) to service_role;
