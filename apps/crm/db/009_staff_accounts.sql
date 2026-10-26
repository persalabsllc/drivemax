-- Contact details are private to CRM managers. No credentials are stored in CRM tables.
alter table public.dmcrm_staff
 add column first_name text not null default '', add column last_name text not null default '',
 add column phone text not null default '', add column address1 text not null default '',
 add column address2 text not null default '', add column city text not null default '',
 add column state text not null default '', add column zip text not null default '',
 add column password_managed boolean not null default false;
update public.dmcrm_staff set first_name=split_part(trim(name),' ',1),
 last_name=case when position(' ' in trim(name))>0 then substring(trim(name) from position(' ' in trim(name))+1) else '' end;

alter function public.dmcrm_command(uuid,uuid,jsonb) rename to dmcrm_command_v8;
revoke all on function public.dmcrm_command_v8(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
create function public.dmcrm_command(p_org uuid,p_actor uuid,p_command jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare d jsonb:=p_command->'staff'; rid uuid;
begin
 if p_command->>'type'='save_staff' then
  if coalesce(length(trim(d->>'first_name')),0) not between 1 and 60
   or coalesce(length(trim(d->>'last_name')),0) not between 1 and 60
   or coalesce(d->>'phone','') !~ '^\+[1-9][0-9]{7,14}$'
   or coalesce(length(trim(d->>'address1')),0) not between 1 and 250
   or coalesce(length(d->>'address2'),0)>250
   or coalesce(length(trim(d->>'city')),0) not between 1 and 100
   or coalesce(d->>'state','') !~ '^[A-Z]{2}$'
   or coalesce(d->>'zip','') !~ '^[0-9]{5}(-[0-9]{4})?$'
   then raise exception 'Enter first and last name, email, phone and a complete address';end if;
  d:=d||jsonb_build_object('name',trim(d->>'first_name')||' '||trim(d->>'last_name'));
  p_command:=jsonb_set(p_command,'{staff}',d);
 end if;
 -- Existing role, owner, self-edit, membership, and linked-email protections remain enforced.
 rid:=public.dmcrm_command_v8(p_org,p_actor,p_command);
 if p_command->>'type'='save_staff' then
  update public.dmcrm_staff set first_name=trim(d->>'first_name'),last_name=trim(d->>'last_name'),
   phone=d->>'phone',address1=trim(d->>'address1'),address2=coalesce(trim(d->>'address2'),''),
   city=trim(d->>'city'),state=d->>'state',zip=d->>'zip' where org_id=p_org and id=rid;
 end if;
 return rid;
end $$;
revoke all on function public.dmcrm_command(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.dmcrm_command(uuid,uuid,jsonb) to service_role;

-- Only dedicated CRM identities can have passwords changed by a CRM manager.
-- Accounts previously linked from another application keep their existing recovery process.
create function public.dmcrm_staff_password_target(p_org uuid,p_actor uuid,p_staff uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a public.dmcrm_staff%rowtype;t public.dmcrm_staff%rowtype;meta jsonb;
begin
 select s.* into a from public.dmcrm_staff s join public.dmcrm_members m on m.org_id=s.org_id and m.user_id=s.user_id
  where s.org_id=p_org and s.user_id=p_actor and s.active and m.active for share of s,m;
 if a.id is null or a.role not in('owner','manager') then raise exception 'Manager access required' using errcode='42501';end if;
 select * into t from public.dmcrm_staff where org_id=p_org and id=p_staff and active for update;
 if t.id is null or t.role='owner' or t.user_id=p_actor or (a.role='manager' and t.role<>'sales')
  then raise exception 'This team account is not available for password changes' using errcode='42501';end if;
 if t.user_id is not null then
  select to_jsonb(u)->'raw_app_meta_data' into meta from auth.users u where u.id=t.user_id;
  if not t.password_managed or (meta->>'dmcrm_org_id') is distinct from p_org::text
   or exists(select 1 from public.dmcrm_members where user_id=t.user_id and org_id<>p_org)
   or exists(select 1 from public.staff where id=t.user_id)
   then raise exception 'This login uses an existing account; use its original password recovery' using errcode='42501';end if;
 end if;
 return jsonb_build_object('id',t.id,'email',t.email,'name',t.name,'user_id',t.user_id);
end $$;

create function public.dmcrm_link_staff_account(p_org uuid,p_actor uuid,p_staff uuid,p_user uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare t jsonb;
begin
 t:=public.dmcrm_staff_password_target(p_org,p_actor,p_staff);
 if t->>'user_id' is not null then raise exception 'This team member already has a login';end if;
 if not exists(select 1 from auth.users u where u.id=p_user and lower(to_jsonb(u)->>'email')=lower(t->>'email')
   and to_jsonb(u)->'raw_app_meta_data'->>'dmcrm_org_id'=p_org::text)
   or exists(select 1 from public.dmcrm_members where user_id=p_user)
   or exists(select 1 from public.staff where id=p_user)
   then raise exception 'This account cannot be linked' using errcode='42501';end if;
 insert into public.dmcrm_members(org_id,user_id,name,role,active)
  select org_id,p_user,name,role,true from public.dmcrm_staff where org_id=p_org and id=p_staff;
 update public.dmcrm_staff set user_id=p_user,password_managed=true where org_id=p_org and id=p_staff;
 delete from public.dmcrm_staff_invites where org_id=p_org and staff_id=p_staff;
 insert into public.dmcrm_audit(org_id,actor,action,record_id) values(p_org,p_actor,'create_staff_login',p_staff);
 return p_staff;
end $$;

create function public.dmcrm_create_staff_account(p_org uuid,p_actor uuid,p_staff jsonb,p_user uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare rid uuid;
begin
 rid:=public.dmcrm_command(p_org,p_actor,jsonb_build_object('type','save_staff','staff',p_staff));
 return public.dmcrm_link_staff_account(p_org,p_actor,rid,p_user);
end $$;

-- New accounts created through private setup links are also eligible for manager resets.
alter function public.dmcrm_claim_staff_invite(text,uuid,text) rename to dmcrm_claim_staff_invite_v4;
revoke all on function public.dmcrm_claim_staff_invite_v4(text,uuid,text) from public,anon,authenticated,service_role;
create function public.dmcrm_claim_staff_invite(p_hash text,p_user uuid,p_email text) returns uuid
language plpgsql security definer set search_path='' as $$
declare rid uuid;
begin
 rid:=public.dmcrm_claim_staff_invite_v4(p_hash,p_user,p_email);
 update public.dmcrm_staff s set password_managed=true where s.id=rid and exists(
  select 1 from auth.users u where u.id=p_user and to_jsonb(u)->'raw_app_meta_data'->>'dmcrm_org_id'=s.org_id::text);
 return rid;
end $$;
revoke all on function public.dmcrm_staff_password_target(uuid,uuid,uuid),public.dmcrm_link_staff_account(uuid,uuid,uuid,uuid),
 public.dmcrm_create_staff_account(uuid,uuid,jsonb,uuid),public.dmcrm_claim_staff_invite(text,uuid,text) from public,anon,authenticated;
grant execute on function public.dmcrm_staff_password_target(uuid,uuid,uuid),public.dmcrm_link_staff_account(uuid,uuid,uuid,uuid),
 public.dmcrm_create_staff_account(uuid,uuid,jsonb,uuid),public.dmcrm_claim_staff_invite(text,uuid,text) to service_role;
