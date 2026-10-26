-- CRM stock is the source of vehicle facts. Website merchandising stays local
-- to Control Room; no cost, recon, acquisition or deal data crosses this bridge.
-- A zero asking price is valid only for an unpublished draft/archived listing.
alter table public.vehicles drop constraint vehicles_internet_price_check;
alter table public.vehicles add constraint vehicles_internet_price_check
 check(internet_price>=0 and (status in('draft','archived') or internet_price>0));

create table public.dmcrm_inventory_website (
 inventory_id uuid primary key,
 org_id uuid not null references public.dmcrm_orgs(id),
 website_id uuid unique references public.vehicles(id) on delete set null,
 state text not null default 'pending' check(state in('pending','blocked','synced')),
 last_error_code text,
 attempts integer not null default 0,
 next_attempt_at timestamptz not null default now(),
 last_crm_values jsonb,
 synced_at timestamptz,
 foreign key(org_id,inventory_id) references public.dmcrm_inventory(org_id,id)
);
alter table public.dmcrm_inventory_website enable row level security;
revoke all on public.dmcrm_inventory_website from public,anon,authenticated;
grant all on public.dmcrm_inventory_website to service_role;
create index dmcrm_inventory_website_retry on public.dmcrm_inventory_website(org_id,next_attempt_at) where state<>'synced';

create function public.dmcrm_website_inventory_values(i public.dmcrm_inventory) returns jsonb
language sql immutable set search_path='' as $$
 select jsonb_build_object('vin',i.vin,'stock_number',i.stock_number,'year',i.year,'make',i.make,'model',i.model,'trim',i.trim,
  'miles',i.mileage,'exterior',i.color,'internet_price',i.price,'status',i.status,'deleted',i.deleted_at is not null);
$$;

-- Called by source changes and by the authenticated recovery sweep. A stable
-- inventory-to-website link and website VIN uniqueness make retries idempotent.
create function public.dmcrm_sync_inventory_vehicle(p_id uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare i public.dmcrm_inventory%rowtype;q public.dmcrm_inventory_website%rowtype;w public.vehicles%rowtype;
 values_now jsonb;target jsonb;new_status text;wid uuid;field text;failure text;inactive boolean;
begin
 if not pg_try_advisory_xact_lock(76102613) then return false;end if;
 select * into i from public.dmcrm_inventory where id=p_id and org_id='d5a1c100-0000-4000-8000-000000000001' for share;
 if i.id is null then return false;end if;
 select * into q from public.dmcrm_inventory_website where inventory_id=p_id and org_id=i.org_id for update;
 if q.inventory_id is null then return false;end if;
 values_now:=public.dmcrm_website_inventory_values(i);
 inactive:=i.deleted_at is not null or i.status in('sold','archived');
 begin
  if q.website_id is not null then select * into w from public.vehicles where id=q.website_id for update;end if;
  if w.id is null then select * into w from public.vehicles where vin=i.vin for update;end if;
  wid:=w.id;
  if inactive then
   -- Preserve listing/photos/history, but remove unavailable stock from sale.
   if wid is not null then
    new_status:=case when i.status='sold' and i.deleted_at is null and w.status in('available','pending','sold') then 'sold' else 'archived' end;
    if w.status<>new_status or w.featured then update public.vehicles set status=new_status,featured=false where id=wid;end if;
   end if;
  else
   -- The website editor has narrower inputs. Surface incompatible records;
   -- never truncate a stock number, fabricate a price, or overwrite another VIN.
   if length(i.make)>60 or length(i.model)>80 or length(i.trim)>100 or length(i.stock_number)>40 or length(i.color)>60
    or i.mileage>2000000 or i.year>extract(year from now())::integer+2 then
    failure:='website_limits';raise exception 'Vehicle needs website-compatible details';
   end if;
   if exists(select 1 from public.vehicles v where v.vin=i.vin and v.id is distinct from wid) then
    failure:='vin_conflict';raise exception 'VIN belongs to a different website listing';
   end if;
   if exists(select 1 from public.vehicles v where lower(trim(v.stock_number))=lower(trim(i.stock_number)) and v.id is distinct from wid) then
    failure:='stock_conflict';raise exception 'Stock number belongs to a different website listing';
   end if;
   if wid is null then
    wid:=gen_random_uuid();
    insert into public.vehicles(id,slug,year,make,model,trim,vin,stock_number,miles,exterior,internet_price,status)
     values(wid,trim(both '-' from left(regexp_replace(lower(concat_ws(' ',i.year,i.make,i.model)),'[^a-z0-9]+','-','g'),100))||'-'||replace(wid::text,'-',''),
      i.year,i.make,i.model,i.trim,i.vin,i.stock_number,i.mileage,i.color,i.price,'draft');
   else
    target:=to_jsonb(w);
    -- Update facts changed in CRM; unrelated CRM saves must not undo later
    -- Control Room refinements. Price is seeded on creation only.
    foreach field in array array['vin','stock_number','year','make','model','trim','miles','exterior'] loop
     if field='vin' or q.last_crm_values is null or q.last_crm_values->field is distinct from values_now->field then
      target:=jsonb_set(target,array[field],values_now->field);
     end if;
    end loop;
    new_status:=w.status;
    if i.status='pending' and w.status='available' then new_status:='pending';
    elsif i.status='in_stock' and q.last_crm_values->>'status' in('sold','archived') and w.status in('sold','archived','pending') then new_status:='draft';
    elsif i.status='in_stock' and q.last_crm_values->>'status'='pending' and w.status='pending' then new_status:='available';
    end if;
    if (w.vin,w.stock_number,w.year,w.make,w.model,w.trim,w.miles,w.exterior,w.status)
      is distinct from (target->>'vin',target->>'stock_number',(target->>'year')::integer,target->>'make',target->>'model',target->>'trim',(target->>'miles')::integer,target->>'exterior',new_status) then
     update public.vehicles set vin=target->>'vin',stock_number=target->>'stock_number',year=(target->>'year')::integer,
      make=target->>'make',model=target->>'model',trim=target->>'trim',miles=(target->>'miles')::integer,exterior=target->>'exterior',status=new_status,
      featured=case when new_status in('draft','archived') then false else featured end where id=wid;
    end if;
   end if;
  end if;
  update public.dmcrm_inventory_website set website_id=wid,state='synced',last_error_code=null,attempts=attempts+1,last_crm_values=values_now,synced_at=now() where inventory_id=p_id;
 exception when others then
  update public.dmcrm_inventory_website set state=case when failure is null then 'pending' else 'blocked' end,
   last_error_code=coalesce(failure,'sync_failed'),attempts=attempts+1,next_attempt_at=now()+make_interval(secs=>least(900,60*(attempts+1))) where inventory_id=p_id;
  return false;
 end;
 return true;
end $$;

create function public.dmcrm_inventory_website_trigger() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.org_id<>'d5a1c100-0000-4000-8000-000000000001' then return new;end if;
 if tg_op='UPDATE' and public.dmcrm_website_inventory_values(new)=public.dmcrm_website_inventory_values(old) then return new;end if;
 insert into public.dmcrm_inventory_website(inventory_id,org_id) values(new.id,new.org_id)
 on conflict(inventory_id) do update set state='pending',next_attempt_at=now(),last_error_code=null;
 perform public.dmcrm_sync_inventory_vehicle(new.id);
 return new;
exception when others then
 -- The CRM write remains durable. The sweep below recovers a missing queue row
 -- or changed source snapshot; no partial website record survives a failure.
 raise log 'CRM inventory website sync deferred, SQLSTATE %',sqlstate;
 return new;
end $$;
create trigger dmcrm_inventory_website after insert or update on public.dmcrm_inventory for each row execute function public.dmcrm_inventory_website_trigger();

-- A stale Control Room edit cannot advertise CRM stock that has been sold or
-- removed. Read without locking CRM rows to avoid opposite-order lock cycles.
create function public.dmcrm_website_visibility_guard() returns trigger
language plpgsql security definer set search_path='' as $$
declare i public.dmcrm_inventory%rowtype;
begin
 select c.* into i from public.dmcrm_inventory c left join public.dmcrm_inventory_website q on q.org_id=c.org_id and q.inventory_id=c.id
 where c.org_id='d5a1c100-0000-4000-8000-000000000001' and (q.website_id=new.id or c.vin=new.vin)
 order by (q.website_id=new.id) desc nulls last limit 1;
 if i.id is null then return new;end if;
 if i.deleted_at is not null or i.status='archived' then new.status:='archived';new.featured:=false;
 elsif i.status='sold' and new.status in('available','pending') then
  new.status:=case when cardinality(new.photos)>0 and length(new.description)>=20 and new.internet_price>0 then 'sold' else 'archived' end;new.featured:=false;
 elsif i.status='pending' and new.status='available' then new.status:='pending';
 end if;
 return new;
end $$;
create trigger dmcrm_website_visibility before insert or update on public.vehicles for each row execute function public.dmcrm_website_visibility_guard();

create function public.dmcrm_retry_inventory_website(p_org uuid) returns void
language plpgsql security definer set search_path='' as $$
declare r record;
begin
 if p_org<>'d5a1c100-0000-4000-8000-000000000001' or not pg_try_advisory_xact_lock(76102613) then return;end if;
 for r in select i.id from public.dmcrm_inventory i left join public.dmcrm_inventory_website q on q.org_id=i.org_id and q.inventory_id=i.id
  where i.org_id=p_org and ((i.deleted_at is null and i.status in('in_stock','pending')) or q.inventory_id is not null or exists(select 1 from public.vehicles v where v.vin=i.vin))
   and (q.inventory_id is null or (q.state='synced' and q.last_crm_values is distinct from public.dmcrm_website_inventory_values(i)))
  order by i.created_at,i.id limit 20
 loop
  insert into public.dmcrm_inventory_website(inventory_id,org_id) values(r.id,p_org)
   on conflict(inventory_id) do update set state='pending',next_attempt_at=now(),last_error_code=null;
 end loop;
 for r in select inventory_id from public.dmcrm_inventory_website where org_id=p_org and state<>'synced' and next_attempt_at<=now() order by next_attempt_at,inventory_id limit 20
 loop perform public.dmcrm_sync_inventory_vehicle(r.inventory_id);end loop;
end $$;

create function public.dmcrm_inventory_website_state(p_org uuid,p_actor uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if not exists(select 1 from public.dmcrm_staff s join public.dmcrm_members m on m.org_id=s.org_id and m.user_id=s.user_id where s.org_id=p_org and s.user_id=p_actor and s.active and m.active) then raise exception 'CRM membership required' using errcode='42501';end if;
 select coalesce(jsonb_agg(jsonb_build_object('inventory_id',q.inventory_id,'website_id',q.website_id,'state',q.state,'error_code',q.last_error_code,'synced_at',q.synced_at,'listing_status',v.status,'website_price',v.internet_price) order by q.inventory_id),'[]'::jsonb)
 into result from public.dmcrm_inventory_website q left join public.vehicles v on v.id=q.website_id where q.org_id=p_org;
 return result;
end $$;

alter function public.dmcrm_attention(uuid,uuid) rename to dmcrm_attention_v12;
create function public.dmcrm_attention(p_org uuid,p_actor uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;n integer;
begin
 if not exists(select 1 from public.dmcrm_staff s join public.dmcrm_members m on m.org_id=s.org_id and m.user_id=s.user_id where s.org_id=p_org and s.user_id=p_actor and s.active and m.active) then raise exception 'CRM membership required' using errcode='42501';end if;
 perform public.dmcrm_retry_inventory_website(p_org);
 result:=public.dmcrm_attention_v12(p_org,p_actor);
 if p_org='d5a1c100-0000-4000-8000-000000000001' then
  select count(*) into n from public.dmcrm_inventory_website where org_id=p_org and state<>'synced';
  result:=result||jsonb_build_object('websiteInventory',jsonb_build_object('connected',true,'pending',n));
 end if;
 return result;
end $$;

revoke all on function public.dmcrm_website_inventory_values(public.dmcrm_inventory),public.dmcrm_sync_inventory_vehicle(uuid),public.dmcrm_inventory_website_trigger(),public.dmcrm_website_visibility_guard(),public.dmcrm_retry_inventory_website(uuid),public.dmcrm_inventory_website_state(uuid,uuid),public.dmcrm_attention_v12(uuid,uuid),public.dmcrm_attention(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.dmcrm_inventory_website_state(uuid,uuid),public.dmcrm_attention(uuid,uuid) to service_role;
-- Existing active stock gets the same draft/link behavior, without duplicating
-- website VINs. Remaining batches recover on the normal attention refresh.
select public.dmcrm_retry_inventory_website('d5a1c100-0000-4000-8000-000000000001');
