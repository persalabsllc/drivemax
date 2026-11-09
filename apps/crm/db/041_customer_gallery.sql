-- Website merchandising only. No customer identities or deal records are linked.
create table public.dmcrm_site_photos (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.dmcrm_orgs(id),
  storage_path text,
  seed_path text,
  caption text not null default '' check (length(caption)<=160),
  alt text not null check (length(alt) between 3 and 240),
  kind text not null default 'customer' check (kind in ('customer','exterior','interior')),
  featured boolean not null default false,
  published boolean not null default false,
  sort_order integer not null default 100 check (sort_order between 0 and 99999),
  taken_year integer check (taken_year between 2019 and 2100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (not featured or kind='customer'),
  check ((storage_path is null) <> (seed_path is null)),
  check (seed_path is null or seed_path ~ '^/customers/[a-z0-9-]+\.webp$'),
  check (storage_path is null or storage_path = org_id::text || '/' || id::text || '.webp')
);
create index dmcrm_site_photos_public on public.dmcrm_site_photos(org_id,published,sort_order,id);
alter table public.dmcrm_site_photos enable row level security;
revoke all on public.dmcrm_site_photos from public,anon,authenticated;
grant all on public.dmcrm_site_photos to service_role;

-- Original delivery photos were approved for the public website by the owner.
insert into public.dmcrm_site_photos(id,org_id,seed_path,caption,alt,kind,featured,published,sort_order,taken_year)
select v.id::uuid,o.id,v.path,v.caption,v.alt,'customer',v.featured,true,v.ord,v.yr
from public.dmcrm_orgs o cross join (values
 ('d9a11000-0000-4000-8000-000000000001','/customers/honda-delivery.webp','A new set of keys','A Drive Max customer beside her Honda minivan on delivery day',true,10,2020),
 ('d9a11000-0000-4000-8000-000000000002','/customers/escape-delivery.webp','Ready for the road','A Drive Max customer with his red Ford Escape',true,20,2019),
 ('d9a11000-0000-4000-8000-000000000003','/customers/delivery-day-smiles.webp','Delivery-day smiles','Two smiling Drive Max customers celebrating inside the original office',true,30,2019),
 ('d9a11000-0000-4000-8000-000000000004','/customers/new-car-memories.webp','The start of a new adventure','Two customers with their blue car outside the original Drive Max office',true,40,2019),
 ('d9a11000-0000-4000-8000-000000000005','/customers/equinox-delivery.webp','One more happy drive home','Two Drive Max customers with their Chevrolet Equinox on an evening delivery',false,50,2019)
) as v(id,path,caption,alt,featured,ord,yr)
where o.id='d5a1c100-0000-4000-8000-000000000001';

-- Draft uploads stay private. Website image delivery checks published=true first.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('dmcrm-gallery','dmcrm-gallery',false,4194304,array['image/webp'])
on conflict(id) do nothing;
