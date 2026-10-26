-- The website and CRM share this database. Bridge the existing, validated
-- submit_lead transaction; no browser credentials or second public endpoint.
create table public.dmcrm_website_intake (
 id uuid primary key, -- website request/lead ID: retries cannot duplicate a deal
 org_id uuid not null references public.dmcrm_orgs(id),
 message_id uuid not null unique,
 payload jsonb not null,
 received_at timestamptz not null,
 state text not null default 'pending' check(state in('pending','imported')),
 attempts integer not null default 0,
 next_attempt_at timestamptz not null default now(),
 last_error_code text,
 customer_id uuid, opportunity_id uuid, activity_id uuid,
 created_customer boolean not null default false,
 match_review boolean not null default false,
 imported_at timestamptz,
 foreign key(org_id,customer_id) references public.dmcrm_customers(org_id,id),
 foreign key(org_id,opportunity_id,customer_id) references public.dmcrm_opportunities(org_id,id,customer_id),
 check(state<>'imported' or (customer_id is not null and opportunity_id is not null and activity_id is not null and imported_at is not null))
);
alter table public.dmcrm_website_intake enable row level security;
revoke all on public.dmcrm_website_intake from public,anon,authenticated;
grant all on public.dmcrm_website_intake to service_role;
create index dmcrm_website_retry on public.dmcrm_website_intake(org_id,next_attempt_at) where state='pending';
create index dmcrm_website_customer on public.dmcrm_website_intake(org_id,customer_id);

create function public.dmcrm_phone_key(p_phone text) returns text language sql immutable set search_path='' as $$
 with digits as (select regexp_replace(coalesce(p_phone,''),'[^0-9]','','g') n)
 select case when length(n)=11 and left(n,1)='1' then substr(n,2) when length(n) between 10 and 15 then n else '' end from digits;
$$;
create index dmcrm_customer_email_match on public.dmcrm_customers(org_id,lower(trim(email))) where trim(email)<>'';
create index dmcrm_customer_phone_match on public.dmcrm_customers(org_id,public.dmcrm_phone_key(phone));

-- Capture an immutable copy before website staff can edit/reassign the lead.
create function public.dmcrm_queue_website_inquiry(p_message uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare l public.leads%rowtype;m public.messages%rowtype;v jsonb;rid uuid;
begin
 select * into m from public.messages where id=p_message and direction='inbound' and provider_id is null;
 if m.id is null then return null;end if;
 select * into l from public.leads where id=m.lead_id and kind in('vehicle','contact','finance');
 if l.id is null then return null;end if;
 select jsonb_build_object('vin',vin,'year',case when year between 1900 and 2100 then year end,'make',left(make,250),'model',left(model,250),'trim',left(trim,250),'mileage',case when miles<=3000000 then miles end,'stock_number',left(stock_number,250),'color',left(exterior,250),'price',case when internet_price<=1000000 then internet_price end,'cost',null,'recon',null,'acquired_on',null)
 into v from public.vehicles where id=case when l.details->>'originalVehicleId' ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then (l.details->>'originalVehicleId')::uuid else l.vehicle_id end;
 insert into public.dmcrm_website_intake(id,org_id,message_id,payload,received_at)
 values(l.id,'d5a1c100-0000-4000-8000-000000000001',m.id,
  jsonb_build_object('name',l.name,'email',l.email,'phone',l.phone,'preferred_contact',l.preferred_contact,'kind',l.kind,'details',l.details,'body',m.body,'vehicle',v,'assigned_user',l.assigned_to),m.created_at)
 on conflict(id) do nothing returning id into rid;
 return coalesce(rid,l.id);
end $$;

-- Each attempt is a subtransaction: a failed task/activity insert rolls back
-- the customer and opportunity too. The original website submission survives.
create function public.dmcrm_import_website_inquiry(p_id uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare q public.dmcrm_website_intake%rowtype;p jsonb;d jsonb;v jsonb;iv public.dmcrm_inventory%rowtype;
 cid uuid;oid uuid;aid uuid;owner_id uuid;candidates uuid[];is_new boolean:=false;review boolean:=false;
 email_key text;phone_key text;name_key text;matched_name text;vehicle_name text;heading text;body text;task_channel text;
 previous_actor text:=coalesce(current_setting('dmcrm.actor_id',true),'');
begin
 -- Avoid blocking a public form behind another intake. A CRM refresh drains
 -- pending work, including requests queued during concurrent submissions.
 if not pg_try_advisory_xact_lock(76102612) then return false;end if;
 select * into q from public.dmcrm_website_intake where id=p_id for update;
 if q.id is null then return false;end if;
 if q.state='imported' then return true;end if;
 begin
  perform set_config('dmcrm.actor_id','',true);
  p:=q.payload;d:=coalesce(p->'details','{}'::jsonb);v:=nullif(p->'vehicle','null');
  email_key:=lower(trim(coalesce(p->>'email','')));phone_key:=public.dmcrm_phone_key(p->>'phone');
  name_key:=lower(regexp_replace(trim(p->>'name'),'[[:space:]]+',' ','g'));
  select array_agg(c.id) into candidates from public.dmcrm_customers c where c.org_id=q.org_id
   and ((email_key<>'' and trim(c.email)<>'' and lower(trim(c.email))=email_key) or (phone_key<>'' and public.dmcrm_phone_key(c.phone)=phone_key));
  if cardinality(candidates)=1 then
   select lower(regexp_replace(trim(name),'[[:space:]]+',' ','g')) into matched_name from public.dmcrm_customers where id=candidates[1] and org_id=q.org_id;
   if matched_name=name_key then cid:=candidates[1];else review:=true;end if;
  elsif cardinality(candidates)>1 then review:=true;
  end if;
  -- Respect an existing active CRM owner, then a linked website staff identity.
  select s.id into owner_id from public.dmcrm_customers c join public.dmcrm_staff s on s.org_id=c.org_id and s.id=c.assigned_to and s.active where c.id=cid and c.org_id=q.org_id;
  if owner_id is null and nullif(p->>'assigned_user','') is not null then
   select id into owner_id from public.dmcrm_staff where org_id=q.org_id and user_id=(p->>'assigned_user')::uuid and active;
  end if;
  if cid is null then
   insert into public.dmcrm_customers(org_id,name,email,phone,source,assigned_to,created_at)
   values(q.org_id,trim(p->>'name'),email_key,coalesce(p->>'phone',''),'Website',owner_id,q.received_at) returning id into cid;
   is_new:=true;
  end if;
  -- Use original, server-captured vehicle identity, never a website vehicle ID
  -- as a CRM inventory ID. Sold/deleted stock stays out of active opportunities.
  vehicle_name:=coalesce(nullif(d->>'originalVehicleTitle',''),nullif(d->>'vehicle',''),nullif(trim(concat_ws(' ',v->>'year',v->>'make',v->>'model',v->>'trim')),''),'');
  if d->>'purpose'='purchase-offer' then
   heading:='Sell us your car';vehicle_name:=trim(concat_ws(' ',d->>'sellerYear',d->>'sellerMake',d->>'sellerModel',d->>'sellerTrim'));v:=null;
  else
   heading:=case when d->>'purpose'='test-drive' then 'Test drive request' when p->>'kind'='finance' then 'Financing inquiry' when p->>'kind'='vehicle' then 'Vehicle inquiry' else 'Contact inquiry' end;
   select * into iv from public.dmcrm_inventory where org_id=q.org_id and deleted_at is null and status='in_stock'
    and coalesce(d->>'purpose','')<>'similar-vehicle' and vin=upper(coalesce(nullif(d->>'originalVehicleVin',''),v->>'vin')) for share;
   if iv.id is not null then
    v:=to_jsonb(iv)-array['id','org_id','created_at','updated_at','status','deleted_at','deleted_by'];
   elsif nullif(d->>'originalVehicleVin','') is not null then
    v:=coalesce(v,jsonb_build_object('vin','','year',null,'make','','model','','trim','','mileage',null,'stock_number','','color','','price',null,'cost',null,'recon',null,'acquired_on',null))
     ||jsonb_build_object('vin',d->>'originalVehicleVin','stock_number',left(coalesce(d->>'originalVehicleStock',v->>'stock_number',''),250));
    if d->>'originalVehicleMiles' ~ '^[0-9]{1,7}$' and (d->>'originalVehicleMiles')::integer<=3000000 then v:=v||jsonb_build_object('mileage',(d->>'originalVehicleMiles')::integer);end if;
   end if;
  end if;
  insert into public.dmcrm_opportunities(org_id,customer_id,title,source,inventory_id,vehicle_interest,vehicle_details,assigned_to,created_at)
  values(q.org_id,cid,heading||case when vehicle_name<>'' then ' · '||vehicle_name else '' end,'Website',iv.id,vehicle_name,v,owner_id,q.received_at) returning id,assigned_to into oid,owner_id;
  -- The assignment trigger can inherit an inactive owner from an old profile.
  if owner_id is not null and not exists(select 1 from public.dmcrm_staff where org_id=q.org_id and id=owner_id and active) then
   owner_id:=null;update public.dmcrm_opportunities set assigned_to=null where id=oid;
  end if;
  body:=heading||E'\nSubmitted by: '||(p->>'name')||E'\nPhone: '||coalesce(p->>'phone','')
   ||case when email_key<>'' then E'\nEmail: '||email_key else '' end
   ||E'\nPreferred contact: '||coalesce(p->>'preferred_contact','Phone call')
   ||case when vehicle_name<>'' then E'\nVehicle: '||vehicle_name else '' end
   ||case when coalesce(d->>'originalVehicleVin',v->>'vin','')<>'' then E'\nVIN: '||coalesce(d->>'originalVehicleVin',v->>'vin') else '' end
   ||case when coalesce(d->>'originalVehicleStock',v->>'stock_number','')<>'' then E'\nStock: '||coalesce(d->>'originalVehicleStock',v->>'stock_number') else '' end
   ||case when nullif(d->>'preferredVisit','') is not null then E'\nRequested visit (awaiting confirmation): '||(d->>'preferredVisit') else '' end
   ||E'\n\n'||coalesce(p->>'body','Website inquiry')
   ||E'\n\nSMS consent: '||coalesce(d->>'smsConsent','not_provided')
   ||case when nullif(d->>'contactNoticeVersion','') is not null then ' · notice '||(d->>'contactNoticeVersion') else '' end
   ||case when nullif(d->>'contactNoticeSubmittedAt','') is not null then ' · '||(d->>'contactNoticeSubmittedAt') else '' end;
  -- Preserve structured form answers even when a shorter message was supplied.
  for heading,matched_name in select * from (values
   ('Seller VIN',d->>'sellerVin'),('Seller mileage',d->>'sellerMiles'),('Condition',d->>'condition'),('Title status',d->>'titleStatus'),('Accident history',d->>'accidentHistory'),('Loan / payoff status',d->>'loanStatus'),('Asking price',d->>'askingPrice'),('ZIP code',d->>'sellerZip'),('Budget',d->>'budget'),('Down payment',d->>'downPayment'),('Vehicle type',d->>'vehicleType'),('Reason',d->>'reason')) answers(label,value) where nullif(value,'') is not null
  loop body:=body||E'\n'||heading||': '||matched_name;end loop;
  if d->>'purpose'='test-drive' then body:=body||E'\nStaff must confirm the appointment time with the customer.';end if;
  if review then body:=body||E'\nContact match needs review: another profile shares these details. A separate profile was created to avoid merging different people.';end if;
  if not is_new then body:=body||E'\nReturning customer: new opportunity added; existing profile and deals retained.';end if;
  insert into public.dmcrm_activities(org_id,customer_id,opportunity_id,kind,body,created_by,created_at)
   values(q.org_id,cid,oid,'system',body,'Drive Max website',q.received_at) returning id into aid;
  task_channel:=case when p->>'preferred_contact'='Email' and email_key<>'' then 'email'
   when p->>'preferred_contact'='Text message' and d->>'smsConsent'='yes' and d->>'contactNoticeVersion'='2026-10-20-sms-v2' then 'sms' else 'call' end;
  insert into public.dmcrm_tasks(org_id,customer_id,opportunity_id,assigned_to,title,due_date,kind,channel,origin_key)
   values(q.org_id,cid,oid,owner_id,case when d->>'purpose'='test-drive' then 'Confirm website test drive' when d->>'purpose'='purchase-offer' then 'Follow up on vehicle appraisal request' else 'Respond to website inquiry' end,
    (now() at time zone 'America/New_York')::date,'unsold_followup',task_channel,'website:'||q.id);
  update public.dmcrm_website_intake set state='imported',customer_id=cid,opportunity_id=oid,activity_id=aid,created_customer=is_new,match_review=review,attempts=attempts+1,last_error_code=null,imported_at=now() where id=q.id;
 exception when others then
  update public.dmcrm_website_intake set attempts=attempts+1,last_error_code=sqlstate,next_attempt_at=now()+make_interval(secs=>least(900,60*(attempts+1))) where id=q.id;
  perform set_config('dmcrm.actor_id',previous_actor,true);
  return false;
 end;
 perform set_config('dmcrm.actor_id',previous_actor,true);
 return true;
end $$;

create function public.dmcrm_website_inquiry_trigger() returns trigger
language plpgsql security definer set search_path='' as $$
declare rid uuid;
begin
 if new.direction='inbound' and new.provider_id is null then
  rid:=public.dmcrm_queue_website_inquiry(new.id);
  if rid is not null then perform public.dmcrm_import_website_inquiry(rid);end if;
 end if;
 return new;
exception when others then
 -- Website storage is the durable fallback. The authenticated sweep below
 -- also finds unqueued open inquiries. Never fail a customer's form for CRM.
 raise log 'CRM website intake deferred, SQLSTATE %',sqlstate;
 return new;
end $$;
create trigger dmcrm_website_inquiry after insert on public.messages for each row execute function public.dmcrm_website_inquiry_trigger();

create function public.dmcrm_retry_website_intake(p_org uuid) returns void
language plpgsql security definer set search_path='' as $$
declare r record;
begin
 if p_org<>'d5a1c100-0000-4000-8000-000000000001' or not pg_try_advisory_xact_lock(76102612) then return;end if;
 -- Recover existing open requests too; closed sales and applicants stay put.
 for r in select m.id from public.leads l join lateral
  (select msg.id from public.messages msg where msg.lead_id=l.id and msg.direction='inbound' and msg.provider_id is null order by msg.created_at,msg.id limit 1) m on true
  where l.kind in('vehicle','contact','finance') and l.status in('new','contacted','appointment')
   and not exists(select 1 from public.dmcrm_website_intake q where q.id=l.id)
  order by l.created_at,l.id limit 20
 loop
  begin perform public.dmcrm_queue_website_inquiry(r.id);
  exception when others then raise log 'CRM website queue deferred, SQLSTATE %',sqlstate;end;
 end loop;
 for r in select id from public.dmcrm_website_intake where org_id=p_org and state='pending' and next_attempt_at<=now() order by received_at,id limit 20
 loop perform public.dmcrm_import_website_inquiry(r.id);end loop;
end $$;

-- Reuse existing membership checks and feed entries, replacing only redundant
-- generic customer alerts. Each website request has its own review receipt.
alter function public.dmcrm_attention_items(uuid,uuid) rename to dmcrm_attention_items_v11;
create function public.dmcrm_attention_items(p_org uuid,p_actor uuid)
returns table(key text,kind text,id uuid,customer_id uuid,customer_name text,opportunity_id uuid,channel text,title text,detail text,created_at timestamptz)
language plpgsql security definer set search_path='' as $$
declare a public.dmcrm_staff%rowtype;
begin
 select s.* into a from public.dmcrm_staff s join public.dmcrm_members m on m.org_id=s.org_id and m.user_id=s.user_id
  where s.org_id=p_org and s.user_id=p_actor and s.active and m.active;
 if a.id is null then raise exception 'CRM membership required' using errcode='42501';end if;
 return query select e.* from public.dmcrm_attention_items_v11(p_org,p_actor) e
  where e.kind<>'lead' or not exists(select 1 from public.dmcrm_website_intake q where q.org_id=p_org and q.customer_id=e.customer_id and q.created_customer)
 union all
 select 'website:'||q.id,'website'::text,q.id,c.id,c.name,o.id,null::text,
  o.title,case when q.match_review then 'Contact match needs review · ' else '' end||case when o.assigned_to is null then 'Unassigned · ' else '' end||left(q.payload->>'body',160),q.received_at
 from public.dmcrm_website_intake q join public.dmcrm_customers c on c.org_id=q.org_id and c.id=q.customer_id
 join public.dmcrm_opportunities o on o.org_id=q.org_id and o.id=q.opportunity_id
 where q.org_id=p_org and q.state='imported' and (a.role in('owner','manager') or o.assigned_to=a.id);
end $$;

create or replace function public.dmcrm_attention(p_org uuid,p_actor uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;manager boolean;pending_count integer;
begin
 select s.role in('owner','manager') into manager from public.dmcrm_staff s join public.dmcrm_members m on m.org_id=s.org_id and m.user_id=s.user_id
  where s.org_id=p_org and s.user_id=p_actor and s.active and m.active;
 if manager is null then raise exception 'CRM membership required' using errcode='42501';end if;
 perform public.dmcrm_retry_website_intake(p_org);
 with unread as materialized (
  select e.* from public.dmcrm_attention_items(p_org,p_actor) e where e.kind='task' or not exists(select 1 from public.dmcrm_attention_reads r where r.org_id=p_org and r.actor=p_actor and r.alert_key=e.key)
 ), page as (
  select * from unread order by case when kind in('reply','failed','website') then 0 else 1 end,created_at desc,key desc limit 100
 ) select jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(page)) from page),'[]'::jsonb),'total',(select count(*) from unread)) into result;
 if p_org='d5a1c100-0000-4000-8000-000000000001' then
  if manager then
   select (select count(*) from public.dmcrm_website_intake where org_id=p_org and state='pending')+
    (select count(*) from public.leads l where l.kind in('vehicle','contact','finance') and l.status in('new','contacted','appointment') and not exists(select 1 from public.dmcrm_website_intake q where q.id=l.id)) into pending_count;
  end if;
  result:=result||jsonb_build_object('websiteIntake',jsonb_build_object('connected',true,'pending',pending_count));
 end if;
 return result;
end $$;

alter function public.dmcrm_command(uuid,uuid,jsonb) rename to dmcrm_command_v11;
create function public.dmcrm_command(p_org uuid,p_actor uuid,p_command jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare rid uuid:=(p_command->>'id')::uuid;event_key text;
begin
 if p_command->>'type'='review_attention' and p_command->>'kind'='website' then
  event_key:='website:'||rid;
  if not exists(select 1 from public.dmcrm_attention_items(p_org,p_actor) e where e.key=event_key) then raise exception 'Website inquiry unavailable' using errcode='42501';end if;
  insert into public.dmcrm_attention_reads(org_id,actor,alert_key) values(p_org,p_actor,event_key) on conflict do nothing;
  return rid;
 end if;
 return public.dmcrm_command_v11(p_org,p_actor,p_command);
end $$;

revoke all on function public.dmcrm_phone_key(text),public.dmcrm_queue_website_inquiry(uuid),public.dmcrm_import_website_inquiry(uuid),public.dmcrm_website_inquiry_trigger(),public.dmcrm_retry_website_intake(uuid),public.dmcrm_attention_items_v11(uuid,uuid),public.dmcrm_attention_items(uuid,uuid),public.dmcrm_command_v11(uuid,uuid,jsonb),public.dmcrm_attention(uuid,uuid),public.dmcrm_command(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.dmcrm_attention(uuid,uuid),public.dmcrm_command(uuid,uuid,jsonb) to service_role;
-- Begin the open-inquiry backfill. Further batches drain on normal CRM refresh.
select public.dmcrm_retry_website_intake('d5a1c100-0000-4000-8000-000000000001');
