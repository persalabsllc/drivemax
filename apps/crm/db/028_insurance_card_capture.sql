alter table public.dmcrm_deal_files add column insurance_capture boolean not null default false,add column insurance_values jsonb;
alter table public.dmcrm_deal_files add constraint dmcrm_insurance_capture_check check(
 (not insurance_capture and insurance_values is null) or
 (insurance_capture and not license_capture and kind='insurance' and customer_id is not null and mime='image/jpeg' and size<=3145728 and jsonb_typeof(insurance_values)='object')
);
create index dmcrm_insurance_card_latest on public.dmcrm_deal_files(org_id,customer_id,created_at desc) where insurance_capture;
create function public.dmcrm_insurance_access(p_org uuid,p_actor uuid,p_customer uuid,p_opportunity uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select case when p_opportunity is null then public.dmcrm_license_access(p_org,p_actor,p_customer) else exists(
  select 1 from public.dmcrm_opportunities o join public.dmcrm_members m on m.org_id=o.org_id and m.user_id=p_actor and m.active
  join public.dmcrm_staff s on s.org_id=m.org_id and s.user_id=m.user_id and s.active
  where o.org_id=p_org and o.id=p_opportunity and o.customer_id=p_customer and (m.role in('owner','manager') or o.assigned_to=s.id)) end;
$$;
create function public.dmcrm_save_insurance_capture(p_org uuid,p_actor uuid,p_customer uuid,p_opportunity uuid,p_id uuid,p_size integer,p_sha256 text,p_insurance jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare c public.dmcrm_customers%rowtype;o public.dmcrm_opportunities%rowtype;f public.dmcrm_deal_files%rowtype;file_path text;actor_name text;
begin
 select * into c from public.dmcrm_customers where org_id=p_org and id=p_customer and merged_into is null for share;
 if c.id is null or not public.dmcrm_insurance_access(p_org,p_actor,p_customer,p_opportunity) then raise exception 'Insurance access denied' using errcode='42501';end if;
 file_path:=p_org::text||'/insurance/'||p_id::text||'.jpg';
 select * into f from public.dmcrm_deal_files where id=p_id for update;
 if found then
  if f.org_id=p_org and f.customer_id=p_customer and f.opportunity_id is not distinct from p_opportunity and f.insurance_capture
   and f.path=file_path and f.sha256=p_sha256 and f.size=p_size and f.insurance_values=p_insurance then return p_id;end if;
  raise exception 'This insurance capture was already filed with different details';
 end if;
 if p_opportunity is not null then
  select * into o from public.dmcrm_opportunities where org_id=p_org and id=p_opportunity and customer_id=p_customer for share;
  if o.id is null or o.status in('sold','lost') then raise exception 'Closed deals keep their recorded insurance';end if;
 end if;
 if p_size not between 1 and 3145728 or p_sha256 is null or p_sha256!~'^[a-f0-9]{64}$' or jsonb_typeof(p_insurance) is distinct from 'object' then raise exception 'Invalid insurance image';end if;
 if c.insurance is distinct from p_insurance then raise exception 'Save the reviewed insurance details before attaching the card';end if;
 insert into public.dmcrm_deal_files(id,org_id,customer_id,opportunity_id,name,kind,size,mime,path,sha256,created_by,insurance_capture,insurance_values)
 values(p_id,p_org,p_customer,p_opportunity,'Insurance-card.jpg','insurance',p_size,'image/jpeg',file_path,p_sha256,p_actor,true,p_insurance);
 select name into actor_name from public.dmcrm_staff where org_id=p_org and user_id=p_actor;
 insert into public.dmcrm_activities(org_id,customer_id,opportunity_id,kind,body,created_by)
 values(p_org,p_customer,p_opportunity,'system','Reviewed insurance card saved to the private customer file.',coalesce(actor_name,'Team member'));
 return p_id;
end $$;
revoke all on function public.dmcrm_insurance_access(uuid,uuid,uuid,uuid),public.dmcrm_save_insurance_capture(uuid,uuid,uuid,uuid,uuid,integer,text,jsonb) from public,anon,authenticated;
grant execute on function public.dmcrm_insurance_access(uuid,uuid,uuid,uuid),public.dmcrm_save_insurance_capture(uuid,uuid,uuid,uuid,uuid,integer,text,jsonb) to service_role;
