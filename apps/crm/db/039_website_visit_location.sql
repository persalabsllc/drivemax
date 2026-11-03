-- Coarse network location only. Existing visits remain unknown; no IPs or
-- coordinates are retained, and access/retention follow the visit itself.
alter table public.dmcrm_web_sessions
 add column location_city text check(length(location_city) between 1 and 120),
 add column location_region text check(location_region ~ '^[A-Z0-9]{1,3}$'),
 add column location_country text check(location_country ~ '^[A-Z]{2}$');

-- Preserve the existing collector RPC during the staged CRM/website rollout.
-- It owns credential validation, session expiry, event safety and deduplication.
create function public.dmcrm_web_record_with_location(
 p_org uuid,p_visitor uuid,p_token text,p_events jsonb,
 p_source text,p_device text,p_location jsonb
) returns void language plpgsql security definer set search_path='' as $$
declare city text;region text;country text;sid uuid;
begin
 perform public.dmcrm_web_record(p_org,p_visitor,p_token,p_events,p_source,p_device);
 if jsonb_typeof(p_location) is distinct from 'object' then return;end if;
 country:=upper(btrim(p_location->>'country'));
 if country is null or country !~ '^[A-Z]{2}$' or country='XX' then return;end if;
 region:=upper(btrim(p_location->>'region'));
 if region is not null and region !~ '^[A-Z0-9]{1,3}$' then region:=null;end if;
 city:=btrim(p_location->>'city');
 if jsonb_typeof(p_location->'city') is distinct from 'string'
  or length(city) not between 1 and 120 or city ~ '[[:cntrl:]<>]'
  or lower(city)='unknown' then city:=null;end if;

 -- The original recorder holds the visitor row lock until this transaction
 -- ends. Capture the first available location for the active visit only.
 select id into sid from public.dmcrm_web_sessions
 where org_id=p_org and visitor_id=p_visitor and last_at>now()-interval '30 minutes'
 order by last_at desc limit 1;
 update public.dmcrm_web_sessions
 set location_city=city,location_region=region,location_country=country
 where id=sid and location_country is null;
end $$;
revoke all on function public.dmcrm_web_record_with_location(uuid,uuid,text,jsonb,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.dmcrm_web_record_with_location(uuid,uuid,text,jsonb,text,text,jsonb) to service_role;
notify pgrst,'reload schema';
