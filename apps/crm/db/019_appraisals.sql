-- Valuations are independent research records. Applying an approved ACV is a
-- separate manager action; quotes, allowances and completed sales are immutable here.
create table public.dmcrm_appraisals (
 id uuid primary key, org_id uuid not null references public.dmcrm_orgs(id),
 opportunity_id uuid, source text not null check(source in('trade','street','auction','other')),
 status text not null check(status in('draft','review','valued','archived')),
 data jsonb not null check(jsonb_typeof(data)='object'), revision integer not null default 1 check(revision>0),
 created_by uuid not null, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 reviewed_by uuid, reviewed_name text, reviewed_at timestamptz, applied_at timestamptz,
 unique(org_id,id), unique(org_id,opportunity_id),
 foreign key(org_id,opportunity_id) references public.dmcrm_opportunities(org_id,id),
 foreign key(org_id,created_by) references public.dmcrm_staff(org_id,id),
 check((source='trade')=(opportunity_id is not null))
);
create index on public.dmcrm_appraisals(org_id,updated_at desc);
create table public.dmcrm_appraisal_revisions (
 id uuid primary key default gen_random_uuid(), org_id uuid not null, appraisal_id uuid not null,
 revision integer not null, event text not null, data jsonb not null, status text not null,
 actor uuid not null, actor_name text not null, created_at timestamptz not null default now(),
 foreign key(org_id,appraisal_id) references public.dmcrm_appraisals(org_id,id),
 unique(appraisal_id,revision)
);
alter table public.dmcrm_appraisals enable row level security;
alter table public.dmcrm_appraisal_revisions enable row level security;
revoke all on public.dmcrm_appraisals,public.dmcrm_appraisal_revisions from public,anon,authenticated;
grant all on public.dmcrm_appraisals,public.dmcrm_appraisal_revisions to service_role;

create function public.dmcrm_validate_appraisal(d jsonb) returns void
language plpgsql set search_path='' as $$
declare item jsonb; n text; v jsonb:=d->'vehicle';
begin
 if jsonb_typeof(d) is distinct from 'object' or octet_length(d::text)>100000 or jsonb_typeof(v) is distinct from 'object'
 or coalesce(v->>'year','')!~'^\d{4}$' or (v->>'year')::int not between 1900 and 2100
 or coalesce(length(trim(v->>'make')),0) not between 1 and 250 or coalesce(length(trim(v->>'model')),0) not between 1 and 250
 or coalesce(v->>'vin','')!~'^([A-HJ-NPR-Z0-9]{17})?$' or coalesce(d->>'zip','')!~'^\d{5}$'
 or coalesce(d->>'condition','') not in('uninspected','excellent','good','fair','poor')
 or coalesce(d->>'title','') not in('unverified','clean','branded','salvage')
 or coalesce(d->>'disposition','') not in('retail','wholesale') then raise exception 'Check the appraisal vehicle and values';end if;
 if v->'mileage' is distinct from 'null'::jsonb and (jsonb_typeof(v->'mileage') is distinct from 'number' or (v->>'mileage')::numeric not between 0 and 3000000 or mod((v->>'mileage')::numeric,1)<>0) then raise exception 'Check the appraisal vehicle and values';end if;
 if jsonb_typeof(d->'radius') is distinct from 'number' or (d->>'radius')::numeric not between 10 and 500 then raise exception 'Check the appraisal vehicle and values';end if;
 foreach n in array array['target_value','target_profit','proposed_acv','buyer_fee','transport','other_cost'] loop
  if n in('target_value','proposed_acv') and d->n='null'::jsonb then continue;end if;
  if jsonb_typeof(d->n) is distinct from 'number' or (d->>n)::numeric not between 0 and 1000000 then raise exception 'Check the appraisal vehicle and values';end if;
 end loop;
 foreach n in array array['recon','books','comparables'] loop
  if jsonb_typeof(d->n) is distinct from 'array' or jsonb_array_length(d->n)>30 then raise exception 'Check the appraisal vehicle and values';end if;
 end loop;
 for item in select value from jsonb_array_elements(d->'recon') loop
  if coalesce(length(trim(item->>'label')),0) not between 1 and 250 or jsonb_typeof(item->'amount') is distinct from 'number' or (item->>'amount')::numeric not between 0 and 1000000 then raise exception 'Check the appraisal vehicle and values';end if;
 end loop;
 for item in select value from jsonb_array_elements(d->'books') loop
  if coalesce(item->>'basis','') not in('trade','private','retail','wholesale') or coalesce(length(trim(item->>'source')),0) not between 1 and 250 then raise exception 'Check the appraisal vehicle and values';end if;
  foreach n in array array['low','high'] loop
   if item->n='null'::jsonb then continue;end if;
   if jsonb_typeof(item->n) is distinct from 'number' or (item->>n)::numeric not between 0 and 1000000 then raise exception 'Check the appraisal vehicle and values';end if;
  end loop;
  if (item->>'low')::numeric>(item->>'high')::numeric then raise exception 'Check the appraisal vehicle and values';end if;
  if item->>'low' is null and item->>'high' is null then raise exception 'Check the appraisal vehicle and values';end if;
 end loop;
 for item in select value from jsonb_array_elements(d->'comparables') loop
  if coalesce(item->>'basis','') not in('retail_asking','private_asking','sold','wholesale') or jsonb_typeof(item->'price') is distinct from 'number' or (item->>'price')::numeric<=0 or (item->>'price')::numeric>1000000 or jsonb_typeof(item->'included') is distinct from 'boolean' then raise exception 'Check the appraisal vehicle and values';end if;
 end loop;
end $$;
revoke all on function public.dmcrm_validate_appraisal(jsonb) from public,anon,authenticated,service_role;

alter function public.dmcrm_command(uuid,uuid,jsonb) rename to dmcrm_command_v18;
revoke all on function public.dmcrm_command_v18(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
create function public.dmcrm_command(p_org uuid,p_actor uuid,p_command jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare typ text:=p_command->>'type'; a public.dmcrm_staff%rowtype; r public.dmcrm_appraisals%rowtype;
 o public.dmcrm_opportunities%rowtype; rid uuid; oid uuid;
 d jsonb; rev integer;
 is_manager boolean; message text; old_acv numeric;
begin
 if typ not in('save_appraisal','approve_appraisal','apply_appraisal','archive_appraisal') then return public.dmcrm_command_v18(p_org,p_actor,p_command);end if;
 rid:=(p_command->>'id')::uuid;rev:=(p_command->>'revision')::integer;d:=p_command->'data';
 select s.* into a from public.dmcrm_staff s join public.dmcrm_members m on m.org_id=s.org_id and m.user_id=s.user_id
 where s.org_id=p_org and s.user_id=p_actor and s.active and m.active for update of s,m;
 if a.id is null then raise exception 'Active team membership required' using errcode='42501';end if;
 is_manager:=a.role in('owner','manager');
 if rid is null or rev is null then raise exception 'Appraisal changed in another session. Reload before saving.';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_org::text||rid::text,0));
 select * into r from public.dmcrm_appraisals where org_id=p_org and id=rid for update;
 if r.id is null then
  if typ<>'save_appraisal' or rev<>0 then raise exception 'Appraisal changed in another session. Reload before saving.';end if;
  oid:=(p_command->>'opportunity_id')::uuid;
 else
  if rev<>r.revision then raise exception 'Appraisal changed in another session. Reload before saving.';end if;
  oid:=r.opportunity_id;
  if typ='save_appraisal' and (oid is distinct from (p_command->>'opportunity_id')::uuid or r.source is distinct from p_command->>'source') then raise exception 'Appraisal source cannot be changed';end if;
 end if;
 if oid is not null then
  select * into o from public.dmcrm_opportunities where org_id=p_org and id=oid for update;
  if o.id is null then raise exception 'Opportunity not found';end if;
  if o.status in('sold','lost') then raise exception 'Closed deal appraisals are read-only';end if;
  if not is_manager and o.assigned_to is distinct from a.id then raise exception 'Only the assigned salesperson or a manager can edit this appraisal' using errcode='42501';end if;
  if r.id is null and exists(select 1 from public.dmcrm_appraisals where org_id=p_org and opportunity_id=oid) then raise exception 'This trade already has an appraisal. Reload to open it.';end if;
 elsif not is_manager and r.created_by is not null and r.created_by<>a.id then
  raise exception 'Only the assigned salesperson or a manager can edit this appraisal' using errcode='42501';
 end if;
 if typ='save_appraisal' then
  perform public.dmcrm_validate_appraisal(d);
  if coalesce(p_command->>'status','') not in('draft','review') or coalesce(p_command->>'source','') not in('trade','street','auction','other') or ((p_command->>'source'='trade')<>(oid is not null)) then raise exception 'Check the appraisal vehicle and values';end if;
  insert into public.dmcrm_appraisals(id,org_id,opportunity_id,source,status,data,created_by)
  values(rid,p_org,oid,p_command->>'source',p_command->>'status',d,a.id)
  on conflict(id) do update set data=excluded.data,status=excluded.status,revision=dmcrm_appraisals.revision+1,
   updated_at=now(),reviewed_by=null,reviewed_name=null,reviewed_at=null,applied_at=null
  where dmcrm_appraisals.org_id=p_org;
  if not found then raise exception 'Appraisal not found';end if;
  message:=case when p_command->>'status'='review' then 'Trade appraisal sent for manager review' else 'Trade appraisal saved' end;
 elsif typ='archive_appraisal' then
  update public.dmcrm_appraisals set status='archived',revision=revision+1,updated_at=now(),reviewed_by=null,reviewed_name=null,reviewed_at=null where org_id=p_org and id=rid;
  message:='Trade appraisal archived';
 else
  if not is_manager then raise exception 'Manager access required' using errcode='42501';end if;
  if r.status='archived' or r.data->>'proposed_acv' is null or r.data->>'target_value' is null then raise exception 'Enter an offer and expected selling price before approval';end if;
  if oid is not null and (o.trade is null or coalesce(o.trade->>'vin','')='' or
   (select jsonb_build_array(upper(o.trade->>'vin'),o.trade->'mileage',o.trade->'year',lower(trim(o.trade->>'make')),lower(trim(o.trade->>'model')),lower(trim(o.trade->>'trim')))) is distinct from
   (select jsonb_build_array(upper(r.data->'vehicle'->>'vin'),r.data->'vehicle'->'mileage',r.data->'vehicle'->'year',lower(trim(r.data->'vehicle'->>'make')),lower(trim(r.data->'vehicle'->>'model')),lower(trim(r.data->'vehicle'->>'trim')))))
   then raise exception 'Trade details changed. Refresh the appraisal vehicle before approval.';end if;
  if typ='approve_appraisal' then
   update public.dmcrm_appraisals set status='valued',revision=revision+1,updated_at=now(),reviewed_by=a.id,reviewed_name=a.name,reviewed_at=now(),applied_at=null where org_id=p_org and id=rid;
   message:='Trade appraisal approved · ACV $'||(r.data->>'proposed_acv');
  else
   if oid is null or r.status<>'valued' or r.reviewed_at is null then raise exception 'Approve a linked trade appraisal before applying its ACV';end if;
   if o.updated_at is distinct from (p_command->>'opportunity_updated_at')::timestamptz then raise exception 'Opportunity changed. Reload before applying this appraisal.';end if;
   if r.applied_at is not null then raise exception 'This appraisal has already been applied';end if;
   old_acv:=(o.trade->>'acv')::numeric;
   update public.dmcrm_opportunities set trade=jsonb_set(trade,'{acv}',r.data->'proposed_acv'),updated_at=now() where org_id=p_org and id=oid;
   update public.dmcrm_appraisals set applied_at=now(),revision=revision+1,updated_at=now() where org_id=p_org and id=rid;
   message:='Appraisal ACV applied to trade · $'||coalesce(old_acv,0)||' → $'||(r.data->>'proposed_acv')||'. Allowance and saved quotes unchanged.';
  end if;
 end if;
 select * into r from public.dmcrm_appraisals where org_id=p_org and id=rid;
 insert into public.dmcrm_appraisal_revisions(org_id,appraisal_id,revision,event,data,status,actor,actor_name) values(p_org,rid,r.revision,typ,r.data,r.status,p_actor,a.name);
 insert into public.dmcrm_audit(org_id,actor,action,record_id) values(p_org,p_actor,typ,rid);
 if oid is not null then insert into public.dmcrm_activities(org_id,customer_id,opportunity_id,kind,body,created_by) values(p_org,o.customer_id,oid,'system',message,a.name);end if;
 return rid;
end $$;
revoke all on function public.dmcrm_command(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.dmcrm_command(uuid,uuid,jsonb) to service_role;
