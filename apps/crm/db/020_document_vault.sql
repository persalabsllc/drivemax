-- Existing profile files and new inventory paperwork share one private archive.
alter table public.dmcrm_deal_files alter column customer_id drop not null;
alter table public.dmcrm_deal_files
 add column inventory_id uuid,
 add column customer_name text not null default '',
 add column stock_number text not null default '',
 add column vin text not null default '',
 add column vehicle_label text not null default '',
 add column document_date date not null default ((now() at time zone 'America/New_York')::date),
 add column notes text not null default '' check(length(notes)<=2000),
 add column retain_until date,
 add column sha256 text check(sha256 is null or sha256 ~ '^[a-f0-9]{64}$'),
 add foreign key(org_id,inventory_id) references public.dmcrm_inventory(org_id,id),
 add constraint dmcrm_file_customer_opportunity foreign key(org_id,opportunity_id,customer_id) references public.dmcrm_opportunities(org_id,id,customer_id),
 add constraint dmcrm_file_opportunity_customer check(opportunity_id is null or customer_id is not null);
alter table public.dmcrm_deal_files drop constraint dmcrm_deal_files_size_check;
alter table public.dmcrm_deal_files add check(size between 1 and 26214400);
alter table public.dmcrm_deal_files drop constraint dmcrm_deal_files_kind_check;
alter table public.dmcrm_deal_files add check(kind in('signed','insurance','identification','stipulation','packet','title','purchase','service','other'));
update storage.buckets set public=false,file_size_limit=26214400,allowed_mime_types=array['application/pdf','image/jpeg','image/png'] where id='dmcrm-deal-files';

-- Resolve historical vehicle details before falling back to today's inventory.
create function public.dmcrm_document_snapshot() returns trigger language plpgsql security definer set search_path='' as $$
declare o public.dmcrm_opportunities%rowtype;i public.dmcrm_inventory%rowtype;v jsonb;sold date;
begin
 if new.opportunity_id is not null then
  select * into strict o from public.dmcrm_opportunities where org_id=new.org_id and id=new.opportunity_id and customer_id=new.customer_id;
  if new.inventory_id is not null and new.inventory_id is distinct from o.inventory_id then raise exception 'Choose the vehicle attached to this opportunity';end if;
  new.inventory_id:=o.inventory_id;
  v:=coalesce(o.sale_snapshot->'quote'->'vehicle_details',o.vehicle_details);
 end if;
 if new.inventory_id is not null then
  select * into strict i from public.dmcrm_inventory where org_id=new.org_id and id=new.inventory_id;
  if v is null or v='null'::jsonb then v:=to_jsonb(i);end if;
 end if;
 if new.customer_id is not null then
  select name into strict new.customer_name from public.dmcrm_customers where org_id=new.org_id and id=new.customer_id;
 end if;
 new.stock_number:=coalesce(nullif(v->>'stock_number',''),i.stock_number,'');
 new.vin:=coalesce(nullif(v->>'vin',''),i.vin,'');
 new.vehicle_label:=coalesce(nullif(trim(concat_ws(' ',v->>'year',v->>'make',v->>'model',v->>'trim')),''),nullif(o.vehicle_interest,''),'');
 select max(sold_on) into sold from public.dmcrm_sales where org_id=new.org_id and (opportunity_id=new.opportunity_id or snapshot->'opportunity'->>'inventory_id'=new.inventory_id::text);
 new.retain_until:=greatest(new.retain_until,(greatest((new.created_at at time zone 'America/New_York')::date,new.document_date,sold)+interval '7 years')::date);
 return new;
end $$;
create trigger dmcrm_document_snapshot before insert on public.dmcrm_deal_files for each row execute function public.dmcrm_document_snapshot();

-- Backfill with the same rules, preserving the original upload date and bytes.
create trigger dmcrm_document_backfill before update on public.dmcrm_deal_files for each row execute function public.dmcrm_document_snapshot();
update public.dmcrm_deal_files set document_date=(created_at at time zone 'America/New_York')::date;
drop trigger dmcrm_document_backfill on public.dmcrm_deal_files;
alter table public.dmcrm_deal_files alter column retain_until set not null;
alter table public.dmcrm_deal_files add check(customer_id is not null or inventory_id is not null);
create index dmcrm_files_inventory on public.dmcrm_deal_files(org_id,inventory_id);

-- Archived records cannot be overwritten. Extending retention is allowed;
-- reaching the date does not automatically delete the file.
create function public.dmcrm_document_guard() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='DELETE' then
  if old.retain_until >= (now() at time zone 'America/New_York')::date then raise exception 'Document is within its retention period';end if;
  return old;
 end if;
 if (to_jsonb(new)-'retain_until') is distinct from (to_jsonb(old)-'retain_until') or new.retain_until<old.retain_until then raise exception 'Archived documents cannot be overwritten or retention shortened';end if;
 return new;
end $$;
create trigger dmcrm_document_guard before update or delete on public.dmcrm_deal_files for each row execute function public.dmcrm_document_guard();
create function public.dmcrm_document_sale_retention() returns trigger language plpgsql security definer set search_path='' as $$
declare inv uuid;
begin
 select inventory_id into inv from public.dmcrm_opportunities where org_id=new.org_id and id=new.opportunity_id;
 update public.dmcrm_deal_files set retain_until=greatest(retain_until,(new.sold_on+interval '7 years')::date) where org_id=new.org_id and (opportunity_id=new.opportunity_id or inventory_id=inv);
 return new;
end $$;
create trigger dmcrm_document_sale_retention after insert or update of sold_on on public.dmcrm_sales for each row execute function public.dmcrm_document_sale_retention();

create table public.dmcrm_document_uploads (
 id uuid primary key,org_id uuid not null references public.dmcrm_orgs(id),created_by uuid not null,
 customer_id uuid,opportunity_id uuid,inventory_id uuid,name text not null check(length(name) between 1 and 200),
 kind text not null check(kind in('signed','insurance','identification','stipulation','packet','title','purchase','service','other')),
 size integer not null check(size between 1 and 26214400),mime text not null check(mime in('application/pdf','image/jpeg','image/png')),
 path text not null unique,document_date date not null,notes text not null default '' check(length(notes)<=2000),
 created_at timestamptz not null default now(),completed_at timestamptz,vehicle_snapshot jsonb,
 foreign key(org_id,customer_id) references public.dmcrm_customers(org_id,id),
 foreign key(org_id,opportunity_id,customer_id) references public.dmcrm_opportunities(org_id,id,customer_id),
 foreign key(org_id,inventory_id) references public.dmcrm_inventory(org_id,id),
 check(opportunity_id is null or customer_id is not null),check(customer_id is not null or inventory_id is not null)
);
alter table public.dmcrm_document_uploads enable row level security;
revoke all on public.dmcrm_document_uploads from public,anon,authenticated;
grant all on public.dmcrm_document_uploads to service_role;

create function public.dmcrm_document_access(p_org uuid,p_actor uuid,p_opportunity uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.dmcrm_members m join public.dmcrm_staff s on s.org_id=m.org_id and s.user_id=m.user_id
 where m.org_id=p_org and m.user_id=p_actor and m.active and s.active and (m.role in('owner','manager') or exists(select 1 from public.dmcrm_opportunities o where o.org_id=p_org and o.id=p_opportunity and o.assigned_to=s.id)));
$$;
create function public.dmcrm_complete_document(p_org uuid,p_actor uuid,p_id uuid,p_sha256 text) returns uuid language plpgsql security definer set search_path='' as $$
declare u public.dmcrm_document_uploads%rowtype;actor_name text;o public.dmcrm_opportunities%rowtype;
begin
 select * into strict u from public.dmcrm_document_uploads where id=p_id and org_id=p_org and created_by=p_actor for update;
 if not public.dmcrm_document_access(p_org,p_actor,u.opportunity_id) then raise exception 'Document access denied';end if;
 if u.completed_at is not null then return u.id;end if;
 if u.created_at<now()-interval '24 hours' then raise exception 'Upload expired; upload the document again';end if;
 if u.opportunity_id is not null then
  select * into strict o from public.dmcrm_opportunities where org_id=p_org and id=u.opportunity_id for share;
  if u.vehicle_snapshot is not null and (u.inventory_id is distinct from o.inventory_id or u.vehicle_snapshot is distinct from jsonb_build_object('vin',o.vehicle_details->>'vin','stock_number',o.vehicle_details->>'stock_number','label',o.vehicle_interest)) then raise exception 'The opportunity vehicle changed during upload. Reattach the original to the correct stock number';end if;
 end if;
 if p_sha256 is null or p_sha256 !~ '^[a-f0-9]{64}$' then raise exception 'Document verification required';end if;
 insert into public.dmcrm_deal_files(id,org_id,customer_id,opportunity_id,inventory_id,name,kind,size,mime,path,document_date,notes,sha256,created_by)
 values(u.id,u.org_id,u.customer_id,u.opportunity_id,u.inventory_id,u.name,u.kind,u.size,u.mime,u.path,u.document_date,u.notes,p_sha256,p_actor);
 if u.customer_id is not null then
  select name into actor_name from public.dmcrm_staff where org_id=p_org and user_id=p_actor;
  insert into public.dmcrm_activities(org_id,customer_id,opportunity_id,kind,body,created_by) values(p_org,u.customer_id,u.opportunity_id,'system','Document filed in vault: '||u.name,coalesce(actor_name,'Team member'));
 end if;
 update public.dmcrm_document_uploads set completed_at=now() where id=u.id;
 return u.id;
end $$;
revoke all on function public.dmcrm_document_snapshot(),public.dmcrm_document_guard(),public.dmcrm_document_sale_retention(),public.dmcrm_document_access(uuid,uuid,uuid),public.dmcrm_complete_document(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.dmcrm_document_access(uuid,uuid,uuid),public.dmcrm_complete_document(uuid,uuid,uuid,text) to service_role;
