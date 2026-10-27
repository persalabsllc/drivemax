create table public.dmcrm_push_config(id text primary key,public_key text not null,private_key text not null);
create table public.dmcrm_push_subscriptions(id uuid primary key default gen_random_uuid(),org_id uuid not null,user_id uuid not null,endpoint text not null unique,keys jsonb not null,created_at timestamptz not null default now(),foreign key(org_id,user_id) references public.dmcrm_members(org_id,user_id));
create table public.dmcrm_push_jobs(id uuid primary key default gen_random_uuid(),org_id uuid not null,user_id uuid not null,customer_id uuid,opportunity_id uuid,event text not null,source_key text not null,state text not null default 'pending' check(state in('pending','sending','sent','failed')),attempts integer not null default 0,claim_token uuid,locked_at timestamptz,created_at timestamptz not null default now(),unique(org_id,user_id,source_key),foreign key(org_id,user_id) references public.dmcrm_members(org_id,user_id));
create index dmcrm_push_pending on public.dmcrm_push_jobs(created_at) where state in('pending','sending');
do $$ declare tbl text;begin foreach tbl in array array['dmcrm_push_config','dmcrm_push_subscriptions','dmcrm_push_jobs'] loop execute format('alter table public.%I enable row level security',tbl);execute format('revoke all on public.%I from public,anon,authenticated',tbl);execute format('grant all on public.%I to service_role',tbl);end loop;end $$;
create function public.dmcrm_push_event() returns trigger language plpgsql security definer set search_path='' as $$
declare cid uuid;oid uuid;assignee uuid;event_name text;
begin
 if tg_table_name='dmcrm_opportunities' then cid:=new.customer_id;oid:=new.id;assignee:=new.assigned_to;event_name:='New customer lead';
 else
  if new.direction<>'inbound' or new.status<>'received' then return new;end if;
  cid:=new.customer_id;oid:=new.opportunity_id;event_name:='Customer reply';
  select assigned_to into assignee from public.dmcrm_opportunities where org_id=new.org_id and id=oid;
  if assignee is null then select assigned_to into assignee from public.dmcrm_customers where org_id=new.org_id and id=cid;end if;
 end if;
 insert into public.dmcrm_push_jobs(org_id,user_id,customer_id,opportunity_id,event,source_key)
 select new.org_id,s.user_id,cid,oid,event_name,tg_table_name||':'||new.id::text from public.dmcrm_staff s join public.dmcrm_members m on m.org_id=s.org_id and m.user_id=s.user_id
 where s.org_id=new.org_id and s.active and m.active and (s.role in('owner','manager') or s.id=assignee) and exists(select 1 from public.dmcrm_push_subscriptions ps where ps.org_id=s.org_id and ps.user_id=s.user_id) on conflict do nothing;
 return new;
end $$;
create trigger dmcrm_push_lead after insert on public.dmcrm_opportunities for each row execute function public.dmcrm_push_event();
create trigger dmcrm_push_reply after insert on public.dmcrm_messages for each row execute function public.dmcrm_push_event();
create function public.dmcrm_push_prepare() returns void language plpgsql security definer set search_path='' as $$
begin
 if (now() at time zone 'America/New_York')::time<'09:00'::time then return;end if;
 insert into public.dmcrm_push_jobs(org_id,user_id,event,source_key)
 select s.org_id,s.user_id,'Follow-up due today','tasks:'||(now() at time zone 'America/New_York')::date::text from public.dmcrm_staff s join public.dmcrm_members m on m.org_id=s.org_id and m.user_id=s.user_id
 where s.active and m.active and exists(select 1 from public.dmcrm_push_subscriptions ps where ps.org_id=s.org_id and ps.user_id=s.user_id) and exists(select 1 from public.dmcrm_tasks t where t.org_id=s.org_id and (s.role in('owner','manager') or t.assigned_to=s.id) and t.completed_at is null and t.canceled_at is null and t.due_date<=(now() at time zone 'America/New_York')::date) on conflict do nothing;
end $$;
create function public.dmcrm_push_claim() returns setof public.dmcrm_push_jobs language plpgsql security definer set search_path='' as $$
declare j public.dmcrm_push_jobs%rowtype;
begin
 perform public.dmcrm_push_prepare();
 for j in select * from public.dmcrm_push_jobs where state='pending' or (state='sending' and locked_at<now()-interval '3 minutes') order by created_at for update skip locked limit 5 loop
  if j.attempts>=3 or j.created_at<now()-interval '24 hours' then update public.dmcrm_push_jobs set state='failed' where id=j.id;continue;end if;
  if not exists(select 1 from public.dmcrm_members m join public.dmcrm_staff s on s.org_id=m.org_id and s.user_id=m.user_id where m.org_id=j.org_id and m.user_id=j.user_id and m.active and s.active and (s.role in('owner','manager') or (j.opportunity_id is not null and s.id=(select assigned_to from public.dmcrm_opportunities where org_id=j.org_id and id=j.opportunity_id)) or (j.opportunity_id is null and j.customer_id is not null and s.id=(select assigned_to from public.dmcrm_customers where org_id=j.org_id and id=j.customer_id)) or j.customer_id is null)) then update public.dmcrm_push_jobs set state='failed' where id=j.id;continue;end if;
  return query update public.dmcrm_push_jobs set state='sending',attempts=attempts+1,claim_token=gen_random_uuid(),locked_at=now() where id=j.id returning *;
 end loop;
end $$;
revoke all on function public.dmcrm_push_event(),public.dmcrm_push_prepare(),public.dmcrm_push_claim() from public,anon,authenticated,service_role;
grant execute on function public.dmcrm_push_claim() to service_role;
