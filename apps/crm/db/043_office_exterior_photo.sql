-- Owner-supplied exterior artwork approved for the public website.
-- Publish the website asset first; keep this record editable in Customer gallery.
-- Re-running the seed must not overwrite later manager edits or republish it.
insert into public.dmcrm_site_photos
  (id,org_id,seed_path,caption,alt,kind,featured,published,sort_order,taken_year)
select
  'd9a11000-0000-4000-8000-000000000013'::uuid,
  o.id,
  '/customers/drive-max-office-exterior.webp',
  'Drive Max office & lot',
  'Exterior view of the Drive Max office, gravel driveway, and vehicle lot in New Bern',
  'exterior',false,true,0,null
from public.dmcrm_orgs o
where o.id='d5a1c100-0000-4000-8000-000000000001'
on conflict(id) do nothing;
