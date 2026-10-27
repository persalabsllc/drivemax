-- Durable future-only email/task automations. SMS is intentionally not a delivery channel.
create table public.dmcrm_workflow_rules (
 id uuid primary key default gen_random_uuid(),org_id uuid not null references public.dmcrm_orgs(id),
 name text not null check(length(name) between 1 and 100),event text not null check(event in('new_lead','unsold_visit','sold','appointment_created','appointment_rescheduled','appointment_canceled','no_show','reminder_day','reminder_hour','birthday','anniversary')),
 channel text not null check(channel in('email','task')),template_id uuid,task_title text not null default '' check(length(task_title)<=250),
 delay_minutes integer not null default 0 check(delay_minutes between 0 and 527040),enabled boolean not null default true,
 business_hours boolean not null default true,stop_on_reply boolean not null default true,
 revision integer not null default 0,enabled_from timestamptz not null default now(),unique(org_id,id),
 foreign key(org_id,template_id) references public.dmcrm_email_templates(org_id,id),check((channel='email' and template_id is not null) or (channel='task' and length(task_title)>0))
);
create table public.dmcrm_workflow_jobs (
 id uuid primary key default gen_random_uuid(),org_id uuid not null,rule_id uuid not null,customer_id uuid not null,opportunity_id uuid,appointment_id uuid,
 event text not null,event_key text not null,anchor_at timestamptz not null,run_at timestamptz not null,
 state text not null default 'scheduled' check(state in('scheduled','queued','completed','skipped','canceled')),
 reason text not null default '',message_id uuid,task_id uuid,context jsonb not null default '{}',created_at timestamptz not null default now(),
 unique(rule_id,event_key),foreign key(org_id,rule_id) references public.dmcrm_workflow_rules(org_id,id),
 foreign key(org_id,customer_id) references public.dmcrm_customers(org_id,id),foreign key(org_id,opportunity_id) references public.dmcrm_opportunities(org_id,id),
 foreign key(org_id,appointment_id) references public.dmcrm_appointments(org_id,id),foreign key(org_id,message_id) references public.dmcrm_messages(org_id,id)
);
create index dmcrm_workflow_due on public.dmcrm_workflow_jobs(run_at) where state in('scheduled','queued');
create table public.dmcrm_workflow_pauses(org_id uuid not null,customer_id uuid not null,paused boolean not null default false,primary key(org_id,customer_id),foreign key(org_id,customer_id) references public.dmcrm_customers(org_id,id));
create table public.dmcrm_workflow_contacts(org_id uuid not null,customer_id uuid not null,token uuid not null unique default gen_random_uuid(),primary key(org_id,customer_id),foreign key(org_id,customer_id) references public.dmcrm_customers(org_id,id));
create table public.dmcrm_appointment_links(org_id uuid not null,appointment_id uuid primary key,token uuid not null unique default gen_random_uuid(),starts_at timestamptz not null,request text not null default '',requested_at timestamptz,foreign key(org_id,appointment_id) references public.dmcrm_appointments(org_id,id));
create table public.dmcrm_workflow_health(org_id uuid primary key references public.dmcrm_orgs(id),last_run_at timestamptz,last_background_at timestamptz,last_worker_at timestamptz);
do $$ declare tbl text;begin
 foreach tbl in array array['dmcrm_workflow_rules','dmcrm_workflow_jobs','dmcrm_workflow_pauses','dmcrm_workflow_contacts','dmcrm_appointment_links','dmcrm_workflow_health'] loop
 execute format('alter table public.%I enable row level security',tbl);execute format('revoke all on public.%I from public,anon,authenticated',tbl);execute format('grant all on public.%I to service_role',tbl);
 end loop;
end $$;
create or replace function public.dmcrm_email_template_valid(p_text text) returns boolean language sql immutable set search_path='' as $$
 select p_text is not null and regexp_replace(p_text,'\{\{[[:space:]]*(first_name|customer_name|vehicle|salesperson|dealership|phone|website|appointment_time|appointment_type|appointment_link|address)[[:space:]]*\}\}','','g') not like '%{{%';
$$;
-- These tokens are opaque and never included in staff workspace responses.
create function public.dmcrm_workflow_enroll(p_org uuid,p_customer uuid,p_opportunity uuid,p_appointment uuid,p_event text,p_key text,p_anchor timestamptz,p_context jsonb default '{}') returns void
language plpgsql security definer set search_path='' as $$
declare r public.dmcrm_workflow_rules%rowtype;due timestamptz;
begin
 for r in select * from public.dmcrm_workflow_rules where org_id=p_org and event=p_event and enabled and enabled_from<=p_anchor loop
  due:=case when p_event in('reminder_day','reminder_hour') then (p_context->>'starts_at')::timestamptz-make_interval(mins=>r.delay_minutes) else p_anchor+make_interval(mins=>r.delay_minutes) end;
  if p_event in('reminder_day','reminder_hour') and due<p_anchor then continue;end if;
  insert into public.dmcrm_workflow_jobs(org_id,rule_id,customer_id,opportunity_id,appointment_id,event,event_key,anchor_at,run_at,context)
   values(p_org,r.id,p_customer,p_opportunity,p_appointment,p_event,p_key,p_anchor,due,p_context) on conflict(rule_id,event_key) do nothing;
 end loop;
end $$;
create function public.dmcrm_workflow_event() returns trigger language plpgsql security definer set search_path='' as $$
declare event_name text;payload jsonb;key text;
begin
 if tg_table_name='dmcrm_opportunities' then
  if tg_op='INSERT' and new.status not in('sold','lost') then event_name:='new_lead';
  elsif tg_op='UPDATE' and new.status='sold' and old.status<>'sold' then event_name:='sold';end if;
  if event_name is not null then perform public.dmcrm_workflow_enroll(new.org_id,new.customer_id,new.id,null,event_name,new.id::text||':'||event_name||':'||new.updated_at::text,now());end if;
 elsif tg_table_name='dmcrm_visits' then
  if new.departed_at is not null and old.departed_at is null and new.outcome='unsold' then perform public.dmcrm_workflow_enroll(new.org_id,new.customer_id,new.opportunity_id,null,'unsold_visit',new.id::text,now());end if;
 elsif tg_table_name='dmcrm_appointments' then
  payload:=jsonb_build_object('starts_at',new.starts_at);
  if tg_op='INSERT' then event_name:='appointment_created';
  elsif new.starts_at is distinct from old.starts_at then event_name:='appointment_rescheduled';
  elsif new.status='no_show' and old.status<>'no_show' then event_name:='no_show';
  elsif new.status='canceled' and old.status<>'canceled' then event_name:='appointment_canceled';end if;
  if event_name is not null then
   key:=new.id::text||':'||new.revision::text;
   insert into public.dmcrm_appointment_links(org_id,appointment_id,starts_at) values(new.org_id,new.id,new.starts_at)
    on conflict(appointment_id) do update set token=case when dmcrm_appointment_links.starts_at<>excluded.starts_at then gen_random_uuid() else dmcrm_appointment_links.token end,starts_at=excluded.starts_at,request='',requested_at=null;
   perform public.dmcrm_workflow_enroll(new.org_id,new.customer_id,new.opportunity_id,new.id,event_name,key,now(),payload);
   if event_name in('appointment_created','appointment_rescheduled') and new.starts_at>now() then
    perform public.dmcrm_workflow_enroll(new.org_id,new.customer_id,new.opportunity_id,new.id,'reminder_day',key,now(),payload);
    perform public.dmcrm_workflow_enroll(new.org_id,new.customer_id,new.opportunity_id,new.id,'reminder_hour',key,now(),payload);
   end if;
  end if;
 end if;
 return new;
end $$;
create trigger dmcrm_workflow_opportunity after insert or update of status on public.dmcrm_opportunities for each row execute function public.dmcrm_workflow_event();
create trigger dmcrm_workflow_visit after update of departed_at on public.dmcrm_visits for each row execute function public.dmcrm_workflow_event();
create trigger dmcrm_workflow_appointment after insert or update on public.dmcrm_appointments for each row execute function public.dmcrm_workflow_event();

create function public.dmcrm_workflow_stop_reason(j public.dmcrm_workflow_jobs) returns text language plpgsql stable security definer set search_path='' as $$
declare r public.dmcrm_workflow_rules%rowtype;c public.dmcrm_customers%rowtype;o public.dmcrm_opportunities%rowtype;a public.dmcrm_appointments%rowtype;
begin
 select * into r from public.dmcrm_workflow_rules where id=j.rule_id;
 select * into c from public.dmcrm_customers where org_id=j.org_id and id=j.customer_id;
 select * into o from public.dmcrm_opportunities where org_id=j.org_id and id=j.opportunity_id;
 if not r.enabled then return 'Workflow turned off';end if;
 if r.event<>j.event then return 'Workflow event changed';end if;
 if exists(select 1 from public.dmcrm_workflow_pauses where org_id=j.org_id and customer_id=j.customer_id and paused) then return 'Automatic follow-up paused';end if;
 if r.channel='email' and (c.email_opt_out or exists(select 1 from public.dmcrm_email_suppressions where org_id=j.org_id and email=lower(trim(c.email)))) then return 'Email stopped for this customer';end if;
 if r.stop_on_reply and exists(select 1 from public.dmcrm_messages where org_id=j.org_id and customer_id=j.customer_id and direction='inbound' and created_at>j.anchor_at and (opportunity_id=j.opportunity_id or opportunity_id is null or j.opportunity_id is null)) then return 'Customer replied; personal follow-up needed';end if;
 if j.event in('new_lead','unsold_visit') then
  if o.status in('sold','lost') then return 'Opportunity closed';end if;
  if exists(select 1 from public.dmcrm_appointments where org_id=j.org_id and customer_id=j.customer_id and status in('scheduled','confirmed','arrived') and (opportunity_id=j.opportunity_id or opportunity_id is null) and starts_at>j.anchor_at) then return 'Appointment arranged';end if;
 end if;
 if j.event in('sold','anniversary') and o.status is distinct from 'sold' then return 'Sale no longer active';end if;
 if j.appointment_id is not null then
  select * into a from public.dmcrm_appointments where org_id=j.org_id and id=j.appointment_id;
  if a.id is null or a.starts_at is distinct from (j.context->>'starts_at')::timestamptz then return 'Appointment time changed';end if;
  if j.event='no_show' then
   if a.status<>'no_show' then return 'Appointment outcome changed';end if;
   if exists(select 1 from public.dmcrm_appointments where org_id=j.org_id and customer_id=j.customer_id and id<>a.id and created_at>=j.anchor_at and status in('scheduled','confirmed','arrived','completed')) then return 'Another appointment arranged';end if;
  elsif j.event='appointment_canceled' then if a.status<>'canceled' then return 'Appointment outcome changed';end if;
  elsif a.status not in('scheduled','confirmed') or a.starts_at<=now() then return 'Appointment is no longer upcoming';end if;
 end if;
 return null;
end $$;

create function public.dmcrm_workflow_prepare() returns integer language plpgsql security definer set search_path='' as $$
declare j public.dmcrm_workflow_jobs%rowtype;r public.dmcrm_workflow_rules%rowtype;c public.dmcrm_customers%rowtype;o public.dmcrm_opportunities%rowtype;
 a public.dmcrm_appointments%rowtype;t public.dmcrm_email_templates%rowtype;st public.dmcrm_staff%rowtype;ctx jsonb;why text;mid uuid;tid uuid;token uuid;link_token uuid;body_text text;subject_text text;signature text;n integer:=0;local_time timestamp;item record;
begin
 if not pg_try_advisory_xact_lock(76102715) then return 0;end if;
 -- Daily recurring events enroll once per calendar year; historical emails are never backfilled.
 for item in select c1.org_id,c1.id from public.dmcrm_customers c1 where to_char(c1.birthday,'MM-DD')=to_char(now() at time zone 'America/New_York','MM-DD') or (to_char(c1.birthday,'MM-DD')='02-29' and to_char(now() at time zone 'America/New_York','MM-DD')='02-28' and extract(day from (date_trunc('year',now())+interval '2 months'-interval '1 day'))=28) loop
  perform public.dmcrm_workflow_enroll(item.org_id,item.id,null,null,'birthday',item.id::text||':'||to_char(now() at time zone 'America/New_York','YYYY'),date_trunc('day',now() at time zone 'America/New_York') at time zone 'America/New_York');
 end loop;
 for item in select o1.* from public.dmcrm_opportunities o1 where o1.status='sold' and o1.sold_on<(now() at time zone 'America/New_York')::date and to_char(o1.sold_on,'MM-DD')=to_char(now() at time zone 'America/New_York','MM-DD') loop
  perform public.dmcrm_workflow_enroll(item.org_id,item.customer_id,item.id,null,'anniversary',item.id::text||':'||to_char(now() at time zone 'America/New_York','YYYY'),date_trunc('day',now() at time zone 'America/New_York') at time zone 'America/New_York');
 end loop;
 for j in select * from public.dmcrm_workflow_jobs where state in('scheduled','queued') order by run_at,id for update skip locked limit 1000 loop
  why:=public.dmcrm_workflow_stop_reason(j);
  if why is not null then
   update public.dmcrm_email_outbox set state='canceled',last_error=why where message_id=j.message_id and state='pending';
   update public.dmcrm_messages set status='canceled',error=why,updated_at=now() where id=j.message_id and status='queued' and exists(select 1 from public.dmcrm_email_outbox where message_id=j.message_id and state='canceled');
   update public.dmcrm_workflow_jobs set state='canceled',reason=why where id=j.id and (message_id is null or exists(select 1 from public.dmcrm_email_outbox where message_id=j.message_id and state='canceled'));
   continue;
  end if;
  if j.state<>'scheduled' or j.run_at>now() then continue;end if;
  -- Multiple opportunities or a return visit must not stack sales emails on one person.
  if j.event in('new_lead','unsold_visit') and exists(
   select 1 from public.dmcrm_workflow_jobs other join public.dmcrm_workflow_rules other_rule on other_rule.id=other.rule_id
   join public.dmcrm_messages msg on msg.id=other.message_id
   where other.org_id=j.org_id and other.customer_id=j.customer_id and other.id<>j.id
    and other.event in('new_lead','unsold_visit') and other_rule.channel='email' and msg.status in('queued','sent','delivered')
    and msg.created_at>=now()-interval '20 hours'
  ) and exists(select 1 from public.dmcrm_workflow_rules where id=j.rule_id and channel='email') then
   update public.dmcrm_workflow_jobs set state='skipped',reason='Another sales follow-up was already queued recently' where id=j.id;continue;
  end if;
  -- Do not blast missed nurture emails after an outage.
  if j.run_at<now()-interval '48 hours' then update public.dmcrm_workflow_jobs set state='skipped',reason='Scheduled time expired; review manually' where id=j.id;continue;end if;
  select * into r from public.dmcrm_workflow_rules where id=j.rule_id;
  local_time:=now() at time zone 'America/New_York';
  if r.business_hours and (local_time::time<'09:00'::time or local_time::time>='18:00'::time) then continue;end if;
  select * into c from public.dmcrm_customers where org_id=j.org_id and id=j.customer_id;
  select * into o from public.dmcrm_opportunities where org_id=j.org_id and id=j.opportunity_id;
  select * into a from public.dmcrm_appointments where org_id=j.org_id and id=j.appointment_id;
  select * into st from public.dmcrm_staff where org_id=j.org_id and id=coalesce(a.assigned_to,o.assigned_to,c.assigned_to) and active;
  if r.channel='task' then
   tid:=gen_random_uuid();
   insert into public.dmcrm_tasks(id,org_id,customer_id,opportunity_id,title,due_date,kind,channel,assigned_to)
    values(tid,j.org_id,c.id,o.id,r.task_title,(now() at time zone 'America/New_York')::date,'task','task',st.id);
   update public.dmcrm_workflow_jobs set state='completed',task_id=tid where id=j.id;n:=n+1;continue;
  end if;
  if trim(c.email) !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then update public.dmcrm_workflow_jobs set state='skipped',reason='No valid email address' where id=j.id;continue;end if;
  select * into t from public.dmcrm_email_templates where org_id=j.org_id and id=r.template_id;
  insert into public.dmcrm_workflow_contacts(org_id,customer_id) values(j.org_id,c.id) on conflict do nothing;
  select wc.token into token from public.dmcrm_workflow_contacts wc where org_id=j.org_id and customer_id=c.id;
  select al.token into link_token from public.dmcrm_appointment_links al where org_id=j.org_id and appointment_id=a.id;
  ctx:=jsonb_build_object('first_name',coalesce(nullif(c.person->>'first_name',''),nullif(split_part(c.name,' ',1),''),'there'),'customer_name',c.name,'vehicle',coalesce(nullif(o.vehicle_interest,''),'your next vehicle'),
   'salesperson',coalesce(st.name,'Drive Max team'),'dealership','Drive Max Used Cars','phone','(252) 541-0040','website','https://www.drivemaxusedcars.com','address','6210 Old US Hwy 70 W, New Bern, NC 28562',
   'appointment_time',case when a.id is null then '' else to_char(a.starts_at at time zone 'America/New_York','FMDay, FMMonth DD, YYYY at HH12:MI AM')||' Eastern' end,
   'appointment_type',coalesce(replace(a.kind,'_',' '),''),'appointment_link',case when link_token is null then '' else 'https://crm.drivemaxusedcars.com/appointment/'||link_token::text end);
  select es.body into signature from public.dmcrm_email_signatures es where es.org_id=j.org_id and es.user_id=st.user_id;
  if signature is null then select auto_reply_signature into signature from public.dmcrm_email_settings where org_id=j.org_id;end if;
  subject_text:=left(regexp_replace(public.dmcrm_email_render(t.subject,ctx),E'[\r\n]+',' ','g'),250);
  body_text:=public.dmcrm_email_render(t.body,ctx)||E'\n\n'||coalesce(signature,'Drive Max Used Cars')||E'\n\nEmail preferences: https://crm.drivemaxusedcars.com/email-preferences/'||token::text;
  if length(body_text)>16000 then update public.dmcrm_workflow_jobs set state='skipped',reason='Personalized message is too long' where id=j.id;continue;end if;
  mid:=gen_random_uuid();
  insert into public.dmcrm_messages(id,org_id,customer_id,opportunity_id,channel,direction,status,recipient,subject,body,created_by)
   values(mid,j.org_id,c.id,o.id,'email','outbound','queued',lower(trim(c.email)),subject_text,body_text,'00000000-0000-4000-8000-000000000000');
  insert into public.dmcrm_email_outbox(message_id,org_id,recipient,subject,body,sender_name) values(mid,j.org_id,lower(trim(c.email)),subject_text,body_text,coalesce(st.name,'Drive Max team'));
  update public.dmcrm_workflow_jobs set state='queued',message_id=mid where id=j.id;n:=n+1;
 end loop;
 insert into public.dmcrm_workflow_health(org_id,last_run_at) select id,now() from public.dmcrm_orgs on conflict(org_id) do update set last_run_at=excluded.last_run_at;
 return n;
end $$;

-- The established transport retains provider idempotency, suppression and retry handling.
alter function public.dmcrm_email_claim(uuid) rename to dmcrm_email_claim_v14;
create function public.dmcrm_email_claim(p_id uuid default null) returns setof public.dmcrm_email_outbox language plpgsql security definer set search_path='' as $$
begin perform public.dmcrm_workflow_prepare();return query select * from public.dmcrm_email_claim_v14(p_id);end $$;
create function public.dmcrm_workflow_delivery() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.state in('sent','failed','canceled') then update public.dmcrm_workflow_jobs set state=case when new.state='sent' then 'completed' when new.state='canceled' then 'canceled' else 'skipped' end,reason=coalesce(new.last_error,'') where message_id=new.message_id;end if;return new;
end $$;
create trigger dmcrm_workflow_delivery after update of state on public.dmcrm_email_outbox for each row execute function public.dmcrm_workflow_delivery();

alter function public.dmcrm_command(uuid,uuid,jsonb) rename to dmcrm_command_v14;
create function public.dmcrm_command(p_org uuid,p_actor uuid,p_command jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare typ text:=p_command->>'type';a public.dmcrm_staff%rowtype;r public.dmcrm_workflow_rules%rowtype;j public.dmcrm_workflow_jobs%rowtype;rid uuid:=(p_command->>'id')::uuid;v jsonb:=p_command->'rule';cid uuid;revision integer:=(p_command->>'revision')::integer;
begin
 if typ not in('save_workflow_rule','delete_workflow_rule','pause_customer_workflows','cancel_workflow_job') then
  if typ='delete_email_template' and exists(select 1 from public.dmcrm_workflow_rules where org_id=p_org and template_id=rid) then raise exception 'This template is used by an automation. Change the automation first.';end if;
  return public.dmcrm_command_v14(p_org,p_actor,p_command);
 end if;
 select s.* into a from public.dmcrm_staff s join public.dmcrm_members m on m.org_id=s.org_id and m.user_id=s.user_id where s.org_id=p_org and s.user_id=p_actor and s.active and m.active for share of s,m;
 if a.id is null then raise exception 'CRM membership required' using errcode='42501';end if;
 if typ in('save_workflow_rule','delete_workflow_rule') then
  if a.role not in('owner','manager') then raise exception 'Manager access required' using errcode='42501';end if;
  perform pg_advisory_xact_lock(hashtextextended('dmcrm:rule:'||rid::text,0));
  select * into r from public.dmcrm_workflow_rules where id=rid for update;
  if r.id is not null and r.org_id<>p_org then raise exception 'Workflow unavailable' using errcode='42501';end if;
  if revision is distinct from coalesce(r.revision,0) then raise exception 'Workflow changed. Refresh before saving.';end if;
  if r.id is not null and typ='save_workflow_rule' and (r.event is distinct from v->>'event' or r.channel is distinct from v->>'channel') then
   update public.dmcrm_email_outbox set state='canceled',last_error='Workflow action changed' where state='pending' and message_id in(select message_id from public.dmcrm_workflow_jobs where rule_id=rid and state='queued');
   update public.dmcrm_messages set status='canceled',error='Workflow action changed',updated_at=now() where status='queued' and id in(select message_id from public.dmcrm_workflow_jobs where rule_id=rid) and exists(select 1 from public.dmcrm_email_outbox where message_id=dmcrm_messages.id and state='canceled');
   update public.dmcrm_workflow_jobs set state='canceled',reason='Workflow action changed' where rule_id=rid and state='scheduled';
  end if;
  if typ='delete_workflow_rule' then
   update public.dmcrm_workflow_rules set enabled=false,revision=dmcrm_workflow_rules.revision+1 where id=rid;
  else
   insert into public.dmcrm_workflow_rules(id,org_id,name,event,channel,template_id,task_title,delay_minutes,enabled,business_hours,stop_on_reply)
    values(rid,p_org,v->>'name',v->>'event',v->>'channel',(v->>'template_id')::uuid,v->>'task_title',(v->>'delay_minutes')::integer,(v->>'enabled')::boolean,(v->>'business_hours')::boolean,(v->>'stop_on_reply')::boolean)
    on conflict(id) do update set name=excluded.name,event=excluded.event,channel=excluded.channel,template_id=excluded.template_id,task_title=excluded.task_title,delay_minutes=excluded.delay_minutes,enabled=excluded.enabled,business_hours=excluded.business_hours,stop_on_reply=excluded.stop_on_reply,revision=dmcrm_workflow_rules.revision+1,enabled_from=case when not dmcrm_workflow_rules.enabled and excluded.enabled then now() else dmcrm_workflow_rules.enabled_from end;
  end if;
 elsif typ='pause_customer_workflows' then
  cid:=(p_command->>'customer_id')::uuid;
  if not exists(select 1 from public.dmcrm_customers where org_id=p_org and id=cid and (a.role in('owner','manager') or assigned_to=a.id or exists(select 1 from public.dmcrm_opportunities where org_id=p_org and customer_id=cid and assigned_to=a.id))) then raise exception 'Assigned salesperson or manager required' using errcode='42501';end if;
  insert into public.dmcrm_workflow_pauses(org_id,customer_id,paused) values(p_org,cid,(p_command->>'paused')::boolean) on conflict(org_id,customer_id) do update set paused=excluded.paused;
  insert into public.dmcrm_activities(org_id,customer_id,kind,body,created_by) values(p_org,cid,'system',case when (p_command->>'paused')::boolean then 'Automatic follow-up paused. Scheduled emails will be canceled.' else 'Automatic follow-up resumed for future events. Canceled emails will not be resent.' end,a.name);rid:=cid;
 else
  select * into j from public.dmcrm_workflow_jobs where org_id=p_org and id=rid for update;
  if j.id is null or (a.role not in('owner','manager') and not exists(select 1 from public.dmcrm_customers where org_id=p_org and id=j.customer_id and assigned_to=a.id) and not exists(select 1 from public.dmcrm_opportunities where org_id=p_org and id=j.opportunity_id and assigned_to=a.id)) then raise exception 'Assigned salesperson or manager required' using errcode='42501';end if;
  if j.state='scheduled' then update public.dmcrm_workflow_jobs set state='canceled',reason='Canceled by staff' where id=rid;
  elsif j.state='queued' then
   update public.dmcrm_email_outbox set state='canceled',last_error='Canceled by staff' where message_id=j.message_id and state='pending';
   if not found then raise exception 'This email has already entered delivery';end if;
   update public.dmcrm_messages set status='canceled',error='Canceled by staff',updated_at=now() where id=j.message_id and status='queued';
  end if;
 end if;
 -- Cancel immediately even if the transport is temporarily unavailable.
 if typ in('pause_customer_workflows','delete_workflow_rule','save_workflow_rule') then
  for j in select * from public.dmcrm_workflow_jobs where org_id=p_org and state in('scheduled','queued') loop
   if public.dmcrm_workflow_stop_reason(j) is not null then
    update public.dmcrm_email_outbox set state='canceled',last_error=public.dmcrm_workflow_stop_reason(j) where message_id=j.message_id and state='pending';
    update public.dmcrm_messages set status='canceled',error=public.dmcrm_workflow_stop_reason(j),updated_at=now() where id=j.message_id and status='queued' and exists(select 1 from public.dmcrm_email_outbox where message_id=j.message_id and state='canceled');
    update public.dmcrm_workflow_jobs set state='canceled',reason=public.dmcrm_workflow_stop_reason(j) where id=j.id and (message_id is null or exists(select 1 from public.dmcrm_email_outbox where message_id=j.message_id and state='canceled'));
   end if;
  end loop;
 end if;
 return rid;
end $$;

create function public.dmcrm_public_appointment(p_token uuid,p_action text default 'view',p_request text default '') returns jsonb language plpgsql security definer set search_path='' as $$
declare l public.dmcrm_appointment_links%rowtype;a public.dmcrm_appointments%rowtype;actor uuid;taskid uuid;
begin
 select * into l from public.dmcrm_appointment_links where token=p_token for update;
 if l.appointment_id is null then return null;end if;
 select * into a from public.dmcrm_appointments where org_id=l.org_id and id=l.appointment_id for update;
 if a.starts_at<now()-interval '30 days' then return null;end if;
 if p_action='confirm' and a.status='scheduled' and a.starts_at>now() then
  select user_id into actor from public.dmcrm_staff where org_id=a.org_id and id=a.assigned_to;
  update public.dmcrm_appointments set status='confirmed',revision=revision+1,updated_at=now() where id=a.id;
  insert into public.dmcrm_activities(org_id,customer_id,opportunity_id,kind,body,created_by) values(a.org_id,a.customer_id,a.opportunity_id,'system','Customer confirmed their appointment online.','Customer');
  a.status:='confirmed';
 elsif p_action='request' and length(trim(p_request)) between 1 and 1000 and a.status not in('arrived','completed') then
  if l.requested_at is not null and l.requested_at>now()-interval '10 minutes' then return jsonb_build_object('status',a.status,'request_received',true,'starts_at',a.starts_at,'duration_minutes',a.duration_minutes,'kind',a.kind);end if;
  update public.dmcrm_appointment_links set request=trim(p_request),requested_at=now() where appointment_id=a.id;
  insert into public.dmcrm_tasks(org_id,customer_id,opportunity_id,assigned_to,title,due_date,kind,channel) values(a.org_id,a.customer_id,a.opportunity_id,a.assigned_to,'Customer requested an appointment change',(now() at time zone 'America/New_York')::date,'task','call');
  insert into public.dmcrm_messages(id,org_id,customer_id,opportunity_id,channel,direction,status,recipient,subject,body,created_by) values(gen_random_uuid(),a.org_id,a.customer_id,a.opportunity_id,'email','inbound','received',coalesce((select nullif(trim(email),'') from public.dmcrm_customers where id=a.customer_id),'Appointment response'),'Appointment change requested',trim(p_request),'00000000-0000-4000-8000-000000000000');
  insert into public.dmcrm_activities(org_id,customer_id,opportunity_id,kind,body,created_by) values(a.org_id,a.customer_id,a.opportunity_id,'system','Customer requested a different appointment time: '||trim(p_request),'Customer');
 end if;
 return jsonb_build_object('status',a.status,'request_received',p_action='request' or l.requested_at is not null,'starts_at',a.starts_at,'duration_minutes',a.duration_minutes,'kind',a.kind);
end $$;
create function public.dmcrm_public_unsubscribe(p_token uuid,p_confirm boolean default false) returns boolean language plpgsql security definer set search_path='' as $$
declare c public.dmcrm_customers%rowtype;
begin
 select c1.* into c from public.dmcrm_workflow_contacts wc join public.dmcrm_customers c1 on c1.org_id=wc.org_id and c1.id=wc.customer_id where wc.token=p_token;
 if c.id is null then return false;end if;
 if p_confirm then
  update public.dmcrm_customers set email_opt_out=true where id=c.id;
  insert into public.dmcrm_email_suppressions(org_id,email,reason) values(c.org_id,lower(trim(c.email)),'Customer requested no email') on conflict do nothing;
  if not c.email_opt_out then insert into public.dmcrm_activities(org_id,customer_id,kind,body,created_by) values(c.org_id,c.id,'system','Customer unsubscribed from CRM email.','Customer');end if;
 end if;return true;
end $$;

revoke all on function public.dmcrm_workflow_enroll(uuid,uuid,uuid,uuid,text,text,timestamptz,jsonb),public.dmcrm_workflow_event(),public.dmcrm_workflow_stop_reason(public.dmcrm_workflow_jobs),public.dmcrm_workflow_prepare(),public.dmcrm_email_claim_v14(uuid),public.dmcrm_email_claim(uuid),public.dmcrm_workflow_delivery(),public.dmcrm_command_v14(uuid,uuid,jsonb),public.dmcrm_command(uuid,uuid,jsonb),public.dmcrm_public_appointment(uuid,text,text),public.dmcrm_public_unsubscribe(uuid,boolean) from public,anon,authenticated,service_role;
grant execute on function public.dmcrm_workflow_prepare(),public.dmcrm_email_claim(uuid),public.dmcrm_command(uuid,uuid,jsonb),public.dmcrm_public_appointment(uuid,text,text),public.dmcrm_public_unsubscribe(uuid,boolean) to service_role;

-- Seed editable appointment templates and future-event workflows.
insert into public.dmcrm_email_templates(org_id,name,category,subject,body,system_key) select id,'Appointment · confirmation','Other','Your Drive Max appointment','Hi {{first_name}},

You''re scheduled for {{appointment_type}} at Drive Max on {{appointment_time}} with {{salesperson}}.

Visit us at {{address}}.

Confirm your visit, request a different time, or add it to your calendar here:
{{appointment_link}}

We look forward to seeing you!','appt-created' from public.dmcrm_orgs on conflict(org_id,system_key) do nothing;
insert into public.dmcrm_email_templates(org_id,name,category,subject,body,system_key) select id,'Appointment · new time','Other','Your Drive Max appointment has been rescheduled','Hi {{first_name}},

Your appointment has been moved to {{appointment_time}} with {{salesperson}}.

Visit us at {{address}}. Please use this updated link to confirm or add the new time to your calendar:
{{appointment_link}}

Reply here if you need anything before your visit.','appt-rescheduled' from public.dmcrm_orgs on conflict(org_id,system_key) do nothing;
insert into public.dmcrm_email_templates(org_id,name,category,subject,body,system_key) select id,'Appointment · reminder','Other','A reminder about your Drive Max visit','Hi {{first_name}},

We''re looking forward to your {{appointment_type}} appointment on {{appointment_time}} with {{salesperson}}.

Our address is {{address}}.

Confirm, request another time, or add this appointment to your calendar:
{{appointment_link}}

Questions? Reply here or call {{phone}}.','appt-reminder' from public.dmcrm_orgs on conflict(org_id,system_key) do nothing;
insert into public.dmcrm_email_templates(org_id,name,category,subject,body,system_key) select id,'Appointment · missed visit','Other','Would another time work better?','Hi {{first_name}},

We missed you at your Drive Max appointment. No worries—plans change!

If you''re still interested, reply with a day and time that works better, or request another visit here:
{{appointment_link}}

We''re happy to help. You can also reach us at {{phone}}.','appt-missed' from public.dmcrm_orgs on conflict(org_id,system_key) do nothing;
insert into public.dmcrm_email_templates(org_id,name,category,subject,body,system_key) select id,'Appointment · cancellation','Other','Your Drive Max appointment was canceled','Hi {{first_name}},

Your appointment for {{appointment_time}} has been canceled.

If you''d like to arrange another visit, reply to this email or call {{phone}}. We''re here whenever you''re ready.','appt-canceled' from public.dmcrm_orgs on conflict(org_id,system_key) do nothing;
insert into public.dmcrm_email_templates(org_id,name,category,subject,body,system_key) select id,'Purchase anniversary · thank you','Other','Happy vehicle anniversary!','Hi {{first_name}},

Happy anniversary of your purchase of {{vehicle}}! Thank you again for choosing Drive Max.

If your vehicle needs have changed or you have a question, just reply. We''re happy to help.','purchase-anniversary' from public.dmcrm_orgs on conflict(org_id,system_key) do nothing;
insert into public.dmcrm_workflow_rules(org_id,name,event,channel,template_id,delay_minutes,business_hours,stop_on_reply) select org_id,'New lead · day 1','new_lead','email',id,1440,true,true from public.dmcrm_email_templates where system_key='day-1';
insert into public.dmcrm_workflow_rules(org_id,name,event,channel,template_id,delay_minutes,business_hours,stop_on_reply) select org_id,'New lead · day 2','new_lead','email',id,2880,true,true from public.dmcrm_email_templates where system_key='day-2';
insert into public.dmcrm_workflow_rules(org_id,name,event,channel,template_id,delay_minutes,business_hours,stop_on_reply) select org_id,'New lead · day 3','new_lead','email',id,4320,true,true from public.dmcrm_email_templates where system_key='day-3';
insert into public.dmcrm_workflow_rules(org_id,name,event,channel,template_id,delay_minutes,business_hours,stop_on_reply) select org_id,'New lead · day 4','new_lead','email',id,5760,true,true from public.dmcrm_email_templates where system_key='day-4';
insert into public.dmcrm_workflow_rules(org_id,name,event,channel,template_id,delay_minutes,business_hours,stop_on_reply) select org_id,'New lead · day 5','new_lead','email',id,7200,true,true from public.dmcrm_email_templates where system_key='day-5';
insert into public.dmcrm_workflow_rules(org_id,name,event,channel,template_id,delay_minutes,business_hours,stop_on_reply) select org_id,'New lead · day 6','new_lead','email',id,8640,true,true from public.dmcrm_email_templates where system_key='day-6';
insert into public.dmcrm_workflow_rules(org_id,name,event,channel,template_id,delay_minutes,business_hours,stop_on_reply) select org_id,'Unsold visit · next day','unsold_visit','email',id,1440,true,true from public.dmcrm_email_templates where system_key='day-1';
insert into public.dmcrm_workflow_rules(org_id,name,event,channel,template_id,delay_minutes,business_hours,stop_on_reply) select org_id,'Sold · thank you','sold','email',id,0,true,false from public.dmcrm_email_templates where system_key='sold';
insert into public.dmcrm_workflow_rules(org_id,name,event,channel,template_id,delay_minutes,business_hours,stop_on_reply) select org_id,'Sold · 7-day check-in','sold','email',id,10080,true,true from public.dmcrm_email_templates where system_key='sold-7';
insert into public.dmcrm_workflow_rules(org_id,name,event,channel,template_id,delay_minutes,business_hours,stop_on_reply) select org_id,'Sold · six months','sold','email',id,262800,true,true from public.dmcrm_email_templates where system_key='anniversary-6';
insert into public.dmcrm_workflow_rules(org_id,name,event,channel,template_id,delay_minutes,business_hours,stop_on_reply) select org_id,'Birthday wishes','birthday','email',id,600,true,false from public.dmcrm_email_templates where system_key='birthday';
insert into public.dmcrm_workflow_rules(org_id,name,event,channel,template_id,delay_minutes,business_hours,stop_on_reply) select org_id,'Purchase anniversary','anniversary','email',id,600,true,false from public.dmcrm_email_templates where system_key='purchase-anniversary';
insert into public.dmcrm_workflow_rules(org_id,name,event,channel,template_id,delay_minutes,business_hours,stop_on_reply) select org_id,'Appointment confirmation','appointment_created','email',id,0,false,false from public.dmcrm_email_templates where system_key='appt-created';
insert into public.dmcrm_workflow_rules(org_id,name,event,channel,template_id,delay_minutes,business_hours,stop_on_reply) select org_id,'Appointment rescheduled','appointment_rescheduled','email',id,0,false,false from public.dmcrm_email_templates where system_key='appt-rescheduled';
insert into public.dmcrm_workflow_rules(org_id,name,event,channel,template_id,delay_minutes,business_hours,stop_on_reply) select org_id,'Appointment canceled','appointment_canceled','email',id,0,false,false from public.dmcrm_email_templates where system_key='appt-canceled';
insert into public.dmcrm_workflow_rules(org_id,name,event,channel,template_id,delay_minutes,business_hours,stop_on_reply) select org_id,'Missed appointment','no_show','email',id,0,true,true from public.dmcrm_email_templates where system_key='appt-missed';
insert into public.dmcrm_workflow_rules(org_id,name,event,channel,template_id,delay_minutes,business_hours,stop_on_reply) select org_id,'Appointment · day-before reminder','reminder_day','email',id,1440,true,false from public.dmcrm_email_templates where system_key='appt-reminder';
insert into public.dmcrm_workflow_rules(org_id,name,event,channel,template_id,delay_minutes,business_hours,stop_on_reply) select org_id,'Appointment · two-hour reminder','reminder_hour','email',id,120,false,false from public.dmcrm_email_templates where system_key='appt-reminder';

-- Existing future appointments get reminders only, never a retroactive confirmation.
do $$ declare a public.dmcrm_appointments%rowtype;begin for a in select * from public.dmcrm_appointments where starts_at>now() and status in('scheduled','confirmed') loop
insert into public.dmcrm_appointment_links(org_id,appointment_id,starts_at) values(a.org_id,a.id,a.starts_at) on conflict do nothing;
perform public.dmcrm_workflow_enroll(a.org_id,a.customer_id,a.opportunity_id,a.id,'reminder_day',a.id::text||':rollout',now(),jsonb_build_object('starts_at',a.starts_at));
perform public.dmcrm_workflow_enroll(a.org_id,a.customer_id,a.opportunity_id,a.id,'reminder_hour',a.id::text||':rollout',now(),jsonb_build_object('starts_at',a.starts_at));
end loop;end $$;
