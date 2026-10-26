-- CRM-only team directory, task ownership, and invitation claims.
create table public.dmcrm_staff (
 id uuid primary key default gen_random_uuid(), org_id uuid not null references public.dmcrm_orgs(id),
 user_id uuid references auth.users(id), name text not null, email text not null default '',
 role text not null check(role in('owner','manager','sales')), active boolean not null default true,
 created_at timestamptz not null default now(), unique(org_id,id), unique(org_id,user_id)
);
create unique index dmcrm_staff_email on public.dmcrm_staff(org_id,lower(email)) where email<>'';
insert into public.dmcrm_staff(id,org_id,user_id,name,email,role,active)
 select gen_random_uuid(),m.org_id,m.user_id,m.name,coalesce(to_jsonb(u)->>'email',''),m.role,m.active
 from public.dmcrm_members m join auth.users u on u.id=m.user_id;
alter table public.dmcrm_customers add column assigned_to uuid,add foreign key(org_id,assigned_to) references public.dmcrm_staff(org_id,id);
alter table public.dmcrm_opportunities add column assigned_to uuid,add foreign key(org_id,assigned_to) references public.dmcrm_staff(org_id,id);
alter table public.dmcrm_tasks add column assigned_to uuid,add foreign key(org_id,assigned_to) references public.dmcrm_staff(org_id,id);
update public.dmcrm_customers c set assigned_to=(select s.id from public.dmcrm_staff s where s.org_id=c.org_id and s.active order by case s.role when 'owner' then 0 when 'manager' then 1 else 2 end,s.created_at,s.id limit 1);
update public.dmcrm_opportunities o set assigned_to=c.assigned_to from public.dmcrm_customers c where c.org_id=o.org_id and c.id=o.customer_id;
-- Preserve the existing owner attribution on pre-team closed deals.
update public.dmcrm_opportunities o set sale_snapshot=jsonb_set(o.sale_snapshot,'{salesperson}',jsonb_build_object('id',s.id,'name',s.name))
 from public.dmcrm_staff s where s.org_id=o.org_id and s.id=o.assigned_to and o.status in('sold','lost') and o.sale_snapshot is not null and not (o.sale_snapshot ? 'salesperson');
update public.dmcrm_tasks t set assigned_to=coalesce((select o.assigned_to from public.dmcrm_opportunities o where o.org_id=t.org_id and o.id=t.opportunity_id),(select c.assigned_to from public.dmcrm_customers c where c.org_id=t.org_id and c.id=t.customer_id),(select s.id from public.dmcrm_staff s where s.org_id=t.org_id and s.active order by case s.role when 'owner' then 0 when 'manager' then 1 else 2 end,s.id limit 1));
create index dmcrm_tasks_assignee_due on public.dmcrm_tasks(org_id,assigned_to,due_date);
create index dmcrm_opportunities_assignee on public.dmcrm_opportunities(org_id,assigned_to);
create table public.dmcrm_staff_invites (
 token_hash text primary key check(length(token_hash)=64), org_id uuid not null, staff_id uuid not null,
 expires_at timestamptz not null, consumed_at timestamptz, created_at timestamptz not null default now(),
 foreign key(org_id,staff_id) references public.dmcrm_staff(org_id,id)
);
alter table public.dmcrm_staff enable row level security;
alter table public.dmcrm_staff_invites enable row level security;
revoke all on public.dmcrm_staff,public.dmcrm_staff_invites from public,anon,authenticated;
grant all on public.dmcrm_staff,public.dmcrm_staff_invites to service_role;

create function public.dmcrm_assign_insert() returns trigger language plpgsql security definer set search_path='' as $$
declare actor_id uuid:=nullif(current_setting('dmcrm.actor_id',true),'')::uuid;
begin
 if new.assigned_to is null then
  if tg_table_name='dmcrm_tasks' then
   if new.opportunity_id is not null then select assigned_to into new.assigned_to from public.dmcrm_opportunities where org_id=new.org_id and id=new.opportunity_id;
   elsif new.customer_id is not null then select assigned_to into new.assigned_to from public.dmcrm_customers where org_id=new.org_id and id=new.customer_id;
   else select id into new.assigned_to from public.dmcrm_staff where org_id=new.org_id and user_id=actor_id and active;end if;
  elsif tg_table_name='dmcrm_opportunities' then
   select assigned_to into new.assigned_to from public.dmcrm_customers where org_id=new.org_id and id=new.customer_id;
  else select id into new.assigned_to from public.dmcrm_staff where org_id=new.org_id and user_id=actor_id and active;
  end if;
 end if;
 return new;
end $$;
create trigger dmcrm_customer_owner before insert on public.dmcrm_customers for each row execute function public.dmcrm_assign_insert();
create trigger dmcrm_opportunity_owner before insert on public.dmcrm_opportunities for each row execute function public.dmcrm_assign_insert();
create trigger dmcrm_task_owner before insert on public.dmcrm_tasks for each row execute function public.dmcrm_assign_insert();

-- Changing ownership moves unfinished work; completed task history is preserved.
create function public.dmcrm_reassign_opportunity(p_org uuid,p_id uuid,p_staff uuid) returns void language plpgsql security definer set search_path='' as $$
declare op public.dmcrm_opportunities%rowtype; old_owner uuid;
begin
 if p_staff is not null and not exists(select 1 from public.dmcrm_staff where org_id=p_org and id=p_staff and active) then raise exception 'Select an active team member';end if;
 select * into op from public.dmcrm_opportunities where org_id=p_org and id=p_id for update;
 if op.id is null then raise exception 'Opportunity unavailable' using errcode='42501';end if;
 update public.dmcrm_opportunities set assigned_to=p_staff,updated_at=now() where org_id=p_org and id=p_id;
 update public.dmcrm_tasks set assigned_to=p_staff where org_id=p_org and opportunity_id=p_id and completed_at is null and canceled_at is null;
 -- The newest open opportunity owns general customer follow-up. Old sale assignments do not steal it.
 if not exists(select 1 from public.dmcrm_opportunities where org_id=p_org and customer_id=op.customer_id and status not in('sold','lost') and (created_at,id)>(op.created_at,op.id))
 and (op.status not in('sold','lost') or not exists(select 1 from public.dmcrm_opportunities where org_id=p_org and customer_id=op.customer_id and status not in('sold','lost'))) then
  select assigned_to into old_owner from public.dmcrm_customers where org_id=p_org and id=op.customer_id for update;
  update public.dmcrm_customers set assigned_to=p_staff where org_id=p_org and id=op.customer_id;
  update public.dmcrm_tasks set assigned_to=p_staff where org_id=p_org and customer_id=op.customer_id and opportunity_id is null and assigned_to is not distinct from old_owner and completed_at is null and canceled_at is null;
 end if;
end $$;

alter function public.dmcrm_command(uuid,uuid,jsonb) rename to dmcrm_command_v3;
revoke all on function public.dmcrm_command_v3(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
create function public.dmcrm_command(p_org uuid,p_actor uuid,p_command jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare typ text:=p_command->>'type'; a public.dmcrm_staff%rowtype; target public.dmcrm_staff%rowtype;
 rid uuid; oid uuid; assignee uuid; replacement uuid; before_owner uuid; data jsonb:=p_command->'staff'; manager boolean;
begin
 select s.* into a from public.dmcrm_staff s join public.dmcrm_members m on m.org_id=s.org_id and m.user_id=s.user_id where s.org_id=p_org and s.user_id=p_actor and s.active and m.active for share of s,m;
 if a.id is null then raise exception 'CRM membership required' using errcode='42501';end if;
 manager:=a.role in('owner','manager');
 perform set_config('dmcrm.actor_id',p_actor::text,true);
 if typ in('save_staff','set_staff_active') then
  if not manager then raise exception 'Manager access required' using errcode='42501';end if;
  if p_command->>'id' is not null then
   select * into target from public.dmcrm_staff where org_id=p_org and id=(p_command->>'id')::uuid for update;
   if target.id is null then raise exception 'Team member unavailable';end if;
   if target.role='owner' or target.id=a.id or (a.role='manager' and target.role<>'sales') then raise exception 'Only the owner can manage managers; owner access is protected' using errcode='42501';end if;
  end if;
  if typ='save_staff' then
   if data->>'role' not in('manager','sales') or (a.role<>'owner' and data->>'role'<>'sales') then raise exception 'Only the owner can add managers' using errcode='42501';end if;
   if length(trim(data->>'name')) not between 2 and 120 or coalesce(data->>'email','') !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'Enter a name and valid email';end if;
   if target.user_id is not null and lower(data->>'email')<>lower(target.email) then raise exception 'Login email cannot be changed here';end if;
   if target.id is null then
    insert into public.dmcrm_staff(org_id,name,email,role) values(p_org,trim(data->>'name'),lower(trim(data->>'email')),data->>'role') returning id into rid;
   else
    update public.dmcrm_staff set name=trim(data->>'name'),email=lower(trim(data->>'email')),role=data->>'role' where org_id=p_org and id=target.id returning id into rid;
    if target.user_id is null and lower(data->>'email')<>lower(target.email) then delete from public.dmcrm_staff_invites where org_id=p_org and staff_id=target.id;end if;
    update public.dmcrm_members set name=trim(data->>'name'),role=data->>'role' where org_id=p_org and user_id=target.user_id;
   end if;
  else
   if target.id is null then raise exception 'Team member unavailable';end if;
   if not (p_command->>'active')::boolean then
    replacement:=(p_command->>'reassign_to')::uuid;
    if replacement is null or replacement=target.id or not exists(select 1 from public.dmcrm_staff where org_id=p_org and id=replacement and active) then raise exception 'Choose an active replacement for unfinished work';end if;
    update public.dmcrm_opportunities set assigned_to=replacement,updated_at=now() where org_id=p_org and assigned_to=target.id;
    update public.dmcrm_customers set assigned_to=replacement where org_id=p_org and assigned_to=target.id;
    update public.dmcrm_tasks set assigned_to=replacement where org_id=p_org and assigned_to=target.id and completed_at is null and canceled_at is null;
    delete from public.dmcrm_staff_invites where org_id=p_org and staff_id=target.id;
   end if;
   update public.dmcrm_staff set active=(p_command->>'active')::boolean where org_id=p_org and id=target.id;
   update public.dmcrm_members set active=(p_command->>'active')::boolean where org_id=p_org and user_id=target.user_id;
   rid:=target.id;
  end if;
 elsif typ='assign_opportunity' then
  if not manager then raise exception 'Manager access required' using errcode='42501';end if;
  rid:=(p_command->>'id')::uuid;
  perform public.dmcrm_reassign_opportunity(p_org,rid,(p_command->>'assigned_to')::uuid);
  insert into public.dmcrm_activities(org_id,customer_id,opportunity_id,kind,body,created_by) select p_org,customer_id,id,'system','Salesperson assignment updated',a.name from public.dmcrm_opportunities where org_id=p_org and id=rid;
 else
  if typ='complete_task' and not manager and not exists(select 1 from public.dmcrm_tasks where org_id=p_org and id=(p_command->>'id')::uuid and assigned_to=a.id) then raise exception 'You can only complete your own tasks' using errcode='42501';end if;
  if typ in('create_opportunity','update_opportunity') and p_command->'opportunity' ? 'assigned_to' then
   assignee:=(p_command->'opportunity'->>'assigned_to')::uuid;
   if assignee is not null and not exists(select 1 from public.dmcrm_staff where org_id=p_org and id=assignee and active) then raise exception 'Select an active team member';end if;
   if not manager then
    if typ='update_opportunity' then select assigned_to into before_owner from public.dmcrm_opportunities where org_id=p_org and id=(p_command->>'id')::uuid;end if;
    if (typ='create_opportunity' and assignee is distinct from a.id) or (typ='update_opportunity' and assignee is distinct from before_owner) then raise exception 'Manager access required to reassign an opportunity' using errcode='42501';end if;
   end if;
  end if;
  if typ='create_task' then
   if p_command ? 'assigned_to' then assignee:=(p_command->>'assigned_to')::uuid;
   elsif p_command->>'opportunity_id' is not null then select assigned_to into assignee from public.dmcrm_opportunities where org_id=p_org and id=(p_command->>'opportunity_id')::uuid;
   elsif p_command->>'customer_id' is not null then select assigned_to into assignee from public.dmcrm_customers where org_id=p_org and id=(p_command->>'customer_id')::uuid;
   else assignee:=a.id;end if;
   if not manager and assignee is distinct from a.id then raise exception 'Only managers can assign tasks to another user' using errcode='42501';end if;
   if assignee is not null and not exists(select 1 from public.dmcrm_staff where org_id=p_org and id=assignee and active) then raise exception 'Select an active team member';end if;
  end if;
  rid:=public.dmcrm_command_v3(p_org,p_actor,p_command);
  if typ in('create_opportunity','update_opportunity') and p_command->'opportunity' ? 'assigned_to' then
   perform public.dmcrm_reassign_opportunity(p_org,rid,assignee);
  elsif typ='create_opportunity' then
   select assigned_to into assignee from public.dmcrm_opportunities where org_id=p_org and id=rid;
   perform public.dmcrm_reassign_opportunity(p_org,rid,assignee);
  elsif typ='create_task' then update public.dmcrm_tasks set assigned_to=assignee where org_id=p_org and id=rid;
  elsif typ in('close_opportunity','mark_sold') then
   update public.dmcrm_opportunities o set sale_snapshot=jsonb_set(sale_snapshot,'{salesperson}',coalesce((select jsonb_build_object('id',s.id,'name',s.name) from public.dmcrm_staff s where s.org_id=p_org and s.id=o.assigned_to),'null'::jsonb)) where o.org_id=p_org and o.id=rid and not (sale_snapshot ? 'salesperson');
  end if;
  return rid;
 end if;
 insert into public.dmcrm_audit(org_id,actor,action,record_id) values(p_org,p_actor,typ,rid);
 return rid;
end $$;

create function public.dmcrm_claim_staff_invite(p_hash text,p_user uuid,p_email text) returns uuid language plpgsql security definer set search_path='' as $$
declare invite public.dmcrm_staff_invites%rowtype; staff public.dmcrm_staff%rowtype;
begin
 select * into invite from public.dmcrm_staff_invites where token_hash=p_hash for update;
 if invite.token_hash is null or invite.expires_at<=now() or invite.consumed_at is not null then raise exception 'Setup link expired or already used';end if;
 select * into staff from public.dmcrm_staff where org_id=invite.org_id and id=invite.staff_id and active for update;
 if staff.id is null or staff.user_id is not null or lower(staff.email)<>lower(p_email)
 or not exists(select 1 from auth.users u where u.id=p_user and lower(to_jsonb(u)->>'email')=lower(staff.email)) then raise exception 'Setup link unavailable';end if;
 -- Never overwrite an existing membership or escalate a linked account.
 if exists(select 1 from public.dmcrm_members where org_id=staff.org_id and user_id=p_user) then raise exception 'This account already belongs to this dealership';end if;
 insert into public.dmcrm_members(org_id,user_id,name,role,active) values(staff.org_id,p_user,staff.name,staff.role,true);
 update public.dmcrm_staff set user_id=p_user where org_id=staff.org_id and id=staff.id;
 update public.dmcrm_staff_invites set consumed_at=now() where token_hash=p_hash;
 insert into public.dmcrm_audit(org_id,actor,action,record_id) values(staff.org_id,p_user,'accept_staff_setup',staff.id);
 return staff.id;
end $$;
revoke all on function public.dmcrm_assign_insert(),public.dmcrm_reassign_opportunity(uuid,uuid,uuid),public.dmcrm_claim_staff_invite(text,uuid,text),public.dmcrm_command(uuid,uuid,jsonb) from public,anon,authenticated;
revoke all on function public.dmcrm_assign_insert(),public.dmcrm_reassign_opportunity(uuid,uuid,uuid) from service_role;
grant execute on function public.dmcrm_command(uuid,uuid,jsonb),public.dmcrm_claim_staff_invite(text,uuid,text) to service_role;

create function public.dmcrm_create_staff_invite(p_org uuid,p_actor uuid,p_staff uuid,p_hash text) returns void language plpgsql security definer set search_path='' as $$
declare actor_role text; target public.dmcrm_staff%rowtype;
begin
 select role into actor_role from public.dmcrm_members where org_id=p_org and user_id=p_actor and active for share;
 if actor_role is null or actor_role not in('owner','manager') then raise exception 'Manager access required' using errcode='42501';end if;
 select * into target from public.dmcrm_staff where org_id=p_org and id=p_staff and active for update;
 if target.id is null or target.user_id is not null or target.role='owner' or (actor_role='manager' and target.role<>'sales') then raise exception 'Setup link unavailable' using errcode='42501';end if;
 delete from public.dmcrm_staff_invites where org_id=p_org and staff_id=p_staff;
 insert into public.dmcrm_staff_invites(token_hash,org_id,staff_id,expires_at) values(p_hash,p_org,p_staff,now()+interval '72 hours');
 insert into public.dmcrm_audit(org_id,actor,action,record_id) values(p_org,p_actor,'create_staff_setup_link',p_staff);
end $$;
revoke all on function public.dmcrm_create_staff_invite(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.dmcrm_create_staff_invite(uuid,uuid,uuid,text) to service_role;
