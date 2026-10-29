-- Contact matches are suggestions, never automatic merges. Staff review the
-- current matches before intentionally creating a separate customer.
create function public.dmcrm_match_phone(v text) returns text language sql immutable set search_path='' as $$
 select case when length(n)=11 and left(n,1)='1' then substr(n,2) when length(n)=10 then n else '' end
 from (select regexp_replace(coalesce(v,''),'[^0-9]','','g') n) x;
$$;
create function public.dmcrm_customer_matches(p_org uuid,p_actor uuid,p_input jsonb)
returns table(id uuid,name text,phone text,email text,reasons text[])
language plpgsql stable security definer set search_path='' as $$
begin
 if not exists(select 1 from public.dmcrm_members m join public.dmcrm_staff s on s.org_id=m.org_id and s.user_id=m.user_id
  where m.org_id=p_org and m.user_id=p_actor and m.active and s.active) then raise exception 'Active team membership required' using errcode='42501';end if;
 return query with inputs as (select public.dmcrm_match_phone(p_input->>'phone') p,
  lower(trim(coalesce(p_input->>'email',''))) e,upper(trim(coalesce(p_input->>'license_state',''))) st,
  regexp_replace(upper(coalesce(p_input->>'license_number','')),'[^A-Z0-9]','','g') dl),
 matched as (select kept.id,array_remove(array[
  case when x.p<>'' and public.dmcrm_match_phone(c.phone)=x.p then 'Phone' end,
  case when position('@' in x.e)>1 and lower(trim(c.email))=x.e then 'Email' end,
  case when length(x.dl)>=4 and x.st<>'' and upper(c.person->>'license_state')=x.st
    and regexp_replace(upper(c.person->>'license_number'),'[^A-Z0-9]','','g')=x.dl then 'Driver license' end],null) rs
  from public.dmcrm_customers c join public.dmcrm_customers kept on kept.org_id=c.org_id and kept.id=coalesce(c.merged_into,c.id) and kept.merged_into is null
  cross join inputs x where c.org_id=p_org),
 grouped as (select m.id,array_agg(distinct r order by r) rs from matched m cross join lateral unnest(m.rs) r group by m.id)
 select c.id,c.name,c.phone,c.email,g.rs from grouped g join public.dmcrm_customers c on c.id=g.id and c.org_id=p_org
 order by cardinality(g.rs) desc,c.name,c.id limit 25;
end $$;
revoke all on function public.dmcrm_match_phone(text),public.dmcrm_customer_matches(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.dmcrm_customer_matches(uuid,uuid,jsonb) to service_role;

alter function public.dmcrm_command(uuid,uuid,jsonb) rename to dmcrm_command_before_match_review;
create function public.dmcrm_command(p_org uuid,p_actor uuid,p_command jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare typ text:=p_command->>'type';c jsonb:=p_command->'customer';input jsonb;missing boolean;
 prior public.dmcrm_quick_quote_conversions%rowtype;actor public.dmcrm_staff%rowtype;
 cid uuid;oid uuid;qid uuid;rid uuid;q jsonb:=p_command->'quote';vals jsonb;label text;trade_label text;
begin
 if typ in('create_customer','convert_quick_quote') then
  -- All staff-entered creations for this dealership share the same review lock.
  perform pg_advisory_xact_lock(hashtextextended('dmcrm:customer-create:'||p_org::text,0));
  if typ<>'convert_quick_quote' or not exists(select 1 from public.dmcrm_quick_quote_conversions qc where qc.id=(p_command->>'id')::uuid and qc.org_id=p_org and qc.actor=p_actor) then
   input:=jsonb_build_object('phone',c->>'phone','email',c->>'email','license_number',c->'person'->>'license_number','license_state',c->'person'->>'license_state');
   select exists(select 1 from public.dmcrm_customer_matches(p_org,p_actor,input) m
    where not coalesce(c->'duplicate_reviewed_ids','[]'::jsonb) @> jsonb_build_array(m.id::text)) into missing;
   if missing then raise exception 'Possible duplicate customers found. Review the matches before creating a separate profile.';end if;
  end if;
 end if;
 if typ<>'convert_quick_quote_existing' then return public.dmcrm_command_before_match_review(p_org,p_actor,p_command);end if;
 select s.* into actor from public.dmcrm_staff s join public.dmcrm_members m on m.org_id=s.org_id and m.user_id=s.user_id
  where s.org_id=p_org and s.user_id=p_actor and s.active and m.active for share of s,m;
 if actor.id is null then raise exception 'Active team membership required' using errcode='42501';end if;
 rid:=(p_command->>'id')::uuid;cid:=(p_command->>'customer_id')::uuid;
 if rid is null or cid is null then raise exception 'Customer and conversion key required';end if;
 perform pg_advisory_xact_lock(hashtextextended('dmcrm:quick-quote:'||rid::text,0));
 select * into prior from public.dmcrm_quick_quote_conversions where id=rid;
 if found then
  if prior.org_id<>p_org or prior.actor<>p_actor or prior.customer_id<>cid then raise exception 'Quote conversion unavailable' using errcode='42501';end if;
  return cid;
 end if;
 perform id from public.dmcrm_customers where org_id=p_org and id=cid and merged_into is null for share;
 if not found then raise exception 'Customer unavailable' using errcode='42501';end if;
 vals:=q->'values';if jsonb_typeof(vals) is distinct from 'object' then raise exception 'Quote figures required';end if;
 label:=coalesce(nullif(trim(q->>'vehicle'),''),'Vehicle to be selected');
 trade_label:=case when coalesce((vals->>'tradeAllowance')::numeric,0)>0 or coalesce((vals->>'payoff')::numeric,0)>0
  or coalesce((vals->>'acv')::numeric,0)>0 or coalesce((vals->>'recon')::numeric,0)>0 then 'Trade details pending' else '' end;
 oid:=public.dmcrm_command(p_org,p_actor,jsonb_build_object('type','create_opportunity','customer_id',cid,
  'opportunity',jsonb_build_object('title',label,'source',coalesce(p_command->>'source','Walk-in'),'status','working',
   'inventory_id',q->'inventory_id','vehicle_interest',label,'vehicle_details',null,'trade_vehicle',trade_label,'trade',null)));
 select vehicle_interest into label from public.dmcrm_opportunities where org_id=p_org and id=oid;
 update public.dmcrm_opportunities set title=label where org_id=p_org and id=oid;
 qid:=public.dmcrm_command(p_org,p_actor,jsonb_build_object('type','save_quote','customer_id',cid,'opportunity_id',oid,'vehicle',label,'values',vals));
 insert into public.dmcrm_quick_quote_conversions(id,org_id,actor,customer_id,opportunity_id,quote_id) values(rid,p_org,p_actor,cid,oid,qid);
 insert into public.dmcrm_activities(org_id,customer_id,opportunity_id,kind,body,created_by) values(p_org,cid,oid,'system','Quick quote saved as a new opportunity on the existing customer.',actor.name);
 insert into public.dmcrm_audit(org_id,actor,action,record_id) values(p_org,p_actor,typ,rid);
 return cid;
end $$;
revoke all on function public.dmcrm_command_before_match_review(uuid,uuid,jsonb),public.dmcrm_command(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.dmcrm_command(uuid,uuid,jsonb) to service_role;
