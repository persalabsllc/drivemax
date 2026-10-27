-- One canonical full name for staff attribution, assignment lists and sign-in.
-- Kyle requested this correction for his existing Drive Max owner account.
do $$
declare target uuid; matches integer;
begin
 select count(*),min(id::text)::uuid into matches,target from public.dmcrm_staff
 where org_id='d5a1c100-0000-4000-8000-000000000001' and role='owner' and user_id is not null
 and lower(regexp_replace(trim(name),'\s+',' ','g')) in('kyle','kyle kratoville','kyle thomas kratoville');
 if matches>1 then raise exception 'Owner name correction is ambiguous';end if;
 if matches=1 then
  update public.dmcrm_staff set first_name='Kyle',last_name='Kratoville',name='Kyle Kratoville' where id=target;
  update public.dmcrm_members m set name=s.name from public.dmcrm_staff s where s.id=target and m.org_id=s.org_id and m.user_id=s.user_id;
 end if;
end $$;

-- Any active user can correct their own display name without changing access,
-- credentials or another user's details. Existing staff editing protects roles.
alter function public.dmcrm_command(uuid,uuid,jsonb) rename to dmcrm_command_v17;
revoke all on function public.dmcrm_command_v17(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
create function public.dmcrm_command(p_org uuid,p_actor uuid,p_command jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare a public.dmcrm_staff%rowtype;v_first text;v_last text;v_full text;
begin
 if p_command->>'type'<>'save_profile_name' then return public.dmcrm_command_v17(p_org,p_actor,p_command);end if;
 select s.* into a from public.dmcrm_staff s join public.dmcrm_members m on m.org_id=s.org_id and m.user_id=s.user_id
 where s.org_id=p_org and s.user_id=p_actor and s.active and m.active for update of s,m;
 if a.id is null then raise exception 'Active team membership required' using errcode='42501';end if;
 v_first:=regexp_replace(trim(p_command->'profile'->>'first_name'),'\s+',' ','g');
 v_last:=regexp_replace(trim(p_command->'profile'->>'last_name'),'\s+',' ','g');
 v_full:=v_first||' '||v_last;
 if coalesce(length(v_first),0) not between 1 and 60 or coalesce(length(v_last),0) not between 1 and 60 or length(v_full)>120
 then raise exception 'First and last name are required';end if;
 update public.dmcrm_staff set first_name=v_first,last_name=v_last,name=v_full where org_id=p_org and id=a.id;
 update public.dmcrm_members set name=v_full where org_id=p_org and user_id=p_actor;
 insert into public.dmcrm_audit(org_id,actor,action,record_id) values(p_org,p_actor,'save_profile_name',a.id);
 return a.id;
end $$;
revoke all on function public.dmcrm_command(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.dmcrm_command(uuid,uuid,jsonb) to service_role;
