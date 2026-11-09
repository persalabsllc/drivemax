-- Seven additional customer delivery photos supplied and approved by the owner.
-- Assets are published by the website before these records are made visible.
-- Do not overwrite later manager edits if this seed is ever run again.
insert into public.dmcrm_site_photos
  (id,org_id,seed_path,caption,alt,kind,featured,published,sort_order,taken_year)
select v.id::uuid,o.id,v.path,v.caption,v.alt,'customer',false,true,v.ord,v.yr
from public.dmcrm_orgs o cross join (values
 ('d9a11000-0000-4000-8000-000000000006','/customers/fusion-driveway-delivery.webp','A new adventure in a Fusion','A Drive Max customer beside a white Ford Fusion with its driver door open in a driveway',60,2024),
 ('d9a11000-0000-4000-8000-000000000007','/customers/cobalt-returning-customer.webp','Back for another set of keys','A returning Drive Max customer beside a blue Chevrolet Cobalt outside the original office',70,2020),
 ('d9a11000-0000-4000-8000-000000000008','/customers/christmas-eve-family-delivery.webp','A Christmas Eve delivery','Three Drive Max customers standing together in front of their Dodge Grand Caravan',80,2019),
 ('d9a11000-0000-4000-8000-000000000009','/customers/mini-cooper-delivery.webp','Mini Cooper, big smiles','Two smiling Drive Max customers beside their Mini Cooper at an evening delivery',90,2019),
 ('d9a11000-0000-4000-8000-000000000010','/customers/nissan-doorstep-delivery.webp','Delivered to her door','Two smiling customers in front of a dark Nissan delivered by Drive Max',100,2019),
 ('d9a11000-0000-4000-8000-000000000011','/customers/crv-couple-delivery.webp','Ready for the road together','Two Drive Max customers beside a red Honda CR-V with its driver door open',110,2019),
 ('d9a11000-0000-4000-8000-000000000012','/customers/sienna-delivery.webp','A new chapter with a Sienna','A Drive Max customer beside a blue Toyota Sienna outside the original office',120,2019)
) as v(id,path,caption,alt,ord,yr)
where o.id='d5a1c100-0000-4000-8000-000000000001'
on conflict(id) do nothing;
