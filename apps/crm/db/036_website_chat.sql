-- Website chat uses opaque visitor credentials and a separate, narrow service API.
-- No public browser can read CRM tables or invoke the staff API directly.
create table public.dmcrm_chat_settings (
 org_id uuid primary key references public.dmcrm_orgs(id),
 enabled boolean not null default true, ai_enabled boolean not null default true,
 booking_enabled boolean not null default true,
 public_name text not null default 'Kyle''s AI assistant' check(length(public_name) between 1 and 60),
 greeting text not null default 'Hi! I''m Kyle''s AI assistant at Drive Max. Looking for a vehicle, selling yours, or have a protection question?' check(length(greeting) between 1 and 400),
 assigned_to uuid, monthly_budget numeric(8,2) not null default 25 check(monthly_budget between 0 and 500),
 updated_at timestamptz not null default now(),
 foreign key(org_id,assigned_to) references public.dmcrm_staff(org_id,id)
);
insert into public.dmcrm_chat_settings(org_id,assigned_to)
 select o.id,(select s.id from public.dmcrm_staff s join public.dmcrm_members m on m.org_id=s.org_id and m.user_id=s.user_id and m.role=s.role and m.active
 where s.org_id=o.id and s.active order by (s.role='owner') desc,s.created_at,s.id limit 1) from public.dmcrm_orgs o;
create table public.dmcrm_chat_threads (
 id uuid primary key default gen_random_uuid(),org_id uuid not null references public.dmcrm_orgs(id),
 token_hash text not null check(token_hash ~ '^[a-f0-9]{64}$'), expires_at timestamptz not null default now()+interval '7 days',
 state text not null default 'ai' check(state in('ai','waiting','human','closed')),
 assigned_to uuid, customer_id uuid,opportunity_id uuid,appointment_id uuid,
 visitor_name text not null default '',visitor_email text not null default '',visitor_phone text not null default '',
 contact_confirmed_at timestamptz, contact_notice text, intent text not null default 'general' check(intent in('general','availability','sell','protection')),
 page_path text not null default '/' check(length(page_path)<=250), vehicle_id uuid,
 active_run uuid,run_until timestamptz, last_visitor_at timestamptz,staff_read_at timestamptz,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(org_id,id),
 foreign key(org_id,assigned_to) references public.dmcrm_staff(org_id,id),
 foreign key(org_id,customer_id) references public.dmcrm_customers(org_id,id),
 foreign key(org_id,opportunity_id) references public.dmcrm_opportunities(org_id,id),
 foreign key(org_id,appointment_id) references public.dmcrm_appointments(org_id,id)
);
create index dmcrm_chat_queue on public.dmcrm_chat_threads(org_id,state,updated_at desc);
create table public.dmcrm_chat_messages (
 id uuid primary key default gen_random_uuid(),org_id uuid not null,thread_id uuid not null,
 sender text not null check(sender in('visitor','assistant','staff','system')),
 body text not null check(length(body) between 1 and 4000),public_data jsonb not null default '{}' check(jsonb_typeof(public_data)='object' and octet_length(public_data::text)<=12000),
 staff_name text,request_id uuid,created_at timestamptz not null default now(),
 foreign key(org_id,thread_id) references public.dmcrm_chat_threads(org_id,id),unique(thread_id,request_id)
);
create index dmcrm_chat_transcript on public.dmcrm_chat_messages(thread_id,created_at,id);
create table public.dmcrm_chat_usage (
 run_id uuid primary key,org_id uuid not null,thread_id uuid not null,
 amount numeric(10,6) not null default 0.5 check(amount between 0 and 10), settled boolean not null default false,
 input_tokens integer not null default 0,output_tokens integer not null default 0,
 outcome text not null default 'pending' check(outcome in('pending','ok','unavailable')),
 created_at timestamptz not null default now(),
 foreign key(org_id,thread_id) references public.dmcrm_chat_threads(org_id,id)
);
create index dmcrm_chat_spend on public.dmcrm_chat_usage(org_id,created_at);
alter table public.dmcrm_chat_settings enable row level security;
alter table public.dmcrm_chat_threads enable row level security;
alter table public.dmcrm_chat_messages enable row level security;
alter table public.dmcrm_chat_usage enable row level security;
revoke all on public.dmcrm_chat_settings,public.dmcrm_chat_threads,public.dmcrm_chat_messages,public.dmcrm_chat_usage from public,anon,authenticated;
grant all on public.dmcrm_chat_settings,public.dmcrm_chat_threads,public.dmcrm_chat_messages,public.dmcrm_chat_usage to service_role;

-- Public bookings identify themselves as automated, never as a staff member.
alter table public.dmcrm_appointments add column booking_source text not null default 'staff' check(booking_source in('staff','website_chat'));
alter table public.dmcrm_appointments alter column created_by drop not null;
alter table public.dmcrm_appointments add check(created_by is not null or booking_source='website_chat');
alter table public.dmcrm_appointment_history alter column actor drop not null;

-- All calendar writers share this lock, including the existing staff editor.
create function public.dmcrm_chat_calendar_lock() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='UPDATE' and old.assigned_to is distinct from new.assigned_to then
  perform pg_advisory_xact_lock(hashtextextended('dmcrm:calendar:'||least(old.assigned_to,new.assigned_to)::text,0));
  perform pg_advisory_xact_lock(hashtextextended('dmcrm:calendar:'||greatest(old.assigned_to,new.assigned_to)::text,0));
 else perform pg_advisory_xact_lock(hashtextextended('dmcrm:calendar:'||new.assigned_to::text,0));end if;
 return new;
end $$;
create trigger dmcrm_chat_calendar_lock before insert or update on public.dmcrm_appointments for each row execute function public.dmcrm_chat_calendar_lock();

create function public.dmcrm_chat_assignee(p_org uuid,p_preferred uuid) returns uuid language sql stable set search_path='' as $$
 select s.id from public.dmcrm_staff s join public.dmcrm_members m on m.org_id=s.org_id and m.user_id=s.user_id and m.role=s.role and m.active
 where s.org_id=p_org and s.active order by (s.id=p_preferred) desc nulls last,(s.role='owner') desc,s.created_at,s.id limit 1;
$$;
create function public.dmcrm_chat_config(p_org uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('enabled',s.enabled,'public_name',s.public_name,'greeting',s.greeting,'booking_enabled',s.booking_enabled,
 'photo','/staff/kyle-kratoville-team.webp','phone','252-541-0040') from public.dmcrm_chat_settings s where s.org_id=p_org;
$$;
create function public.dmcrm_chat_snapshot(p_org uuid,p_id uuid) returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('id',t.id,'state',t.state,'contact_saved',t.contact_confirmed_at is not null,
 'appointment',case when a.id is not null then jsonb_build_object('starts_at',a.starts_at,'status',a.status,'duration_minutes',a.duration_minutes) else null end,
 'busy',t.active_run is not null and t.run_until>now(),
 'messages',coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'sender',x.sender,'body',x.body,'data',x.public_data,'staff_name',x.staff_name,'created_at',x.created_at) order by x.created_at,x.id)
 from (select * from public.dmcrm_chat_messages m where m.org_id=p_org and m.thread_id=t.id order by m.created_at desc,m.id desc limit 100) x),'[]'::jsonb))
 from public.dmcrm_chat_threads t left join public.dmcrm_appointments a on a.org_id=t.org_id and a.id=t.appointment_id where t.org_id=p_org and t.id=p_id;
$$;
create function public.dmcrm_chat_slots(p_org uuid,p_id uuid) returns jsonb language plpgsql stable set search_path='' as $$
declare who uuid;begin
 select public.dmcrm_chat_assignee(p_org,coalesce(t.assigned_to,s.assigned_to)) into who from public.dmcrm_chat_threads t join public.dmcrm_chat_settings s on s.org_id=t.org_id
 where t.org_id=p_org and t.id=p_id and s.booking_enabled and s.enabled and t.state<>'closed' and t.appointment_id is null;
 if who is null then return '[]'::jsonb;end if;
 -- Published dealership hours: Tue–Fri 9–5, Sat 12–4 Eastern.
 -- Mon/Sun visits require a staff arrangement. DST is handled by PostgreSQL.
 return (select coalesce(jsonb_agg(jsonb_build_object('starts_at',q.ts,'label',to_char(q.ts at time zone 'America/New_York','Dy, Mon DD · HH12:MI AM')||' ET') order by q.ts),'[]'::jsonb)
 from (select ts from (
  select (d.day::date+h.hour*interval '1 hour') at time zone 'America/New_York' ts
  from generate_series((now() at time zone 'America/New_York')::date::timestamp,((now() at time zone 'America/New_York')::date+13)::timestamp,interval '1 day') d(day)
  cross join generate_series(9,16) h(hour)
  where (extract(isodow from d.day) between 2 and 5) or (extract(isodow from d.day)=6 and h.hour between 12 and 15)
 ) slots where ts>=now()+interval '2 hours' and not exists(select 1 from public.dmcrm_appointments a where a.org_id=p_org and a.assigned_to=who and a.status in('scheduled','confirmed','arrived')
 and a.starts_at<ts+interval '1 hour' and a.starts_at+make_interval(mins=>a.duration_minutes)>ts)
 order by ts limit 60) q);
end $$;

create function public.dmcrm_chat_public(p_org uuid,p_id uuid,p_token text,p_action text,p_data jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare t public.dmcrm_chat_threads%rowtype;s public.dmcrm_chat_settings%rowtype;rid uuid;who uuid;cid uuid;oid uuid;aid uuid;matches uuid[];nm text;em text;ph text;body text;slot timestamptz;slots jsonb;spent numeric;v jsonb;iv public.dmcrm_inventory%rowtype;summary text;
begin
 if p_action='start' then
  select * into s from public.dmcrm_chat_settings where org_id=p_org;
  if s.org_id is null or not s.enabled then raise exception 'Chat is unavailable';end if;
  if p_token is null or p_token !~ '^[a-f0-9]{64}$' or p_id is null then raise exception 'Invalid chat credential' using errcode='42501';end if;
  insert into public.dmcrm_chat_threads(id,org_id,token_hash,page_path,vehicle_id,state)
   values(p_id,p_org,p_token,left(coalesce(p_data->>'page_path','/'),250),nullif(p_data->>'vehicle_id','')::uuid,case when s.ai_enabled then 'ai' else 'waiting' end);
  insert into public.dmcrm_chat_messages(org_id,thread_id,sender,body) values(p_org,p_id,'assistant',s.greeting);
  return public.dmcrm_chat_snapshot(p_org,p_id);
 end if;
 select * into t from public.dmcrm_chat_threads where org_id=p_org and id=p_id and token_hash=p_token and expires_at>now() for update;
 if t.id is null then raise exception 'Chat session expired. Start a new chat.' using errcode='42501';end if;
 select * into s from public.dmcrm_chat_settings where org_id=p_org;
 if p_action='read' then
  if t.state='ai' and t.active_run is not null and t.run_until<=now() then
   update public.dmcrm_chat_threads set state='waiting',active_run=null,run_until=null,updated_at=clock_timestamp() where id=p_id;
   insert into public.dmcrm_chat_messages(org_id,thread_id,sender,body) values(p_org,p_id,'system','The assistant could not finish that reply. Your message is saved for the team. Please share your contact details for follow-up, or call 252-541-0040.');
  end if;
  return public.dmcrm_chat_snapshot(p_org,p_id);
 end if;
 if not s.enabled or t.state='closed' then raise exception 'This chat has ended. Start a new conversation.';end if;
 if p_action='slots' then return jsonb_build_object('slots',public.dmcrm_chat_slots(p_org,p_id));end if;
 if p_action='handoff' then
  if t.state<>'human' and t.state<>'waiting' then
   update public.dmcrm_chat_threads set state='waiting',active_run=null,run_until=null,last_visitor_at=clock_timestamp(),updated_at=clock_timestamp() where id=p_id;
   insert into public.dmcrm_chat_messages(org_id,thread_id,sender,body) values(p_org,p_id,'system','Your conversation is in the team''s inbox. Share your contact details so we can follow up if you leave this page. For immediate help, call 252-541-0040.');
  end if;
 elsif p_action='message' then
  rid:=(p_data->>'request_id')::uuid;body:=trim(p_data->>'body');
  if rid is null or body is null or length(body) not between 1 and 2000 then raise exception 'Enter a message of 1–2,000 characters.';end if;
  if exists(select 1 from public.dmcrm_chat_messages where thread_id=p_id and request_id=rid) then return public.dmcrm_chat_snapshot(p_org,p_id);end if;
  if (select count(*) from public.dmcrm_chat_messages where thread_id=p_id)>=200 then raise exception 'Please start a new conversation or call the dealership.';end if;
  if t.active_run is not null and t.run_until>now() then raise exception 'A reply is on its way. Please wait a moment.';end if;
  if p_data ? 'page_path' then
   update public.dmcrm_chat_threads set page_path=left(p_data->>'page_path',250),vehicle_id=nullif(p_data->>'vehicle_id','')::uuid where id=p_id returning * into t;
  end if;
  insert into public.dmcrm_chat_messages(org_id,thread_id,sender,body,request_id) values(p_org,p_id,'visitor',body,rid);
  update public.dmcrm_chat_threads set last_visitor_at=clock_timestamp(),updated_at=clock_timestamp(),intent=case when p_data->>'intent' in('general','availability','sell','protection') then p_data->>'intent' else intent end where id=p_id;
  if t.state='ai' and s.ai_enabled then
   -- Serializes budget reservations across all visitors. A crashed request keeps
   -- its reservation, so failed/unknown usage cannot evade the monthly cap.
   perform pg_advisory_xact_lock(hashtextextended('dmcrm:chat-budget:'||p_org::text,0));
   select coalesce(sum(amount),0) into spent from public.dmcrm_chat_usage where org_id=p_org and created_at>=date_trunc('month',now() at time zone 'America/New_York') at time zone 'America/New_York';
   if spent+0.5<=s.monthly_budget then
    insert into public.dmcrm_chat_usage(run_id,org_id,thread_id) values(rid,p_org,p_id);
    update public.dmcrm_chat_threads set active_run=rid,run_until=now()+interval '90 seconds' where id=p_id;
    return public.dmcrm_chat_snapshot(p_org,p_id)||jsonb_build_object('run_id',rid,'intent',(select intent from public.dmcrm_chat_threads where id=p_id),
     'page_vehicle',(select concat_ws(' ',year,make,model,trim) from public.vehicles where id=t.vehicle_id and status in('available','pending','sold')));
   end if;
  end if;
  if t.state='ai' then
   update public.dmcrm_chat_threads set state='waiting',active_run=null,run_until=null where id=p_id;
   insert into public.dmcrm_chat_messages(org_id,thread_id,sender,body) values(p_org,p_id,'system','The team can help from here. Share your contact details or choose an appointment below. You can also call 252-541-0040.');
  end if;
 elsif p_action='contact' then
  if t.contact_confirmed_at is not null then return public.dmcrm_chat_snapshot(p_org,p_id);end if;
  nm:=trim(p_data->>'name');em:=lower(trim(coalesce(p_data->>'email','')));ph:=trim(coalesce(p_data->>'phone',''));
  if p_data->>'consent' is distinct from 'true' or nm is null or length(nm) not between 2 and 100 or length(em)>254 or length(ph)>30 or
   (em='' and ph='') or (em<>'' and em !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') or (ph<>'' and length(regexp_replace(ph,'[^0-9]','','g')) not between 10 and 15) then raise exception 'Confirm your name, contact details, and permission to follow up.';end if;
  -- Serialize matching across simultaneous submissions. Match name AND contact;
  -- ambiguous/shared contact details never expose or overwrite another person.
  perform pg_advisory_xact_lock(hashtextextended('dmcrm:chat-contact:'||p_org::text,0));
  select array_agg(c.id) into matches from public.dmcrm_customers c where c.org_id=p_org and c.merged_into is null
   and lower(regexp_replace(trim(c.name),'\s+',' ','g'))=lower(regexp_replace(nm,'\s+',' ','g'))
   and ((em<>'' and lower(c.email)=em) or (ph<>'' and public.dmcrm_phone_key(c.phone)=public.dmcrm_phone_key(ph)));
  if cardinality(matches)=1 then cid:=matches[1];end if;
  who:=public.dmcrm_chat_assignee(p_org,coalesce(t.assigned_to,(select assigned_to from public.dmcrm_customers where id=cid),s.assigned_to));
  if who is null then raise exception 'The team is unavailable. Please call 252-541-0040.';end if;
  if cid is null then
   insert into public.dmcrm_customers(org_id,name,email,phone,source,assigned_to) values(p_org,nm,em,ph,'Website chat',who) returning id into cid;
  end if;
  if t.vehicle_id is not null then
   select jsonb_build_object('vin',vin,'title',concat_ws(' ',year,make,model,trim),'status',status) into v from public.vehicles where id=t.vehicle_id and status in('available','pending','sold');
   select * into iv from public.dmcrm_inventory where org_id=p_org and deleted_at is null and status='in_stock' and vin=v->>'vin' and v->>'status'='available';
  end if;
  summary:=case t.intent when 'sell' then 'Vehicle appraisal' when 'protection' then 'Protection question' when 'availability' then 'Vehicle availability' else 'Website conversation' end||case when v->>'title' is not null then ' · '||(v->>'title') else '' end;
  insert into public.dmcrm_opportunities(org_id,customer_id,title,source,assigned_to,inventory_id,vehicle_interest,vehicle_details)
   values(p_org,cid,summary,'Website chat',who,iv.id,coalesce(v->>'title',''),case when iv.id is not null then to_jsonb(iv)-array['id','org_id','created_at','updated_at','status','deleted_at','deleted_by'] else null end) returning id into oid;
  insert into public.dmcrm_activities(org_id,customer_id,opportunity_id,kind,body,created_by)
   values(p_org,cid,oid,'system',summary||E'\nVisitor confirmed: '||nm||E'\nPhone: '||ph||E'\nEmail: '||em||E'\nCall/email follow-up permission confirmed (website-chat-v1). No SMS permission.\nFull transcript: Website chat inbox.\n'||coalesce((select string_agg(left(m.body,500),E'\n' order by m.created_at) from (select cm.body,cm.created_at from public.dmcrm_chat_messages cm where cm.thread_id=p_id and cm.sender='visitor' order by cm.created_at desc limit 5) m),''),'Drive Max website chat');
  insert into public.dmcrm_tasks(org_id,customer_id,opportunity_id,assigned_to,title,due_date,kind,channel,origin_key)
   values(p_org,cid,oid,who,'Follow up: '||summary,(now() at time zone 'America/New_York')::date,'unsold_followup',case when ph<>'' then 'call' else 'email' end,'website-chat:'||p_id);
  update public.dmcrm_chat_threads set customer_id=cid,opportunity_id=oid,assigned_to=who,visitor_name=nm,visitor_email=em,visitor_phone=ph,
   contact_confirmed_at=now(),contact_notice='website-chat-v1',last_visitor_at=clock_timestamp(),updated_at=clock_timestamp() where id=p_id;
  insert into public.dmcrm_chat_messages(org_id,thread_id,sender,body) values(p_org,p_id,'system','Thanks! Your contact details have been saved for the Drive Max team. You can choose an appointment below.');
 elsif p_action='book' then
  if t.appointment_id is not null then return public.dmcrm_chat_snapshot(p_org,p_id);end if;
  if t.contact_confirmed_at is null then raise exception 'Save your contact details before booking.';end if;
  if p_data->>'confirmed' is distinct from 'true' then raise exception 'Confirm your appointment time.';end if;
  who:=public.dmcrm_chat_assignee(p_org,coalesce(t.assigned_to,s.assigned_to));
  if who is null then raise exception 'Please contact the team to arrange a visit.';end if;
  perform pg_advisory_xact_lock(hashtextextended('dmcrm:calendar:'||who::text,0));
  slot:=(p_data->>'starts_at')::timestamptz;slots:=public.dmcrm_chat_slots(p_org,p_id);
  if not exists(select 1 from jsonb_array_elements(slots) x where (x->>'starts_at')::timestamptz=slot) then raise exception 'That time is no longer available. Please choose another.';end if;
  aid:=gen_random_uuid();
  insert into public.dmcrm_appointments(id,org_id,customer_id,opportunity_id,assigned_to,kind,starts_at,duration_minutes,description,status,created_by,booking_source)
   values(aid,p_org,t.customer_id,t.opportunity_id,who,case when t.intent='sell' then 'trade_appraisal' when t.intent='protection' then 'paperwork' else 'vehicle_viewing' end,
   slot,60,'Booked and confirmed by the visitor through website chat. Review the transcript for vehicle and visit details.','confirmed',null,'website_chat');
  insert into public.dmcrm_appointment_history(org_id,appointment_id,actor,event,after_record) select p_org,aid,null,'website-chat-booked',to_jsonb(a) from public.dmcrm_appointments a where id=aid;
  insert into public.dmcrm_activities(org_id,customer_id,opportunity_id,kind,body,created_by) values(p_org,t.customer_id,t.opportunity_id,'system','Website appointment confirmed for '||to_char(slot at time zone 'America/New_York','Mon DD, YYYY HH12:MI AM')||' Eastern.','Drive Max website chat');
  update public.dmcrm_chat_threads set appointment_id=aid,assigned_to=who,last_visitor_at=clock_timestamp(),updated_at=clock_timestamp() where id=p_id;
  insert into public.dmcrm_chat_messages(org_id,thread_id,sender,body) values(p_org,p_id,'system','Your appointment is confirmed for '||to_char(slot at time zone 'America/New_York','Dy, Mon DD at HH12:MI AM')||' Eastern at Drive Max, 6210 Old US 70 West, New Bern. Call 252-541-0040 if you need to change it.');
 else raise exception 'Unknown chat action';end if;
 return public.dmcrm_chat_snapshot(p_org,p_id);
end $$;

-- Finish is server-only, idempotent and fenced against takeover/another AI run.
create function public.dmcrm_chat_finish(p_org uuid,p_id uuid,p_run uuid,p_body text,p_cards jsonb,p_cost numeric,p_input integer,p_output integer,p_ok boolean) returns void language plpgsql security definer set search_path='' as $$
declare t public.dmcrm_chat_threads%rowtype;u public.dmcrm_chat_usage%rowtype;begin
 select * into t from public.dmcrm_chat_threads where org_id=p_org and id=p_id for update;
 select * into u from public.dmcrm_chat_usage where org_id=p_org and thread_id=p_id and run_id=p_run for update;
 if u.run_id is null or u.settled then return;end if;
 update public.dmcrm_chat_usage set amount=case when p_ok then greatest(0,least(coalesce(p_cost,0.5),10)) else amount end,settled=true,input_tokens=greatest(0,coalesce(p_input,0)),output_tokens=greatest(0,coalesce(p_output,0)),outcome=case when p_ok then 'ok' else 'unavailable' end where run_id=p_run;
 if t.state='ai' and t.active_run=p_run and t.run_until>now() and exists(select 1 from public.dmcrm_chat_settings where org_id=p_org and enabled and ai_enabled) then
  insert into public.dmcrm_chat_messages(org_id,thread_id,sender,body,public_data) values(p_org,p_id,case when p_ok then 'assistant' else 'system' end,left(p_body,4000),coalesce(p_cards,'{}'));
  update public.dmcrm_chat_threads set active_run=null,run_until=null,state=case when p_ok and coalesce(p_cards->>'handoff','false')<>'true' then state else 'waiting' end,updated_at=clock_timestamp() where id=p_id;
 end if;
end $$;

create function public.dmcrm_chat_staff(p_org uuid,p_actor uuid,p_action text,p_data jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.dmcrm_staff%rowtype;t public.dmcrm_chat_threads%rowtype;manager boolean;rid uuid;who uuid;body text;result jsonb;begin
 select s.* into a from public.dmcrm_staff s join public.dmcrm_members m on m.org_id=s.org_id and m.user_id=s.user_id and m.role=s.role and m.active where s.org_id=p_org and s.user_id=p_actor and s.active for share of s,m;
 if a.id is null then raise exception 'Active staff access required' using errcode='42501';end if;
 manager:=a.role in('owner','manager');
 if p_action='settings' then
  if not manager then raise exception 'Manager access required' using errcode='42501';end if;
  who:=nullif(p_data->>'assigned_to','')::uuid;
  if who is not null and public.dmcrm_chat_assignee(p_org,who) is distinct from who then raise exception 'Select an active user with CRM access.';end if;
  update public.dmcrm_chat_settings set enabled=(p_data->>'enabled')::boolean,ai_enabled=(p_data->>'ai_enabled')::boolean,booking_enabled=(p_data->>'booking_enabled')::boolean,
   public_name=trim(p_data->>'public_name'),greeting=trim(p_data->>'greeting'),monthly_budget=(p_data->>'monthly_budget')::numeric,assigned_to=who,updated_at=clock_timestamp() where org_id=p_org;
  insert into public.dmcrm_audit(org_id,actor,action) values(p_org,p_actor,'website_chat_settings');
  if p_data->>'enabled'='false' or p_data->>'ai_enabled'='false' then
   update public.dmcrm_chat_threads set state='waiting',active_run=null,run_until=null,updated_at=clock_timestamp() where org_id=p_org and state='ai';
  end if;
 elsif p_action not in('list','alerts') then
  rid:=(p_data->>'id')::uuid;
  select * into t from public.dmcrm_chat_threads where org_id=p_org and id=rid for update;
  if t.id is null or (not manager and t.assigned_to is not null and t.assigned_to<>a.id) then raise exception 'Conversation unavailable' using errcode='42501';end if;
  if p_action='take' then
   if t.state='closed' then raise exception 'This conversation is closed';end if;
   update public.dmcrm_chat_threads set assigned_to=a.id,state='human',active_run=null,run_until=null,staff_read_at=clock_timestamp(),updated_at=clock_timestamp() where id=rid;
   if t.opportunity_id is not null then perform public.dmcrm_reassign_opportunity(p_org,t.opportunity_id,a.id);end if;
   if t.state<>'human' or t.assigned_to is distinct from a.id then insert into public.dmcrm_chat_messages(org_id,thread_id,sender,body) values(p_org,rid,'system',a.name||' has joined the conversation.');end if;
  elsif p_action='reply' then
   body:=trim(p_data->>'body');
   if t.state<>'human' or t.assigned_to<>a.id then raise exception 'Take over this conversation before replying.';end if;
   if body is null or length(body) not between 1 and 2000 or p_data->>'request_id' is null then raise exception 'Enter a message of 1–2,000 characters.';end if;
   insert into public.dmcrm_chat_messages(org_id,thread_id,sender,body,staff_name,request_id) values(p_org,rid,'staff',body,a.name,(p_data->>'request_id')::uuid) on conflict(thread_id,request_id) do nothing;
   update public.dmcrm_chat_threads set staff_read_at=clock_timestamp(),updated_at=clock_timestamp() where id=rid;
  elsif p_action='release' then
   if not exists(select 1 from public.dmcrm_chat_settings where org_id=p_org and enabled and ai_enabled) then raise exception 'AI replies are paused in website chat settings.';end if;
   update public.dmcrm_chat_threads set state='ai',active_run=null,run_until=null,updated_at=clock_timestamp() where id=rid and state='human';
   if t.state='human' then insert into public.dmcrm_chat_messages(org_id,thread_id,sender,body) values(p_org,rid,'system','The AI assistant can help with your next message. You can ask for the team again at any time.');end if;
  elsif p_action='close' then
   update public.dmcrm_chat_threads set state='closed',active_run=null,run_until=null,staff_read_at=clock_timestamp(),updated_at=clock_timestamp() where id=rid;
   if t.state<>'closed' then insert into public.dmcrm_chat_messages(org_id,thread_id,sender,body) values(p_org,rid,'system','This conversation has ended. Thank you for visiting Drive Max!');end if;
  elsif p_action='assign' then
   if not manager then raise exception 'Manager access required' using errcode='42501';end if;
   who:=nullif(p_data->>'assigned_to','')::uuid;
   if who is not null and public.dmcrm_chat_assignee(p_org,who) is distinct from who then raise exception 'Select an active user';end if;
   update public.dmcrm_chat_threads set assigned_to=who,state=case when state='human' then 'waiting' else state end,active_run=null,run_until=null,updated_at=clock_timestamp() where id=rid;
  if t.opportunity_id is not null then perform public.dmcrm_reassign_opportunity(p_org,t.opportunity_id,who);end if;
  elsif p_action='read' then update public.dmcrm_chat_threads set staff_read_at=clock_timestamp() where id=rid;
  else raise exception 'Unknown staff chat action';end if;
  if p_action in('take','reply','release','close','assign') then insert into public.dmcrm_audit(org_id,actor,action,record_id) values(p_org,p_actor,'website_chat_'||p_action,rid);end if;
 end if;
 if p_action='alerts' then
  return (select coalesce(jsonb_agg(jsonb_build_object('key','chat:'||x.id,'kind','chat','id',x.id,'customer_id',x.customer_id,'opportunity_id',x.opportunity_id,'customer_name',coalesce(nullif(x.visitor_name,''),'Website visitor'),'channel',null,'title',case when x.state='waiting' then 'Website chat needs a person' else 'New website chat message' end,'detail',coalesce(nullif(x.visitor_name,''),'Website visitor'),'created_at',x.last_visitor_at) order by x.last_visitor_at desc),'[]'::jsonb)
   from (select * from public.dmcrm_chat_threads where org_id=p_org and state<>'closed' and last_visitor_at>coalesce(staff_read_at,'2000-01-01'::timestamptz) and (manager or assigned_to is null or assigned_to=a.id) order by last_visitor_at desc limit 30) x);
 end if;
 select jsonb_build_object('threads',coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'state',x.state,'assigned_to',x.assigned_to,'customer_id',x.customer_id,'opportunity_id',x.opportunity_id,
  'visitor_name',x.visitor_name,'visitor_email',x.visitor_email,'visitor_phone',x.visitor_phone,'intent',x.intent,'page_path',x.page_path,'appointment_id',x.appointment_id,
  'unread',x.last_visitor_at>coalesce(x.staff_read_at,'2000-01-01'::timestamptz),'updated_at',x.updated_at,'preview',(select left(m.body,160) from public.dmcrm_chat_messages m where m.thread_id=x.id order by m.created_at desc,m.id desc limit 1)) order by x.updated_at desc)
  from (select * from public.dmcrm_chat_threads where org_id=p_org and (manager or assigned_to is null or assigned_to=a.id) order by updated_at desc limit 150) x),'[]'::jsonb),
  'conversation',case when rid is not null then public.dmcrm_chat_snapshot(p_org,rid) else null end,
  'staff',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'name',s.name)) from public.dmcrm_staff s join public.dmcrm_members m on m.org_id=s.org_id and m.user_id=s.user_id and m.role=s.role and m.active where s.org_id=p_org and s.active),'[]'::jsonb),
  'settings',case when manager then (select to_jsonb(s) from public.dmcrm_chat_settings s where org_id=p_org) else null end,
  'usage',case when manager then (select jsonb_build_object('estimated_spend',coalesce(sum(amount),0),'replies',count(*) filter(where outcome='ok'),'unavailable',count(*) filter(where outcome='unavailable'),'pending',count(*) filter(where not settled)) from public.dmcrm_chat_usage where org_id=p_org and created_at>=date_trunc('month',now() at time zone 'America/New_York') at time zone 'America/New_York') else null end) into result;
 return result;
end $$;

revoke all on function public.dmcrm_chat_calendar_lock(),public.dmcrm_chat_assignee(uuid,uuid),public.dmcrm_chat_snapshot(uuid,uuid),public.dmcrm_chat_slots(uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.dmcrm_chat_config(uuid),public.dmcrm_chat_public(uuid,uuid,text,text,jsonb),public.dmcrm_chat_finish(uuid,uuid,uuid,text,jsonb,numeric,integer,integer,boolean),public.dmcrm_chat_staff(uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.dmcrm_chat_config(uuid),public.dmcrm_chat_public(uuid,uuid,text,text,jsonb),public.dmcrm_chat_finish(uuid,uuid,uuid,text,jsonb,numeric,integer,integer,boolean),public.dmcrm_chat_staff(uuid,uuid,text,jsonb) to service_role;
