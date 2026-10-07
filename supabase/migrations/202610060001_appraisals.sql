-- Private appraisal snapshots and encrypted provider configuration.
begin;
create table if not exists public.appraisal_records (
  id uuid primary key,
  vehicle_id uuid references public.vehicles(id) on delete set null,
  vin text not null check (vin ~ '^[A-HJ-NPR-Z0-9]{17}$'),
  title text not null,
  payload jsonb not null,
  created_by uuid not null references public.staff(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists appraisal_records_updated on public.appraisal_records(updated_at desc);
create index if not exists appraisal_records_vin on public.appraisal_records(vin);
create table if not exists public.appraisal_connections (
  provider text primary key check (provider = 'marketcheck'),
  encrypted_key text not null,
  updated_by uuid not null references public.staff(id),
  updated_at timestamptz not null default now()
);
create table if not exists public.appraisal_market_cache (
  key text primary key,
  payload jsonb not null,
  expires_at timestamptz not null
);
alter table public.appraisal_records enable row level security;
alter table public.appraisal_connections enable row level security;
alter table public.appraisal_market_cache enable row level security;
revoke all on public.appraisal_records,public.appraisal_connections,public.appraisal_market_cache from public,anon,authenticated;
grant all on public.appraisal_records,public.appraisal_connections,public.appraisal_market_cache to service_role;
commit;
