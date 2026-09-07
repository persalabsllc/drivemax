begin;
create table public.staff (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique, name text not null, role text not null default 'staff' check (role in ('owner','staff')),
  active boolean not null default true
);
create table public.vehicles (
  id uuid primary key default gen_random_uuid(), slug text not null unique,
  year integer not null check (year between 1900 and 2200), make text not null, model text not null, trim text not null default '',
  vin text not null unique check (vin ~ '^[A-HJ-NPR-Z0-9]{17}$'), stock_number text not null unique,
  miles integer not null check (miles >= 0), internet_price numeric(12,2) not null check (internet_price > 0),
  body_style text not null default '', transmission text not null default '', fuel text not null default '',
  exterior text not null default '', drivetrain text not null default '', description text not null default '', financing text not null default '',
  features text[] not null default '{}', photos text[] not null default '{}', featured boolean not null default false,
  status text not null default 'draft' check (status in ('draft','available','pending','sold','archived')),
  sold_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check (status in ('draft','archived') or (cardinality(photos) > 0 and length(description) >= 20))
);
create index vehicles_status_created on public.vehicles(status, created_at desc);
create table public.vehicle_assets (
  path text primary key, vehicle_id uuid not null references public.vehicles(id), created_at timestamptz not null default now()
);
create table public.leads (
  id uuid primary key, vehicle_id uuid references public.vehicles(id),
  name text not null, email text not null default '', phone text not null default '', preferred_contact text not null,
  kind text not null check (kind in ('vehicle','contact','finance','employment')),
  details jsonb not null default '{}', status text not null default 'new' check (status in ('new','contacted','appointment','won','lost')),
  assigned_to uuid references public.staff(id), follow_up_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index leads_status_created on public.leads(status, created_at desc);
create table public.messages (
  id uuid primary key default gen_random_uuid(), lead_id uuid not null references public.leads(id),
  direction text not null check (direction in ('inbound','outbound','note')),
  body text not null, subject text not null default '', recipient text,
  state text not null default 'received' check (state in ('received','note','pending','sent','delivered','failed','bounced','complained','suppressed')),
  provider_id text unique, staff_id uuid references public.staff(id),
  created_at timestamptz not null default now()
);
create index messages_lead_created on public.messages(lead_id, created_at);
create table public.request_limits (key text primary key, count integer not null, expires_at timestamptz not null);
create function public.take_request_slot(bucket_key text, maximum integer) returns boolean
language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  delete from public.request_limits where expires_at < now();
  insert into public.request_limits(key,count,expires_at) values(bucket_key,1,now() + interval '1 hour')
    on conflict (key) do update set count = public.request_limits.count + 1 returning count into n;
  return n <= maximum;
end $$;
create function public.submit_lead(payload jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare lead_id uuid := (payload->>'requestId')::uuid; inserted_id uuid;
begin
  insert into public.leads(id,vehicle_id,name,email,phone,preferred_contact,kind,details)
    values(lead_id,nullif(payload->>'vehicleId','')::uuid,payload->>'name',lower(payload->>'email'),payload->>'phone',payload->>'preferredContact',payload->>'kind',
      payload - array['requestId','vehicleId','name','email','phone','preferredContact','kind','website','message','experience'])
    on conflict(id) do nothing returning id into inserted_id;
  if inserted_id is not null then
    insert into public.messages(lead_id,direction,body,state) values(lead_id,'inbound',
      coalesce(nullif(payload->>'message',''),nullif(payload->>'experience',''),'Website inquiry — see customer details.'),'received');
  end if;
  return lead_id;
end $$;
create function public.touch_vehicle() returns trigger language plpgsql set search_path = '' as $$
begin
  new.slug := old.slug;
  new.updated_at := now();
  new.sold_at := case when new.status = 'sold' then coalesce(old.sold_at, now()) else null end;
  return new;
end $$;
create trigger vehicle_updated before update on public.vehicles for each row execute function public.touch_vehicle();
-- No browser client may read or write business tables. Access is via authenticated server code.
alter table public.staff enable row level security;
alter table public.vehicles enable row level security;
alter table public.vehicle_assets enable row level security;
alter table public.leads enable row level security;
alter table public.messages enable row level security;
alter table public.request_limits enable row level security;
revoke all on public.staff,public.vehicles,public.vehicle_assets,public.leads,public.messages,public.request_limits from anon,authenticated;
grant all on public.staff,public.vehicles,public.vehicle_assets,public.leads,public.messages,public.request_limits to service_role;
revoke all on function public.take_request_slot(text,integer),public.submit_lead(jsonb) from public,anon,authenticated;
grant execute on function public.take_request_slot(text,integer),public.submit_lead(jsonb) to service_role;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
  values('vehicle-photos','vehicle-photos',true,4194304,array['image/webp']) on conflict(id) do nothing;
commit;
