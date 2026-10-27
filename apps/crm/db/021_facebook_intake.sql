-- Incoming Page Messenger identity is page-scoped. Never merge on display name.
create table public.dmcrm_facebook_contacts (
 org_id uuid not null references public.dmcrm_orgs(id), page_id text not null, sender_id text not null,
 customer_id uuid not null, opportunity_id uuid not null, created_at timestamptz not null default now(),
 primary key(org_id,page_id,sender_id),
 foreign key(org_id,customer_id) references public.dmcrm_customers(org_id,id),
 foreign key(org_id,opportunity_id,customer_id) references public.dmcrm_opportunities(org_id,id,customer_id)
);
create table public.dmcrm_facebook_messages (
 id uuid primary key default gen_random_uuid(),org_id uuid not null,page_id text not null,sender_id text not null,
 provider_id text not null check(length(provider_id) between 1 and 1000),customer_id uuid not null,opportunity_id uuid not null,
 body text not null check(length(body) between 1 and 16000),referral jsonb not null default '{}',
 received_at timestamptz not null,created_at timestamptz not null default now(),
 unique(org_id,page_id,provider_id),
 foreign key(org_id,page_id,sender_id) references public.dmcrm_facebook_contacts(org_id,page_id,sender_id),
 foreign key(org_id,opportunity_id,customer_id) references public.dmcrm_opportunities(org_id,id,customer_id)
);
create index dmcrm_facebook_customer_messages on public.dmcrm_facebook_messages(org_id,customer_id,received_at);
alter table public.dmcrm_facebook_contacts enable row level security;
alter table public.dmcrm_facebook_messages enable row level security;
revoke all on public.dmcrm_facebook_contacts,public.dmcrm_facebook_messages from public,anon,authenticated;
grant all on public.dmcrm_facebook_contacts,public.dmcrm_facebook_messages to service_role;

create function public.dmcrm_receive_facebook(p_org uuid,p_page text,p_event jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare contact public.dmcrm_facebook_contacts%rowtype;opp public.dmcrm_opportunities%rowtype;iv public.dmcrm_inventory%rowtype;
 cid uuid;oid uuid;mid uuid;assignee uuid;vehicle_name text;source_name text;at_time timestamptz;new_op boolean:=false;
 sender text:=p_event->>'sender_id';provider text:=p_event->>'message_id';body text:=p_event->>'body';referral jsonb:=coalesce(p_event->'referral','{}');
begin
 if p_org<>'d5a1c100-0000-4000-8000-000000000001' or p_page !~ '^[0-9]{1,100}$' or sender !~ '^[0-9]{1,100}$'
  or p_page=sender or coalesce(length(provider),0) not between 1 and 1000 or coalesce(length(body),0) not between 1 and 16000
  or jsonb_typeof(referral)<>'object' then raise exception 'Invalid Facebook event';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_org::text||':'||p_page||':'||sender,21));
 select id into mid from public.dmcrm_facebook_messages where org_id=p_org and page_id=p_page and provider_id=provider;
 if mid is not null then return mid;end if;
 at_time:=(p_event->>'received_at')::timestamptz;
 if at_time is null or at_time<'2000-01-01'::timestamptz or at_time>now()+interval '5 minutes' then at_time:=now();end if;
 source_name:=case when nullif(referral->>'ad_id','') is not null then 'Facebook ad' else 'Facebook Messenger' end;
 select * into contact from public.dmcrm_facebook_contacts where org_id=p_org and page_id=p_page and sender_id=sender for update;
 cid:=contact.customer_id;oid:=contact.opportunity_id;
 if oid is not null then select * into opp from public.dmcrm_opportunities where org_id=p_org and id=oid;end if;
 -- Match only explicit CRM vehicle references or exact unique VINs. Ad IDs and
 -- vague descriptions are retained for staff instead of guessing stock.
 if p_event->>'vehicle_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
  select * into iv from public.dmcrm_inventory where org_id=p_org and id=(p_event->>'vehicle_id')::uuid and deleted_at is null and status='in_stock';
 elsif p_event->>'vin' ~ '^[A-HJ-NPR-Z0-9]{17}$' then
  select * into iv from public.dmcrm_inventory where org_id=p_org and vin=p_event->>'vin' and deleted_at is null and status='in_stock';
 end if;
 if cid is null then
  insert into public.dmcrm_customers(org_id,name,source) values(p_org,'Facebook customer · '||right(sender,6),source_name) returning id into cid;
 end if;
 select s.id into assignee from public.dmcrm_customers c join public.dmcrm_staff s on s.id=c.assigned_to and s.org_id=c.org_id and s.active where c.org_id=p_org and c.id=cid;
 if oid is null or (iv.id is not null and opp.inventory_id is distinct from iv.id and (opp.inventory_id is not null or opp.status in('sold','lost'))) then
  new_op:=true;
  vehicle_name:=trim(concat_ws(' ',iv.year,iv.make,iv.model,iv.trim));
  insert into public.dmcrm_opportunities(org_id,customer_id,title,source,assigned_to,inventory_id,vehicle_interest,vehicle_details)
   values(p_org,cid,'Facebook inquiry'||case when coalesce(vehicle_name,'')<>'' then ' · '||vehicle_name else '' end,source_name,assignee,iv.id,coalesce(vehicle_name,''),
   case when iv.id is not null then to_jsonb(iv)-array['id','org_id','created_at','updated_at','status','deleted_at','deleted_by'] end) returning id into oid;
  insert into public.dmcrm_tasks(org_id,customer_id,opportunity_id,assigned_to,title,due_date,kind,channel,origin_key)
   values(p_org,cid,oid,assignee,'Respond to Facebook inquiry',(now() at time zone 'America/New_York')::date,'unsold_followup','task','facebook:'||oid);
 elsif iv.id is not null and opp.inventory_id is null and opp.status not in('sold','lost') then
  update public.dmcrm_opportunities set inventory_id=iv.id,vehicle_interest=trim(concat_ws(' ',iv.year,iv.make,iv.model,iv.trim)),
   vehicle_details=to_jsonb(iv)-array['id','org_id','created_at','updated_at','status','deleted_at','deleted_by'],updated_at=now() where org_id=p_org and id=oid;
 end if;
 insert into public.dmcrm_facebook_contacts(org_id,page_id,sender_id,customer_id,opportunity_id) values(p_org,p_page,sender,cid,oid)
  on conflict(org_id,page_id,sender_id) do update set opportunity_id=excluded.opportunity_id;
 insert into public.dmcrm_facebook_messages(org_id,page_id,sender_id,provider_id,customer_id,opportunity_id,body,referral,received_at)
  values(p_org,p_page,sender,provider,cid,oid,body,referral,at_time) returning id into mid;
 -- Existing push preferences and current assignments apply to social replies.
 insert into public.dmcrm_push_jobs(org_id,user_id,customer_id,opportunity_id,event,source_key)
 select p_org,s.user_id,cid,oid,'Facebook message','facebook:'||mid from public.dmcrm_staff s
 join public.dmcrm_members m on m.org_id=s.org_id and m.user_id=s.user_id
 join public.dmcrm_opportunities o on o.org_id=s.org_id and o.id=oid
 where not new_op and s.org_id=p_org and s.active and m.active and (s.role in('owner','manager') or s.id=o.assigned_to)
 and exists(select 1 from public.dmcrm_push_subscriptions ps where ps.org_id=s.org_id and ps.user_id=s.user_id) on conflict do nothing;
 return mid;
end $$;

alter function public.dmcrm_attention_items(uuid,uuid) rename to dmcrm_attention_items_before_facebook;
create function public.dmcrm_attention_items(p_org uuid,p_actor uuid)
returns table(key text,kind text,id uuid,customer_id uuid,customer_name text,opportunity_id uuid,channel text,title text,detail text,created_at timestamptz)
language plpgsql security definer set search_path='' as $$
declare a public.dmcrm_staff%rowtype;
begin
 select s.* into a from public.dmcrm_staff s join public.dmcrm_members m on m.org_id=s.org_id and m.user_id=s.user_id
 where s.org_id=p_org and s.user_id=p_actor and s.active and m.active;
 if a.id is null then raise exception 'CRM membership required' using errcode='42501';end if;
 return query select e.* from public.dmcrm_attention_items_before_facebook(p_org,p_actor) e
 union all
 select 'facebook:'||f.id,'facebook'::text,f.id,c.id,c.name,o.id,'facebook'::text,'Facebook message'::text,left(f.body,160),f.created_at
 from public.dmcrm_facebook_messages f join public.dmcrm_customers c on c.org_id=f.org_id and c.id=f.customer_id
 join public.dmcrm_opportunities o on o.org_id=f.org_id and o.id=f.opportunity_id
 where f.org_id=p_org and (a.role in('owner','manager') or o.assigned_to=a.id);
end $$;
alter function public.dmcrm_command(uuid,uuid,jsonb) rename to dmcrm_command_before_facebook;
create function public.dmcrm_command(p_org uuid,p_actor uuid,p_command jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare rid uuid:=(p_command->>'id')::uuid;
begin
 if p_command->>'type'='review_attention' and p_command->>'kind'='facebook' then
  if not exists(select 1 from public.dmcrm_attention_items(p_org,p_actor) e where e.key='facebook:'||rid) then raise exception 'Facebook message unavailable' using errcode='42501';end if;
  insert into public.dmcrm_attention_reads(org_id,actor,alert_key) values(p_org,p_actor,'facebook:'||rid) on conflict do nothing;
  return rid;
 end if;
 return public.dmcrm_command_before_facebook(p_org,p_actor,p_command);
end $$;
revoke all on function public.dmcrm_receive_facebook(uuid,text,jsonb),public.dmcrm_attention_items_before_facebook(uuid,uuid),public.dmcrm_attention_items(uuid,uuid),public.dmcrm_command_before_facebook(uuid,uuid,jsonb),public.dmcrm_command(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.dmcrm_receive_facebook(uuid,text,jsonb),public.dmcrm_command(uuid,uuid,jsonb) to service_role;

create function public.dmcrm_facebook_name(p_org uuid,p_page text,p_sender text,p_name text) returns void
language sql security definer set search_path='' as $$
 update public.dmcrm_customers c set name=left(trim(p_name),250),updated_at=now()
 from public.dmcrm_facebook_contacts f where f.org_id=p_org and f.page_id=p_page and f.sender_id=p_sender
 and c.org_id=f.org_id and c.id=f.customer_id and c.name='Facebook customer · '||right(p_sender,6) and length(trim(p_name))>0;
$$;
revoke all on function public.dmcrm_facebook_name(uuid,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.dmcrm_facebook_name(uuid,text,text,text) to service_role;
