-- First-party, opt-in navigation analytics. No form contents, IP addresses,
-- fingerprints, query strings or replay recordings are stored here.
create table public.dmcrm_web_visitors (
 id uuid primary key, org_id uuid not null references public.dmcrm_orgs(id),
 token_hash text not null check(token_hash ~ '^[a-f0-9]{64}$'),
 created_at timestamptz not null default now(), last_at timestamptz not null default now(),
 unique(org_id,id)
);
create table public.dmcrm_web_sessions (
 id uuid primary key default gen_random_uuid(), org_id uuid not null,
 visitor_id uuid not null, started_at timestamptz not null default now(),
 last_at timestamptz not null default now(), source text not null,
 device text not null check(device in('Mobile','Tablet','Desktop')),
 is_returning boolean not null default false,
 foreign key(org_id,visitor_id) references public.dmcrm_web_visitors(org_id,id) on delete cascade,
 unique(org_id,id)
);
create index dmcrm_web_visit_time on public.dmcrm_web_sessions(org_id,started_at desc,id);
create index dmcrm_web_browser_time on public.dmcrm_web_sessions(visitor_id,last_at desc);
create table public.dmcrm_web_events (
 id uuid primary key, org_id uuid not null, session_id uuid not null,
 kind text not null check(kind in('page_view','engagement','photo_view','call_click','email_click','form_start','chat_open')),
 path text not null check(length(path)<=250 and path ~ '^/[^?#]*$'),
 vehicle_id uuid references public.vehicles(id) on delete set null,
 seconds integer not null default 0 check(seconds between 0 and 30),
 created_at timestamptz not null default clock_timestamp(),
 foreign key(org_id,session_id) references public.dmcrm_web_sessions(org_id,id) on delete cascade
);
create index dmcrm_web_event_visit on public.dmcrm_web_events(session_id,created_at,id);
create index dmcrm_web_vehicle on public.dmcrm_web_events(org_id,vehicle_id,created_at) where vehicle_id is not null;
create table public.dmcrm_web_links (
 org_id uuid not null, session_id uuid not null, source_kind text not null check(source_kind in('form','chat')),
 source_id uuid not null, created_at timestamptz not null default now(),
 primary key(org_id,source_kind,source_id),
 foreign key(org_id,session_id) references public.dmcrm_web_sessions(org_id,id) on delete cascade
);
alter table public.dmcrm_web_visitors enable row level security;
alter table public.dmcrm_web_sessions enable row level security;
alter table public.dmcrm_web_events enable row level security;
alter table public.dmcrm_web_links enable row level security;
revoke all on public.dmcrm_web_visitors,public.dmcrm_web_sessions,public.dmcrm_web_events,public.dmcrm_web_links from public,anon,authenticated;
grant all on public.dmcrm_web_visitors,public.dmcrm_web_sessions,public.dmcrm_web_events,public.dmcrm_web_links to service_role;

-- Only canonical public routes can enter the event store. Unknown pages and
-- sensitive/private paths are discarded, including arbitrary slugs.
create function public.dmcrm_web_path(p_path text) returns text language plpgsql stable set search_path='' as $$
begin
 if p_path in('/','/inventory','/apply','/contact','/sell-your-car','/payments','/about','/about/staff','/about/employment','/reviews','/privacy-policy','/areas-we-serve','/site-map') then return p_path;end if;
 if p_path ~ '^/inventory/[a-z0-9-]+$' and exists(select 1 from public.vehicles where slug=substring(p_path from 12) and status in('available','pending','sold')) then return p_path;end if;
 return null;
end $$;

create function public.dmcrm_web_record(p_org uuid,p_visitor uuid,p_token text,p_events jsonb,p_source text default 'Direct / unknown',p_device text default 'Desktop') returns void
language plpgsql security definer set search_path='' as $$
declare v public.dmcrm_web_visitors%rowtype;s public.dmcrm_web_sessions%rowtype;e jsonb;pth text;vid uuid;eid uuid;secs integer;
begin
 if p_token is null or p_token !~ '^[a-f0-9]{64}$' or p_visitor is null or jsonb_typeof(p_events) is distinct from 'array' or jsonb_array_length(p_events)>25 then raise exception 'Invalid activity' using errcode='22023';end if;
 if jsonb_array_length(p_events)=0 then return;end if;
 insert into public.dmcrm_web_visitors(id,org_id,token_hash) values(p_visitor,p_org,p_token) on conflict(id) do nothing;
 select * into v from public.dmcrm_web_visitors where id=p_visitor and org_id=p_org and token_hash=p_token for update;
 if v.id is null then raise exception 'Invalid browser' using errcode='42501';end if;
 select * into s from public.dmcrm_web_sessions where visitor_id=v.id and org_id=p_org and last_at>now()-interval '30 minutes' order by last_at desc limit 1;
 for e in select value from jsonb_array_elements(p_events) loop
  pth:=public.dmcrm_web_path(e->>'path');
  if pth is null or coalesce(e->>'kind','') not in('page_view','engagement','photo_view','call_click','email_click','form_start','chat_open') then continue;end if;
  eid:=(e->>'id')::uuid;
  if exists(select 1 from public.dmcrm_web_events where id=eid) then continue;end if;
  if s.id is null then
   insert into public.dmcrm_web_sessions(org_id,visitor_id,source,device,is_returning)
   values(p_org,v.id,case when p_source in('Google','Facebook','Instagram','Bing','Other search','Other social','Referral','Email','Direct / unknown') then p_source else 'Direct / unknown' end,
    case when p_device in('Mobile','Tablet') then p_device else 'Desktop' end,
    exists(select 1 from public.dmcrm_web_sessions where visitor_id=v.id)) returning * into s;
  end if;
  vid:=null;
  if pth like '/inventory/%' then select id into vid from public.vehicles where slug=substring(pth from 12) and status in('available','pending','sold');end if;
  secs:=case when e->>'kind'='engagement' then greatest(0,least(30,coalesce((e->>'seconds')::integer,0))) else 0 end;
  insert into public.dmcrm_web_events(id,org_id,session_id,kind,path,vehicle_id,seconds) values(eid,p_org,s.id,e->>'kind',pth,vid,secs) on conflict(id) do nothing;
  update public.dmcrm_web_sessions set last_at=now() where id=s.id;
 end loop;
 update public.dmcrm_web_visitors set last_at=now() where id=v.id;
end $$;

-- Called only by our validated form/chat handlers after a real action succeeds.
-- The browser never supplies CRM IDs or claims a successful conversion.
create function public.dmcrm_web_link(p_org uuid,p_visitor uuid,p_token text,p_kind text,p_source uuid) returns void
language plpgsql security definer set search_path='' as $$
declare sid uuid;
begin
 select s.id into sid from public.dmcrm_web_visitors v join public.dmcrm_web_sessions s on s.visitor_id=v.id and s.org_id=v.org_id
 where v.org_id=p_org and v.id=p_visitor and v.token_hash=p_token and s.last_at>now()-interval '30 minutes' order by s.last_at desc limit 1;
 if sid is null then return;end if;
 if p_kind='form' and not exists(select 1 from public.dmcrm_website_intake where org_id=p_org and id=p_source) then return;end if;
 if p_kind='chat' and not exists(select 1 from public.dmcrm_chat_threads where org_id=p_org and id=p_source) then return;end if;
 if p_kind not in('form','chat') then return;end if;
 insert into public.dmcrm_web_links(org_id,session_id,source_kind,source_id) values(p_org,sid,p_kind,p_source) on conflict do nothing;
end $$;

create view public.dmcrm_web_conversions as
 select l.org_id,l.session_id,l.source_kind,l.source_id,q.customer_id,q.opportunity_id,null::uuid appointment_id,l.created_at
 from public.dmcrm_web_links l join public.dmcrm_website_intake q on q.org_id=l.org_id and q.id=l.source_id where l.source_kind='form'
 union all
 select l.org_id,l.session_id,l.source_kind,l.source_id,t.customer_id,t.opportunity_id,t.appointment_id,l.created_at
 from public.dmcrm_web_links l join public.dmcrm_chat_threads t on t.org_id=l.org_id and t.id=l.source_id where l.source_kind='chat';
revoke all on public.dmcrm_web_conversions from public,anon,authenticated;
grant select on public.dmcrm_web_conversions to service_role;

create function public.dmcrm_web_read(p_org uuid,p_actor uuid,p_from date,p_to date,p_session uuid default null,p_customer uuid default null,p_offset integer default 0,p_source text default '',p_vehicle uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare a public.dmcrm_staff%rowtype;manager boolean;result jsonb;start_at timestamptz;end_at timestamptz;
begin
 select s.* into a from public.dmcrm_staff s join public.dmcrm_members m on m.org_id=s.org_id and m.user_id=s.user_id and m.role=s.role
 where s.org_id=p_org and s.user_id=p_actor and s.active and m.active;
 if a.id is null then raise exception 'Access denied' using errcode='42501';end if;
 manager:=a.role in('owner','manager');
 if p_customer is null and not manager then raise exception 'Manager access required' using errcode='42501';end if;
 if p_customer is not null and not exists(select 1 from public.dmcrm_customers c where c.org_id=p_org and c.id=p_customer and
  (manager or c.assigned_to=a.id or exists(select 1 from public.dmcrm_opportunities o where o.org_id=p_org and o.customer_id=c.id and o.assigned_to=a.id))) then
  raise exception 'Customer access denied' using errcode='42501';end if;
 if p_from is null or p_to is null or p_to<p_from or p_to-p_from>180 or p_offset<0 or p_offset>100000 then raise exception 'Choose up to 180 days' using errcode='22023';end if;
 start_at:=p_from::timestamp at time zone 'America/New_York';end_at:=(p_to+1)::timestamp at time zone 'America/New_York';
 if p_session is not null then
  if not exists(select 1 from public.dmcrm_web_sessions s where s.org_id=p_org and s.id=p_session and
   (p_customer is null or exists(select 1 from public.dmcrm_web_conversions c where c.org_id=p_org and c.session_id=s.id and c.customer_id=p_customer))) then
   raise exception 'Visit access denied' using errcode='42501';end if;
  return jsonb_build_object('events',coalesce((select jsonb_agg(to_jsonb(e) order by e.created_at,e.id) from
   (select id,kind,path,seconds,created_at from public.dmcrm_web_events where org_id=p_org and session_id=p_session and kind<>'engagement' order by created_at,id limit 500) e),'[]'::jsonb),
   'event_count',(select count(*) from public.dmcrm_web_events where org_id=p_org and session_id=p_session and kind<>'engagement'),
   'page_time',coalesce((select jsonb_agg(to_jsonb(e)) from (select path,sum(seconds)::integer seconds from public.dmcrm_web_events where org_id=p_org and session_id=p_session group by path) e),'[]'::jsonb));
 end if;
 with visits as materialized (
  select s.* from public.dmcrm_web_sessions s where s.org_id=p_org and s.started_at>=start_at and s.started_at<end_at
  and (coalesce(p_source,'')='' or s.source=p_source)
  and (p_vehicle is null or exists(select 1 from public.dmcrm_web_events e where e.session_id=s.id and e.vehicle_id=p_vehicle))
  and (p_customer is null or exists(select 1 from public.dmcrm_web_conversions c where c.org_id=p_org and c.session_id=s.id and c.customer_id=p_customer))
 ), ev as materialized (select e.* from public.dmcrm_web_events e join visits s on s.id=e.session_id),
 conv as materialized (select c.* from public.dmcrm_web_conversions c join visits s on s.id=c.session_id),
 summaries as (
  select s.*, (select count(*) from ev where session_id=s.id and kind='page_view') views,
   (select coalesce(sum(seconds),0) from ev where session_id=s.id) active_seconds,
   (select path from ev where session_id=s.id and kind='page_view' order by created_at,id limit 1) entry,
   (select path from ev where session_id=s.id and kind='page_view' order by created_at desc,id desc limit 1) exit,
   exists(select 1 from conv where session_id=s.id and customer_id is not null) lead,
   (select jsonb_agg(distinct jsonb_build_object('id',c.customer_id,'name',p.name,'opportunity_id',c.opportunity_id)) from conv c join public.dmcrm_customers p on p.org_id=c.org_id and p.id=c.customer_id where c.session_id=s.id and (p_customer is null or c.customer_id=p_customer)) customers,
   (select jsonb_agg(x.path order by x.created_at,x.id) from (select path,created_at,id from ev where session_id=s.id and kind='page_view' order by created_at,id limit 8) x) path
  from visits s order by started_at desc,id limit 50 offset p_offset
 ), vehicle_stats as (
  select v.id,v.slug,concat_ws(' ',v.year,v.make,v.model) title,v.stock_number,
   count(*) filter(where e.kind='page_view') views,count(distinct s.visitor_id) filter(where e.kind='page_view') shoppers,
   count(distinct s.id) filter(where e.kind='page_view' and s.is_returning) return_visits,
   count(*) filter(where e.kind='photo_view') photo_views,coalesce(sum(e.seconds),0) active_seconds,
   count(distinct e.session_id) filter(where exists(select 1 from conv c where c.session_id=e.session_id and c.customer_id is not null)) lead_visits
  from ev e join visits s on s.id=e.session_id join public.vehicles v on v.id=e.vehicle_id
  group by v.id,v.slug,v.year,v.make,v.model,v.stock_number
 )
 select jsonb_build_object(
  'summary',case when manager and p_customer is null then jsonb_build_object(
   'visitors',(select count(distinct visitor_id) from visits),'visits',(select count(*) from visits),
   'views',(select count(*) from ev where kind='page_view'),'returning_visits',(select count(*) from visits where is_returning),
   'active_seconds',(select coalesce(sum(seconds),0) from ev),'lead_visits',(select count(distinct session_id) from conv where customer_id is not null),
   'leads',(select count(distinct customer_id) from conv),'chats',(select count(*) from conv where source_kind='chat'),
   'appointments',(select count(distinct ap.id) from public.dmcrm_appointments ap join conv c on ap.org_id=c.org_id and (ap.id=c.appointment_id or ap.opportunity_id=c.opportunity_id) where ap.status<>'canceled'),
   'sales',(select count(distinct sale.id) from public.dmcrm_sales sale join conv c on c.org_id=sale.org_id and c.opportunity_id=sale.opportunity_id where sale.status='sold'),
   'form_starts',(select count(distinct session_id) from ev where kind='form_start'),
   'form_submissions',(select count(distinct session_id) from conv where source_kind='form'),
   'call_clicks',(select count(*) from ev where kind='call_click')) else null end,
  'sessions',coalesce((select jsonb_agg(to_jsonb(s) order by s.started_at desc,s.id) from summaries s),'[]'::jsonb),
  'total',(select count(*) from visits),
  'vehicles',case when manager and p_customer is null then coalesce((select jsonb_agg(to_jsonb(v)) from (select * from vehicle_stats order by shoppers desc,views desc,title limit 100) v),'[]'::jsonb) else '[]'::jsonb end,
  'sources',case when manager and p_customer is null then coalesce((select jsonb_agg(to_jsonb(v)) from (select source,count(*) visits,count(distinct visitor_id) visitors,count(*) filter(where exists(select 1 from conv c where c.session_id=s.id and c.customer_id is not null)) leads from visits s group by source order by count(*) desc) v),'[]'::jsonb) else '[]'::jsonb end,
  'daily',case when manager and p_customer is null then coalesce((select jsonb_agg(to_jsonb(v) order by v.day) from (select (started_at at time zone 'America/New_York')::date as day,count(*) visits from visits group by 1) v),'[]'::jsonb) else '[]'::jsonb end
 ) into result;
 return result;
end $$;

create function public.dmcrm_web_prune() returns void language plpgsql security definer set search_path='' as $$
begin
 delete from public.dmcrm_web_sessions where last_at<now()-interval '180 days';
 delete from public.dmcrm_web_visitors where last_at<now()-interval '180 days' and not exists(select 1 from public.dmcrm_web_sessions s where s.visitor_id=dmcrm_web_visitors.id);
end $$;
revoke all on function public.dmcrm_web_path(text),public.dmcrm_web_prune() from public,anon,authenticated,service_role;
revoke all on function public.dmcrm_web_record(uuid,uuid,text,jsonb,text,text),public.dmcrm_web_link(uuid,uuid,text,text,uuid),public.dmcrm_web_read(uuid,uuid,date,date,uuid,uuid,integer,text,uuid) from public,anon,authenticated;
grant execute on function public.dmcrm_web_record(uuid,uuid,text,jsonb,text,text),public.dmcrm_web_link(uuid,uuid,text,text,uuid),public.dmcrm_web_read(uuid,uuid,date,date,uuid,uuid,integer,text,uuid) to service_role;
