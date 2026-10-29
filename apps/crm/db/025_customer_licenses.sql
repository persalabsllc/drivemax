-- License originals use the existing private, retained document archive.
-- A normalized crop identifies the portrait without storing a second original.
alter table public.dmcrm_deal_files
 add column license_capture boolean not null default false,
 add column license_portrait jsonb;

create function public.dmcrm_license_crop_valid(p jsonb) returns boolean
language sql immutable set search_path='' as $$
 select coalesce(jsonb_typeof(p)='object'
  and jsonb_typeof(p->'x')='number' and jsonb_typeof(p->'y')='number'
  and jsonb_typeof(p->'width')='number' and jsonb_typeof(p->'height')='number'
  and (p->>'x')::numeric between 0 and 1 and (p->>'y')::numeric between 0 and 1
  and (p->>'width')::numeric between 0.03 and 1 and (p->>'height')::numeric between 0.03 and 1
  and (p->>'x')::numeric+(p->>'width')::numeric<=1.000001
  and (p->>'y')::numeric+(p->>'height')::numeric<=1.000001,false);
$$;
alter table public.dmcrm_deal_files add constraint dmcrm_license_file_check check(
 (not license_capture and license_portrait is null) or
 (license_capture and kind='identification' and customer_id is not null and opportunity_id is null
  and mime='image/jpeg' and size<=3145728 and public.dmcrm_license_crop_valid(license_portrait))
);
create index dmcrm_customer_license_latest on public.dmcrm_deal_files(org_id,customer_id,created_at desc,id) where license_capture;

create function public.dmcrm_license_access(p_org uuid,p_actor uuid,p_customer uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.dmcrm_customers c
 join public.dmcrm_members m on m.org_id=c.org_id and m.user_id=p_actor and m.active
 join public.dmcrm_staff s on s.org_id=m.org_id and s.user_id=m.user_id and s.active
 where c.org_id=p_org and c.id=p_customer and c.merged_into is null
 and (m.role in('owner','manager') or c.assigned_to=s.id or exists(
  select 1 from public.dmcrm_opportunities o where o.org_id=c.org_id and o.assigned_to=s.id
   and (o.customer_id=c.id or o.co_buyer_id=c.id))));
$$;
create function public.dmcrm_save_license(p_org uuid,p_actor uuid,p_customer uuid,p_id uuid,p_size integer,p_sha256 text,p_portrait jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare existing public.dmcrm_deal_files%rowtype;actor_name text;file_path text;
begin
 perform id from public.dmcrm_customers where org_id=p_org and id=p_customer and merged_into is null for share;
 if not found or not public.dmcrm_license_access(p_org,p_actor,p_customer) then raise exception 'License access denied' using errcode='42501';end if;
 if p_size not between 1 and 3145728 or p_sha256 is null or p_sha256!~'^[a-f0-9]{64}$' or not public.dmcrm_license_crop_valid(p_portrait) then raise exception 'Invalid license image';end if;
 file_path:=p_org::text||'/licenses/'||p_id::text||'.jpg';
 select * into existing from public.dmcrm_deal_files where id=p_id for update;
 if found then
  if existing.org_id=p_org and existing.customer_id=p_customer and existing.license_capture
   and existing.sha256=p_sha256 and existing.size=p_size and existing.license_portrait=p_portrait and existing.path=file_path then return p_id;end if;
  raise exception 'This capture was already filed with different details';
 end if;
 insert into public.dmcrm_deal_files(id,org_id,customer_id,name,kind,size,mime,path,sha256,created_by,license_capture,license_portrait)
 values(p_id,p_org,p_customer,'Driver license.jpg','identification',p_size,'image/jpeg',file_path,p_sha256,p_actor,true,p_portrait);
 select name into actor_name from public.dmcrm_staff where org_id=p_org and user_id=p_actor;
 insert into public.dmcrm_activities(org_id,customer_id,kind,body,created_by)
 values(p_org,p_customer,'system','Driver license image saved to the private customer file.',coalesce(actor_name,'Team member'));
 return p_id;
end $$;
revoke all on function public.dmcrm_license_crop_valid(jsonb),public.dmcrm_license_access(uuid,uuid,uuid),public.dmcrm_save_license(uuid,uuid,uuid,uuid,integer,text,jsonb) from public,anon,authenticated;
grant execute on function public.dmcrm_license_crop_valid(jsonb),public.dmcrm_license_access(uuid,uuid,uuid),public.dmcrm_save_license(uuid,uuid,uuid,uuid,integer,text,jsonb) to service_role;
