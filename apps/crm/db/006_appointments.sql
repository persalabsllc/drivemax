-- Timed customer appointments are separate from date-only follow-up tasks.
create table public.dmcrm_appointments (
 id uuid primary key, org_id uuid not null references public.dmcrm_orgs(id),
 customer_id uuid not null, opportunity_id uuid, assigned_to uuid not null,
 kind text not null check(kind in('test_drive','return_visit','vehicle_viewing','sold_delivery','service','trade_appraisal','paperwork','other')),
 starts_at timestamptz not null check(starts_at >= '2000-01-01T00:00:00Z' and starts_at < '2101-01-01T00:00:00Z'),
 duration_minutes integer not null check(duration_minutes between 15 and 240 and duration_minutes % 15 = 0),
 description text not null default '' check(length(description)<=1000),
 status text not null default 'scheduled' check(status in('scheduled','confirmed','arrived','completed','no_show','canceled')),
 revision integer not null default 0 check(revision>=0),
 created_by uuid not null references auth.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(org_id,id),
 foreign key(org_id,customer_id) references public.dmcrm_customers(org_id,id),
 foreign key(org_id,opportunity_id) references public.dmcrm_opportunities(org_id,id),
 foreign key(org_id,assigned_to) references public.dmcrm_staff(org_id,id)
);
create index dmcrm_appointments_schedule on public.dmcrm_appointments(org_id,starts_at) where status in('scheduled','confirmed','arrived');
create index dmcrm_appointments_customer on public.dmcrm_appointments(org_id,customer_id,starts_at);
create table public.dmcrm_appointment_history (
 id uuid primary key default gen_random_uuid(),org_id uuid not null,appointment_id uuid not null,
 actor uuid not null references auth.users(id),event text not null,before_record jsonb,after_record jsonb not null,
 created_at timestamptz not null default now(),
 foreign key(org_id,appointment_id) references public.dmcrm_appointments(org_id,id)
);
alter table public.dmcrm_appointments enable row level security;
alter table public.dmcrm_appointment_history enable row level security;
revoke all on public.dmcrm_appointments,public.dmcrm_appointment_history from public,anon,authenticated;
grant all on public.dmcrm_appointments,public.dmcrm_appointment_history to service_role;

-- Keep both an exact before/after record and readable customer activity.
create function public.dmcrm_log_appointment(p_org uuid,p_actor uuid,p_id uuid,p_event text,p_before jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare ap public.dmcrm_appointments%rowtype;actor_name text;staff_name text;summary text;kind_label text;
begin
 select * into ap from public.dmcrm_appointments where org_id=p_org and id=p_id;
 select name into actor_name from public.dmcrm_staff where org_id=p_org and user_id=p_actor;
 select name into staff_name from public.dmcrm_staff where org_id=p_org and id=ap.assigned_to;
 kind_label:=case ap.kind when 'paperwork' then 'Financing / paperwork' else initcap(replace(ap.kind,'_',' ')) end;
 summary:='Appointment '||p_event||' · '||kind_label||' · '||to_char(ap.starts_at at time zone 'America/New_York','Mon DD, YYYY HH12:MI AM')||' Eastern · '||ap.duration_minutes||' min · '||staff_name;
 if p_before is not null and (p_before->>'starts_at')::timestamptz is distinct from ap.starts_at then
  summary:=summary||'. Previously '||to_char((p_before->>'starts_at')::timestamptz at time zone 'America/New_York','Mon DD, YYYY HH12:MI AM')||' Eastern';
 end if;
 if p_before is not null and (p_before->>'assigned_to')::uuid is distinct from ap.assigned_to then
  summary:=summary||'. Previously assigned to '||coalesce((select name from public.dmcrm_staff where org_id=p_org and id=(p_before->>'assigned_to')::uuid),'another salesperson');
 end if;
 if ap.description<>'' then summary:=summary||'. '||ap.description;end if;
 insert into public.dmcrm_appointment_history(org_id,appointment_id,actor,event,before_record,after_record) values(p_org,ap.id,p_actor,p_event,p_before,to_jsonb(ap));
 insert into public.dmcrm_activities(org_id,customer_id,opportunity_id,kind,body,created_by) values(p_org,ap.customer_id,ap.opportunity_id,'system',summary,actor_name);
end $$;

alter function public.dmcrm_command(uuid,uuid,jsonb) rename to dmcrm_command_v5;
revoke all on function public.dmcrm_command_v5(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
create function public.dmcrm_command(p_org uuid,p_actor uuid,p_command jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare typ text:=p_command->>'type';actor public.dmcrm_staff%rowtype;ap public.dmcrm_appointments%rowtype;
 data jsonb:=p_command->'appointment';rid uuid;cid uuid;oid uuid;assignee uuid;start_time timestamptz;minutes integer;
 manager boolean;old_record jsonb;event text;new_status text;staff_row public.dmcrm_staff%rowtype;
begin
 select s.* into actor from public.dmcrm_staff s join public.dmcrm_members m on m.org_id=s.org_id and m.user_id=s.user_id
  where s.org_id=p_org and s.user_id=p_actor and s.active and m.active for share of s,m;
 if actor.id is null then raise exception 'CRM membership required' using errcode='42501';end if;
 manager:=actor.role in('owner','manager');
 perform set_config('dmcrm.actor_id',p_actor::text,true);
 if typ in('save_appointment','set_appointment_status') then
  rid:=(p_command->>'id')::uuid;
  if rid is null then raise exception 'Appointment unavailable' using errcode='42501';end if;
  -- Serialize simultaneous first saves as well as later changes.
  perform pg_advisory_xact_lock(hashtextextended('dmcrm:appointment:'||rid::text,0));
  select * into ap from public.dmcrm_appointments where id=rid for update;
  if ap.id is not null then
   if ap.org_id<>p_org then raise exception 'Appointment unavailable' using errcode='42501';end if;
   if not manager and ap.assigned_to<>actor.id then raise exception 'You can only change your own appointments' using errcode='42501';end if;
   if ap.revision is distinct from (p_command->>'revision')::integer then raise exception 'Appointment changed in another session. Reload before saving.';end if;
   if ap.status in('completed','canceled','no_show') then raise exception 'This appointment is closed. Schedule another visit instead.';end if;
   old_record:=to_jsonb(ap);
  elsif typ='set_appointment_status' or (p_command->>'revision')::integer is distinct from 0 then
   raise exception 'Appointment unavailable' using errcode='42501';
  end if;
  if typ='save_appointment' then
   cid:=(data->>'customer_id')::uuid;oid:=(data->>'opportunity_id')::uuid;assignee:=(data->>'assigned_to')::uuid;
   if not exists(select 1 from public.dmcrm_customers where org_id=p_org and id=cid) or (ap.id is not null and ap.customer_id<>cid) then raise exception 'Customer unavailable' using errcode='42501';end if;
   if oid is not null and not exists(select 1 from public.dmcrm_opportunities where org_id=p_org and id=oid and customer_id=cid) then raise exception 'Opportunity unavailable' using errcode='42501';end if;
   select * into staff_row from public.dmcrm_staff where org_id=p_org and id=assignee and active for share;
   if staff_row.id is null then raise exception 'Select an active team member';end if;
   if not manager and assignee<>actor.id then raise exception 'Only managers can assign appointments to another user' using errcode='42501';end if;
   start_time:=(data->>'starts_at')::timestamptz;minutes:=(data->>'duration_minutes')::integer;
   if ap.status='arrived' and (ap.starts_at is distinct from start_time or ap.duration_minutes is distinct from minutes) then raise exception 'An arrived appointment cannot be rescheduled. Schedule another visit instead.';end if;
   if ap.id is null then
    insert into public.dmcrm_appointments(id,org_id,customer_id,opportunity_id,assigned_to,kind,starts_at,duration_minutes,description,created_by)
    values(rid,p_org,cid,oid,assignee,data->>'kind',start_time,minutes,trim(coalesce(data->>'description','')),p_actor);
    event:='scheduled';
   else
    if ap.opportunity_id is not distinct from oid and ap.assigned_to=assignee and ap.kind=data->>'kind' and ap.starts_at=start_time and ap.duration_minutes=minutes and ap.description=trim(coalesce(data->>'description','')) then return rid;end if;
    event:=case when ap.starts_at is distinct from start_time or ap.duration_minutes is distinct from minutes then 'rescheduled' else 'updated' end;
    update public.dmcrm_appointments set opportunity_id=oid,assigned_to=assignee,kind=data->>'kind',starts_at=start_time,duration_minutes=minutes,description=trim(coalesce(data->>'description','')),
      status=case when event='rescheduled' then 'scheduled' else status end,revision=revision+1,updated_at=now() where org_id=p_org and id=rid;
   end if;
  else
   new_status:=p_command->>'status';
   if ap.status=new_status then return rid;end if;
   if new_status is null or not (
     (ap.status='scheduled' and new_status in('confirmed','arrived','completed','no_show','canceled')) or
     (ap.status='confirmed' and new_status in('arrived','completed','no_show','canceled')) or
     (ap.status='arrived' and new_status in('completed','canceled'))
   ) then raise exception 'Invalid appointment status change';end if;
   update public.dmcrm_appointments set status=new_status,revision=revision+1,updated_at=now() where org_id=p_org and id=rid;
   if new_status='arrived' then
    oid:=ap.opportunity_id;
    if exists(select 1 from public.dmcrm_opportunities where org_id=p_org and id=oid and status='lost') then oid:=null;end if;
    perform public.dmcrm_command_v5(p_org,p_actor,jsonb_build_object('type','check_in','customer_id',ap.customer_id,'opportunity_id',oid));
   end if;
   event:=replace(new_status,'_','-');
  end if;
  perform public.dmcrm_log_appointment(p_org,p_actor,rid,event,old_record);
  insert into public.dmcrm_audit(org_id,actor,action,record_id) values(p_org,p_actor,typ,rid);
  return rid;
 end if;
 -- Creating a customer plus an appointment is one transaction: both save or neither does.
 rid:=public.dmcrm_command_v5(p_org,p_actor,p_command-'appointment');
 if typ='create_customer' and data is not null and data<>'null'::jsonb then
  select id into oid from public.dmcrm_opportunities where org_id=p_org and customer_id=rid order by created_at desc,id desc limit 1;
  perform public.dmcrm_command(p_org,p_actor,jsonb_build_object('type','save_appointment','id',data->'id','revision',0,
   'appointment',data||jsonb_build_object('customer_id',rid,'opportunity_id',oid)));
 elsif typ='set_staff_active' and not (p_command->>'active')::boolean then
  -- Explicit appointment assignments survive deal reassignment, but unfinished
  -- appointments must move to the selected replacement when a staff member leaves.
  for ap in select * from public.dmcrm_appointments where org_id=p_org and assigned_to=(p_command->>'id')::uuid and status in('scheduled','confirmed','arrived') for update loop
   update public.dmcrm_appointments set assigned_to=(p_command->>'reassign_to')::uuid,revision=revision+1,updated_at=now() where org_id=p_org and id=ap.id;
   perform public.dmcrm_log_appointment(p_org,p_actor,ap.id,'reassigned',to_jsonb(ap));
  end loop;
 end if;
 return rid;
end $$;
revoke all on function public.dmcrm_log_appointment(uuid,uuid,uuid,text,jsonb),public.dmcrm_command(uuid,uuid,jsonb) from public,anon,authenticated;
revoke all on function public.dmcrm_log_appointment(uuid,uuid,uuid,text,jsonb) from service_role;
grant execute on function public.dmcrm_command(uuid,uuid,jsonb) to service_role;
