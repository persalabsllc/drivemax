-- Title-work amounts can be reviewed without changing an immutable sold quote.
alter table public.dmcrm_title_cases add column amounts jsonb;
alter table public.dmcrm_title_cases add constraint dmcrm_title_amounts_valid check (
 amounts is null or coalesce(jsonb_typeof(amounts)='object'
 and jsonb_typeof(amounts->'fees')='number' and jsonb_typeof(amounts->'taxes')='number'
 and (amounts->>'fees')::numeric between 0 and 1000000 and (amounts->>'taxes')::numeric between 0 and 1000000
 and round((amounts->>'fees')::numeric,2)=(amounts->>'fees')::numeric
 and round((amounts->>'taxes')::numeric,2)=(amounts->>'taxes')::numeric
 and jsonb_typeof(amounts->'note')='string' and length(trim(amounts->>'note')) between 3 and 1000,false)
);

alter function public.dmcrm_command(uuid,uuid,jsonb) rename to dmcrm_command_before_title_amounts;
create function public.dmcrm_command(p_org uuid,p_actor uuid,p_command jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare a public.dmcrm_staff%rowtype; c public.dmcrm_title_cases%rowtype; s public.dmcrm_sales%rowtype;
 v jsonb:=p_command->'values'; prior jsonb;
begin
 if p_command->>'type' is distinct from 'save_title_amounts' then
  return public.dmcrm_command_before_title_amounts(p_org,p_actor,p_command);
 end if;
 select st.* into a from public.dmcrm_staff st join public.dmcrm_members m on m.org_id=st.org_id and m.user_id=st.user_id
 where st.org_id=p_org and st.user_id=p_actor and st.active and m.active for share of st,m;
 if a.id is null then raise exception 'CRM membership required' using errcode='42501'; end if;
 if a.role not in('owner','manager') then raise exception 'Manager required to correct DMV amounts' using errcode='42501'; end if;
 select * into c from public.dmcrm_title_cases where org_id=p_org and id=(p_command->>'id')::uuid;
 if c.id is null then raise exception 'Title case unavailable' using errcode='42501'; end if;
 -- Match the opportunity -> sale -> title lock order used by sale/unwind.
 perform 1 from public.dmcrm_opportunities where org_id=p_org and id=c.opportunity_id for share;
 select * into s from public.dmcrm_sales where org_id=p_org and id=c.sale_id for share;
 select * into c from public.dmcrm_title_cases where org_id=p_org and id=c.id for update;
 if s.status<>'sold' then raise exception 'Unwound sale is read-only'; end if;
 if (p_command->>'revision')::integer is distinct from c.revision then raise exception 'Record changed. Refresh before saving.'; end if;
 if jsonb_typeof(v) is distinct from 'object' or jsonb_typeof(v->'fees') is distinct from 'number' or jsonb_typeof(v->'taxes') is distinct from 'number' then
  raise exception 'Enter valid DMV fees and taxes';
 end if;
 if (v->>'fees')::numeric not between 0 and 1000000 or (v->>'taxes')::numeric not between 0 and 1000000
  or round((v->>'fees')::numeric,2)<>(v->>'fees')::numeric or round((v->>'taxes')::numeric,2)<>(v->>'taxes')::numeric then
  raise exception 'Enter valid DMV fees and taxes';
 end if;
 if jsonb_typeof(v->'note') is distinct from 'string' or length(trim(coalesce(v->>'note',''))) not between 3 and 1000 then
  raise exception 'Enter a reason for these DMV amounts';
 end if;
 prior:=coalesce(c.amounts,jsonb_build_object('fees',s.snapshot#>'{quote,values,titleFee}',
  'taxes',case when jsonb_typeof(s.snapshot#>'{quote,values,tax}')='number' then
    (s.snapshot#>>'{quote,values,tax}')::numeric+coalesce((s.snapshot#>>'{quote,values,otherTaxes}')::numeric,0) else null end));
 v:=jsonb_build_object('fees',(v->>'fees')::numeric,'taxes',(v->>'taxes')::numeric,'note',trim(v->>'note'));
 update public.dmcrm_title_cases set amounts=v,revision=revision+1,updated_at=now() where org_id=p_org and id=c.id;
 insert into public.dmcrm_title_events(org_id,case_id,event,actor_name,detail)
 values(p_org,c.id,'DMV amounts reviewed',a.name,jsonb_build_object('before',prior,'after',v));
 insert into public.dmcrm_audit(org_id,actor,action,record_id) values(p_org,p_actor,'save_title_amounts',c.id);
 return c.id;
end $$;
revoke all on function public.dmcrm_command_before_title_amounts(uuid,uuid,jsonb),public.dmcrm_command(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.dmcrm_command(uuid,uuid,jsonb) to service_role;

