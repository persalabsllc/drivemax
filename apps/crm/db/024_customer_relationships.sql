-- Keep merged identities as aliases. No customer, correspondence, sale, or file is deleted.
alter table public.dmcrm_customers
 add column merged_into uuid,
 add column co_buyer_id uuid,
 add foreign key(org_id,merged_into) references public.dmcrm_customers(org_id,id),
 add foreign key(org_id,co_buyer_id) references public.dmcrm_customers(org_id,id),
 add check(merged_into is distinct from id),
 add check(co_buyer_id is distinct from id);
create index on public.dmcrm_customers(org_id,merged_into);
create index on public.dmcrm_customers(org_id,co_buyer_id);
alter table public.dmcrm_opportunities
 add column co_buyer_id uuid,
 add column co_buyer jsonb,
 add foreign key(org_id,co_buyer_id) references public.dmcrm_customers(org_id,id),
 add check(co_buyer_id is distinct from customer_id),
 add check(co_buyer is null or jsonb_typeof(co_buyer)='object');
update public.dmcrm_opportunities o set co_buyer=
 case when o.status in('sold','lost') then nullif(o.sale_snapshot#>'{customer,co_buyer}','null') else c.co_buyer end
 from public.dmcrm_customers c where c.org_id=o.org_id and c.id=o.customer_id;

create table public.dmcrm_customer_merges (
 id uuid primary key default gen_random_uuid(), org_id uuid not null references public.dmcrm_orgs(id),
 source_id uuid not null, target_id uuid not null, actor uuid not null, actor_name text not null,
 details_from text not null check(details_from in('source','target')),
 before_source jsonb not null, before_target jsonb not null, related_before jsonb not null,
 created_at timestamptz not null default now(), transaction_id bigint not null default txid_current(),
 unique(org_id,source_id), foreign key(org_id,source_id) references public.dmcrm_customers(org_id,id),
 foreign key(org_id,target_id) references public.dmcrm_customers(org_id,id),check(source_id<>target_id)
);
alter table public.dmcrm_customer_merges enable row level security;
revoke all on public.dmcrm_customer_merges from public,anon,authenticated;
grant all on public.dmcrm_customer_merges to service_role;
create view public.dmcrm_customer_aliases as
 select id,org_id,merged_into as customer_id,name,email,phone,updated_at as merged_at
 from public.dmcrm_customers where merged_into is not null
 union all
 select m.id,m.org_id,coalesce(c.merged_into,c.id),m.before_target->>'name',m.before_target->>'email',m.before_target->>'phone',m.created_at
 from public.dmcrm_customer_merges m join public.dmcrm_customers c on c.org_id=m.org_id and c.id=m.target_id where m.details_from='source';
revoke all on public.dmcrm_customer_aliases from public,anon,authenticated;
grant select on public.dmcrm_customer_aliases to service_role;

-- All mutable relationships can be reparented in one transaction without weakening
-- their final tenant/customer/opportunity consistency checks.
do $$ declare fk record; begin
 for fk in select conrelid::regclass as tbl,conname from pg_constraint
 where contype='f' and confrelid='public.dmcrm_opportunities'::regclass and cardinality(conkey)=3 loop
  execute format('alter table %s alter constraint %I deferrable initially immediate',fk.tbl,fk.conname);
 end loop;
end $$;

create function public.dmcrm_resolve_customer(p_org uuid,p_id uuid) returns uuid
language plpgsql set search_path='' as $$
declare next_id uuid; current_id uuid:=p_id; n integer:=0;
begin
 if current_id is null then return null;end if;
 loop
  select merged_into into next_id from public.dmcrm_customers where org_id=p_org and id=current_id for key share;
  if not found then raise exception 'Co-buyer profile unavailable. Refresh and choose a customer.';end if;
  if next_id is null then return current_id;end if;
  current_id:=next_id;n:=n+1;
  if n>32 then raise exception 'Invalid customer alias';end if;
 end loop;
end $$;
create function public.dmcrm_customer_person(c public.dmcrm_customers) returns jsonb
language plpgsql stable set search_path='' as $$
declare parts text[]:=regexp_split_to_array(trim(c.name),'[[:space:]]+');suffix text:='';first_name text;last_name text:='';middle_name text:='';n integer;
begin
 n:=cardinality(parts);
 if n>0 and parts[n] ~* '^(jr\.?|sr\.?|ii|iii|iv|v)$' then suffix:=parts[n];parts:=parts[1:n-1];end if;
 first_name:=coalesce(parts[1],'');parts:=parts[2:cardinality(parts)];n:=coalesce(cardinality(parts),0);
 if n>1 then last_name:=parts[n];middle_name:=array_to_string(parts[1:n-1],' ');
 elsif n=1 then last_name:=parts[1];end if;
 if c.person is not null then first_name:='';middle_name:='';last_name:='';suffix:='';end if;
 return jsonb_build_object(
  'first_name',first_name,'middle_name',middle_name,'last_name',last_name,'suffix',suffix,
  'license_state','NC','license_number','','address1','','address2','','city','','state','NC','zip','','county','',
  'mailing_different',false,'mailing_address1','','mailing_address2','','mailing_city','','mailing_state','NC','mailing_zip','')
  ||coalesce(c.person,'{}'::jsonb)||jsonb_build_object('phone',coalesce(nullif(c.phone,''),c.person->>'phone',''),'email',coalesce(nullif(c.email,''),c.person->>'email',''));
end;
$$;
create function public.dmcrm_customer_reference() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.customer_id is not null then new.customer_id:=public.dmcrm_resolve_customer(new.org_id,new.customer_id);end if;
 return new;
end $$;
-- Also catches late uploads, in-flight website submissions, and stale client IDs.
-- Old unsubscribe tokens intentionally retain their alias and resolve at use time.
do $$ declare tbl text; begin
 foreach tbl in array array['opportunities','activities','appointments','deal_files','document_uploads','facebook_contacts','facebook_messages','messages','push_jobs','quick_quote_conversions','quotes','sales','sales_events','tasks','title_cases','trades','visits','website_intake','workflow_jobs'] loop
  execute format('create trigger dmcrm_00_customer_reference before insert or update of customer_id on public.%I for each row execute function public.dmcrm_customer_reference()','dmcrm_'||tbl);
 end loop;
end $$;

-- A merge can change the filing link only, within its audited transaction.
-- Original names, bytes, hashes, dates, and retention remain immutable.
create or replace function public.dmcrm_document_guard() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='DELETE' then
  if old.retain_until >= (now() at time zone 'America/New_York')::date then raise exception 'Document is within its retention period';end if;
  return old;
 end if;
 if new.customer_id is distinct from old.customer_id
  and (to_jsonb(new)-'customer_id')=(to_jsonb(old)-'customer_id')
  and exists(select 1 from public.dmcrm_customer_merges m where m.org_id=old.org_id and m.source_id=old.customer_id and m.target_id=new.customer_id and m.transaction_id=txid_current()) then return new;end if;
 if (to_jsonb(new)-'retain_until') is distinct from (to_jsonb(old)-'retain_until') or new.retain_until<old.retain_until then raise exception 'Archived documents cannot be overwritten or retention shortened';end if;
 return new;
end $$;

create function public.dmcrm_co_buyer_paperwork(paperwork jsonb) returns jsonb
language plpgsql set search_path='' as $$
declare result jsonb:=coalesce(paperwork,'{}'::jsonb);mapping jsonb:='{"cover":["co_buyer_name"],"insurance":[],"we-owe":[],"warranty":[],"references":[],"photo-release":[],"payoff":["co_buyer_name"],"bill-of-sale":["cobuyer_name","cobuyer_address","cobuyer_city","cobuyer_state","cobuyer_zip","cobuyer_phone"],"MVR-1":["Enter Owner 2 ID Number","Enter Full Legal Name of Owner 2 to include First, Middle, Last, Suffix or Company 2 Name"],"MVR-63":["BUYER,  SELLER, OR  LEGAL OWNER"],"trade-MVR-63":[],"MVR-180":["BUYERS PRINTED NAME"],"trade-MVR-180":[],"MVR-181":[],"trade-MVR-181":[],"MVR-6TT":["Owner 2 ID","Full Legal Name of Owner 2 First Middle Last Suffix or Company Name"],"MVR-2":["section1.buyer_name_address","section2.buyer_name_address","section3.buyer_name_address"],"MVR-614":[],"MVR-330":[],"MVR-1A":["F023","F024"],"MVR-4":[],"MVR-5":[],"MVR-6":[],"MVR-8":[],"MVR-28":[],"MVR-46D":[],"MVR-613":["F006"],"MVR-620":["F008","F009"]}'::jsonb;item record;keys text[];
begin
 for item in select * from jsonb_each(result) loop
  if jsonb_typeof(item.value)<>'object' then continue;end if;
  if item.key='$common' then select array_agg(key) into keys from jsonb_each(item.value) where left(key,9)='co_buyer.' or key='buyers.names';
  else select array_agg(value) into keys from jsonb_array_elements_text(coalesce(mapping->item.key,'[]'::jsonb));end if;
  result:=jsonb_set(result,array[item.key],item.value-coalesce(keys,array[]::text[]));
 end loop;
 return result;
end $$;
revoke all on function public.dmcrm_co_buyer_paperwork(jsonb) from public,anon,authenticated,service_role;
create function public.dmcrm_opportunity_co_buyer() returns trigger language plpgsql security definer set search_path='' as $$
declare c public.dmcrm_customers%rowtype; cleaned jsonb;
begin
 if tg_op='INSERT' then
  select * into c from public.dmcrm_customers where org_id=new.org_id and id=new.customer_id;
  new.co_buyer_id:=c.co_buyer_id;new.co_buyer:=c.co_buyer;
 end if;
 if new.co_buyer_id is not null then
  new.co_buyer_id:=public.dmcrm_resolve_customer(new.org_id,new.co_buyer_id);
  if new.co_buyer_id=new.customer_id then raise exception 'A customer cannot be their own co-buyer.';end if;
  -- Preserve recorded co-buyer details on previously closed deals, including merges.
  if tg_op='INSERT' or old.status not in('sold','lost') then
   select * into c from public.dmcrm_customers where org_id=new.org_id and id=new.co_buyer_id;
   new.co_buyer:=public.dmcrm_customer_person(c);
  end if;
 end if;
 if tg_op='UPDATE' and old.status not in('sold','lost') and new.co_buyer is distinct from old.co_buyer then
  cleaned:=public.dmcrm_co_buyer_paperwork(new.paperwork);
  if cleaned is distinct from new.paperwork then new.paperwork:=cleaned;new.paperwork_revision:=new.paperwork_revision+1;end if;
 end if;
 if tg_op='UPDATE' and new.status in('sold','lost') and old.status not in('sold','lost') and new.sale_snapshot is not null then
  new.sale_snapshot:=jsonb_set(new.sale_snapshot,'{customer,co_buyer}',coalesce(new.co_buyer,'null'::jsonb));
  new.sale_snapshot:=jsonb_set(new.sale_snapshot,'{customer,co_buyer_id}',coalesce(to_jsonb(new.co_buyer_id),'null'::jsonb));
 end if;
 return new;
end $$;
create trigger dmcrm_opportunity_co_buyer before insert or update on public.dmcrm_opportunities for each row execute function public.dmcrm_opportunity_co_buyer();
create function public.dmcrm_refresh_co_buyer() returns trigger language plpgsql security definer set search_path='' as $$
begin
 update public.dmcrm_customers set co_buyer=public.dmcrm_customer_person(new),updated_at=now() where org_id=new.org_id and co_buyer_id=new.id;
 update public.dmcrm_opportunities set co_buyer=public.dmcrm_customer_person(new),updated_at=now() where org_id=new.org_id and co_buyer_id=new.id and status not in('sold','lost');
 return new;
end $$;
create trigger dmcrm_refresh_co_buyer after update of name,email,phone,person on public.dmcrm_customers for each row execute function public.dmcrm_refresh_co_buyer();
create function public.dmcrm_quote_co_buyer() returns trigger language plpgsql security definer set search_path='' as $$
declare co jsonb;
begin
 if new.opportunity_id is not null and jsonb_typeof(new.values->'fiMenu')='object' then
  select co_buyer into co from public.dmcrm_opportunities where org_id=new.org_id and id=new.opportunity_id;
  new.values:=jsonb_set(new.values,'{fiMenu,co_buyer_name}',to_jsonb(trim(concat_ws(' ',co->>'first_name',nullif(co->>'middle_name',''),co->>'last_name',nullif(co->>'suffix','')))));
 end if;
 return new;
end $$;
create trigger dmcrm_quote_co_buyer before insert or update of values on public.dmcrm_quotes for each row execute function public.dmcrm_quote_co_buyer();

create function public.dmcrm_link_co_buyer(p_org uuid,p_staff uuid,p_link jsonb) returns uuid
language plpgsql set search_path='' as $$
declare cid uuid;p jsonb:=p_link->'person';mode text:=p_link->>'mode';actor_name text;
begin
 if mode='none' then return null;
 elsif mode='existing' then
  if p_link->>'customer_id' is null then raise exception 'Co-buyer profile unavailable. Refresh and choose a customer.';end if;
  return public.dmcrm_resolve_customer(p_org,(p_link->>'customer_id')::uuid);
 elsif mode='new' then
  if jsonb_typeof(p) is distinct from 'object' or length(p::text)>16000 or coalesce(length(trim(p->>'first_name')),0) not between 1 and 250 or coalesce(length(trim(p->>'last_name')),0) not between 1 and 250 then raise exception 'Enter the co-buyer’s first and last name.';end if;
  insert into public.dmcrm_customers(org_id,name,email,phone,source,person,assigned_to)
  values(p_org,trim(concat_ws(' ',trim(p->>'first_name'),nullif(trim(p->>'middle_name'),''),trim(p->>'last_name'),nullif(trim(p->>'suffix'),''))),coalesce(p->>'email',''),coalesce(p->>'phone',''),'Co-buyer',p,p_staff) returning id into cid;
  select name into actor_name from public.dmcrm_staff where org_id=p_org and id=p_staff;
  insert into public.dmcrm_activities(org_id,customer_id,kind,body,created_by) values(p_org,cid,'system','Customer profile created for a co-buyer',actor_name);
  return cid;
 end if;
 raise exception 'Co-buyer profile unavailable. Refresh and choose a customer.';
end $$;

-- A known alias is one identity, even when both old and kept details match.
do $$ declare def text; begin
 select pg_get_functiondef('public.dmcrm_import_website_inquiry(uuid)'::regprocedure) into def;
 if position('select array_agg(c.id) into candidates' in def)=0 then raise exception 'Website matching definition changed';end if;
 def:=replace(def,'select array_agg(c.id) into candidates','select array_agg(distinct public.dmcrm_resolve_customer(c.org_id,c.id)) into candidates');
 def:=replace(def,'from public.dmcrm_customers c where c.org_id=q.org_id',
  'from (select org_id,id,name,email,phone from public.dmcrm_customers union all select org_id,customer_id,name,email,phone from public.dmcrm_customer_aliases) c where c.org_id=q.org_id');
 def:=replace(def,'if matched_name=name_key then',
  'if matched_name=name_key or exists(select 1 from public.dmcrm_customer_aliases ca where ca.org_id=q.org_id and ca.customer_id=candidates[1] and lower(regexp_replace(trim(ca.name),''[[:space:]]+'','' '',''g''))=name_key) then');
 execute def;
end $$;
create or replace function public.dmcrm_public_unsubscribe(p_token uuid,p_confirm boolean default false) returns boolean language plpgsql security definer set search_path='' as $$
declare c public.dmcrm_customers%rowtype;
begin
 select c1.* into c from public.dmcrm_workflow_contacts wc join public.dmcrm_customers c1 on c1.org_id=wc.org_id and c1.id=public.dmcrm_resolve_customer(wc.org_id,wc.customer_id) where wc.token=p_token;
 if c.id is null then return false;end if;
 if p_confirm then
  update public.dmcrm_customers set email_opt_out=true where id=c.id;
  insert into public.dmcrm_email_suppressions(org_id,email,reason) select org_id,lower(trim(email)),'Customer requested no email' from public.dmcrm_customers where org_id=c.org_id and (id=c.id or merged_into=c.id) and trim(email)<>'' on conflict do nothing;
  if not c.email_opt_out then insert into public.dmcrm_activities(org_id,customer_id,kind,body,created_by) values(c.org_id,c.id,'system','Customer unsubscribed from CRM email.','Customer');end if;
 end if;return true;
end $$;

-- Aliases must not create a second birthday campaign or new-lead alert.
do $$ declare def text; begin
 select pg_get_functiondef('public.dmcrm_workflow_prepare()'::regprocedure) into def;
 if position('from public.dmcrm_customers c1 where to_char' in def)=0 then raise exception 'Birthday workflow definition changed';end if;
 def:=replace(def,'from public.dmcrm_customers c1 where to_char','from (select * from public.dmcrm_customers where merged_into is null) c1 where to_char');
 execute def;
end $$;
alter function public.dmcrm_attention_items(uuid,uuid) rename to dmcrm_attention_items_before_customer_links;
create function public.dmcrm_attention_items(p_org uuid,p_actor uuid)
returns table(key text,kind text,id uuid,customer_id uuid,customer_name text,opportunity_id uuid,channel text,title text,detail text,created_at timestamptz)
language sql security definer set search_path='' as $$
 select e.* from public.dmcrm_attention_items_before_customer_links(p_org,p_actor) e
 where e.kind<>'lead' or exists(select 1 from public.dmcrm_customers c where c.org_id=p_org and c.id=e.customer_id and c.merged_into is null
 and (c.source<>'Co-buyer' or exists(select 1 from public.dmcrm_opportunities o where o.org_id=c.org_id and o.customer_id=c.id)));
$$;
revoke all on function public.dmcrm_attention_items_before_customer_links(uuid,uuid),public.dmcrm_attention_items(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.dmcrm_attention_items(uuid,uuid) to service_role;

alter function public.dmcrm_command(uuid,uuid,jsonb) rename to dmcrm_command_before_customer_links;
create function public.dmcrm_command(p_org uuid,p_actor uuid,p_command jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare typ text:=p_command->>'type';a public.dmcrm_staff%rowtype;
 src public.dmcrm_customers%rowtype;dst public.dmcrm_customers%rowtype;preferred public.dmcrm_customers%rowtype;other_c public.dmcrm_customers%rowtype;
 cust public.dmcrm_customers%rowtype;co public.dmcrm_customers%rowtype;op public.dmcrm_opportunities%rowtype;
 cid uuid;rid uuid;coid uuid;mid uuid;tbl text;payload jsonb:=p_command;link jsonb;c jsonb:=p_command->'customer';
 phone_value text;email_value text;related jsonb;
begin
 select st.* into a from public.dmcrm_staff st join public.dmcrm_members m on m.org_id=st.org_id and m.user_id=st.user_id
 where st.org_id=p_org and st.user_id=p_actor and st.active and m.active for share of st,m;
 if a.id is null then raise exception 'Active team membership required' using errcode='42501';end if;
 perform set_config('dmcrm.actor_id',p_actor::text,true);

 if typ='merge_customers' then
  if a.role not in('owner','manager') then raise exception 'Manager access required' using errcode='42501';end if;
  if p_command->>'source_id' is null or p_command->>'target_id' is null or p_command->>'source_id'=p_command->>'target_id' then raise exception 'Choose two different customer profiles.';end if;
  if p_command->'confirmed' is distinct from 'true'::jsonb or coalesce(p_command->>'details_from','') not in('source','target') then raise exception 'Confirm these profiles belong to the same person.';end if;
  -- Consistent lock ordering; all related changes and audit entries commit together.
  perform id from public.dmcrm_opportunities where org_id=p_org and (customer_id in((p_command->>'source_id')::uuid,(p_command->>'target_id')::uuid) or co_buyer_id in((p_command->>'source_id')::uuid,(p_command->>'target_id')::uuid)) order by id for update;
  perform id from public.dmcrm_customers where org_id=p_org and id in((p_command->>'source_id')::uuid,(p_command->>'target_id')::uuid) order by id for update;
  select * into src from public.dmcrm_customers where org_id=p_org and id=(p_command->>'source_id')::uuid;
  select * into dst from public.dmcrm_customers where org_id=p_org and id=(p_command->>'target_id')::uuid;
  if src.id is null or dst.id is null or dst.merged_into is not null then raise exception 'Customer profiles changed. Refresh and review the merge again.';end if;
  if src.merged_into=dst.id then return dst.id;end if;
  if src.merged_into is not null or src.updated_at is distinct from (p_command->>'source_updated_at')::timestamptz or dst.updated_at is distinct from (p_command->>'target_updated_at')::timestamptz then raise exception 'Customer profiles changed. Refresh and review the merge again.';end if;
  if exists(select 1 from public.dmcrm_visits where org_id=p_org and customer_id=src.id and departed_at is null)
   and exists(select 1 from public.dmcrm_visits where org_id=p_org and customer_id=dst.id and departed_at is null) then raise exception 'Check one profile out of the showroom before merging two active visits.';end if;
  if src.co_buyer_id=dst.id or dst.co_buyer_id=src.id or exists(select 1 from public.dmcrm_opportunities where org_id=p_org and ((customer_id=src.id and co_buyer_id=dst.id) or (customer_id=dst.id and co_buyer_id=src.id))) then raise exception 'Remove the co-buyer link between these profiles before merging them.';end if;

  related:=jsonb_build_object(
   'preferences',(select coalesce(jsonb_agg(to_jsonb(b)),'[]') from public.dmcrm_buyer_preferences b where org_id=p_org and id in(src.id,dst.id)),
   'pauses',(select coalesce(jsonb_agg(to_jsonb(p)),'[]') from public.dmcrm_workflow_pauses p where org_id=p_org and customer_id in(src.id,dst.id)));
  insert into public.dmcrm_customer_merges(org_id,source_id,target_id,actor,actor_name,details_from,before_source,before_target,related_before)
   values(p_org,src.id,dst.id,p_actor,a.name,p_command->>'details_from',to_jsonb(src),to_jsonb(dst),related) returning id into mid;
  if p_command->>'details_from'='source' then preferred:=src;other_c:=dst;else preferred:=dst;other_c:=src;end if;
  phone_value:=coalesce(nullif(preferred.phone,''),other_c.phone);
  email_value:=coalesce(nullif(preferred.email,''),other_c.email);
  update public.dmcrm_customers set name=preferred.name,phone=phone_value,email=email_value,
   person=public.dmcrm_customer_person(preferred)||jsonb_build_object('phone',phone_value,'email',email_value),
   source=coalesce(nullif(preferred.source,''),other_c.source),birthday=coalesce(preferred.birthday,other_c.birthday),
   insurance=coalesce(preferred.insurance,other_c.insurance),email_opt_out=src.email_opt_out or dst.email_opt_out,updated_at=now()
   where org_id=p_org and id=dst.id;
  select * into dst from public.dmcrm_customers where org_id=p_org and id=dst.id;

  set constraints all deferred;
  update public.dmcrm_opportunities set customer_id=dst.id,updated_at=now() where org_id=p_org and customer_id=src.id;
  foreach tbl in array array['activities','appointments','deal_files','document_uploads','facebook_contacts','facebook_messages','messages','push_jobs','quick_quote_conversions','quotes','sales','sales_events','tasks','title_cases','trades','visits','website_intake','workflow_jobs'] loop
   execute format('update public.%I set customer_id=$1 where org_id=$2 and customer_id=$3','dmcrm_'||tbl) using dst.id,p_org,src.id;
  end loop;
  -- Linking IDs move; sale snapshots, quote values, sent content, accounting,
  -- title-case names, and original document metadata are never rewritten.
  update public.dmcrm_opportunities set co_buyer_id=dst.id,updated_at=now() where org_id=p_org and co_buyer_id=src.id;
  update public.dmcrm_customers set co_buyer_id=dst.id,co_buyer=public.dmcrm_customer_person(dst),updated_at=now() where org_id=p_org and co_buyer_id=src.id;
  insert into public.dmcrm_workflow_pauses(org_id,customer_id,paused)
   select p_org,dst.id,bool_or(paused) from public.dmcrm_workflow_pauses where org_id=p_org and customer_id in(src.id,dst.id) having count(*)>0
   on conflict(org_id,customer_id) do update set paused=excluded.paused;
  if not exists(select 1 from public.dmcrm_buyer_preferences where org_id=p_org and id=dst.id) then
   update public.dmcrm_buyer_preferences set id=dst.id where org_id=p_org and id=src.id;
  end if;
  -- Reuse the canonical yearly key when possible; never resend an existing birthday.
  update public.dmcrm_workflow_jobs j set event_key=dst.id::text||substring(j.event_key from 37)
   where j.org_id=p_org and j.customer_id=dst.id and j.event='birthday' and j.event_key like src.id::text||':%'
   and not exists(select 1 from public.dmcrm_workflow_jobs other_j where other_j.rule_id=j.rule_id and other_j.event_key=dst.id::text||substring(j.event_key from 37));
  update public.dmcrm_email_outbox b set state='canceled',last_error='Duplicate birthday reminder after customer merge'
   from public.dmcrm_workflow_jobs j where j.org_id=p_org and j.customer_id=dst.id and j.event='birthday' and j.event_key like src.id::text||':%'
   and j.message_id=b.message_id and b.state='pending';
  update public.dmcrm_messages m set status='canceled',error='Duplicate birthday reminder after customer merge',updated_at=now()
   from public.dmcrm_email_outbox b where b.org_id=p_org and b.message_id=m.id and b.state='canceled' and b.last_error='Duplicate birthday reminder after customer merge' and m.status='queued';
  update public.dmcrm_workflow_jobs j set state='canceled',reason='Duplicate birthday reminder after customer merge'
   where j.org_id=p_org and j.customer_id=dst.id and j.event='birthday' and j.event_key like src.id::text||':%' and j.state in('scheduled','queued')
   and (j.message_id is null or exists(select 1 from public.dmcrm_email_outbox b where b.message_id=j.message_id and b.state='canceled'));
  -- General birthday reminders can duplicate; retain one open reminder per date.
  update public.dmcrm_tasks t set canceled_at=now() where t.id in(
   select id from (select id,row_number() over(partition by due_date order by id) rn from public.dmcrm_tasks
    where org_id=p_org and customer_id=dst.id and opportunity_id is null and kind='birthday' and completed_at is null and canceled_at is null) b where rn>1);
  update public.dmcrm_customers set merged_into=dst.id,updated_at=now() where org_id=p_org and (id=src.id or merged_into=src.id);
  set constraints all immediate;
  insert into public.dmcrm_activities(org_id,customer_id,kind,body,created_by)
   values(p_org,dst.id,'system','Merged duplicate customer profile: '||src.name||'. All deals, correspondence, tasks, appointments, and files retained. Original sold paperwork preserved. Merge reference: '||mid::text,a.name);
  insert into public.dmcrm_audit(org_id,actor,action,record_id) values(p_org,p_actor,'merge_customers',mid);
  return dst.id;
 end if;

 if typ='set_co_buyer' then
  select * into op from public.dmcrm_opportunities where org_id=p_org and id=(p_command->>'opportunity_id')::uuid for update;
  if op.id is null then raise exception 'Opportunity unavailable' using errcode='42501';end if;
  if a.role not in('owner','manager') and op.assigned_to is distinct from a.id then raise exception 'Assigned salesperson or manager required' using errcode='42501';end if;
  if op.status in('sold','lost') then raise exception 'Closed deals keep their original co-buyer.';end if;
  if op.updated_at is distinct from (p_command->>'expected_updated_at')::timestamptz then raise exception 'Deal changed. Refresh before changing the co-buyer.';end if;
  coid:=public.dmcrm_link_co_buyer(p_org,a.id,p_command->'link');
  if coid=op.customer_id then raise exception 'A customer cannot be their own co-buyer.';end if;
  select * into co from public.dmcrm_customers where org_id=p_org and id=coid;
  update public.dmcrm_opportunities set co_buyer_id=coid,co_buyer=case when coid is null then null else public.dmcrm_customer_person(co) end,updated_at=now() where org_id=p_org and id=op.id;
  insert into public.dmcrm_activities(org_id,customer_id,opportunity_id,kind,body,created_by)
   values(p_org,op.customer_id,op.id,'system',case when coid is null then 'Co-buyer removed from this opportunity; customer profile retained' else 'Co-buyer linked: '||co.name end,a.name);
  insert into public.dmcrm_audit(org_id,actor,action,record_id) values(p_org,p_actor,'set_co_buyer',op.id);
  return op.id;
 end if;

 if p_command->>'customer_id' is not null then
  cid:=public.dmcrm_resolve_customer(p_org,(p_command->>'customer_id')::uuid);
  payload:=jsonb_set(payload,'{customer_id}',to_jsonb(cid));
 end if;
 if typ in('create_customer','update_customer') then
  if typ='update_customer' then
   select * into cust from public.dmcrm_customers where org_id=p_org and id=(p_command->>'id')::uuid for update;
   if cust.merged_into is not null then raise exception 'This customer was merged. Refresh to open the kept profile.';end if;
   if cust.id is null then raise exception 'Customer unavailable' using errcode='42501';end if;
  end if;
  if c ? 'co_buyer_link' then link:=c->'co_buyer_link';
  elsif c ? 'co_buyer' and c->'co_buyer' is distinct from coalesce(cust.co_buyer,'null'::jsonb) then
   link:=case when nullif(c->'co_buyer','null') is null then jsonb_build_object('mode','none') else jsonb_build_object('mode','new','person',c->'co_buyer') end;
  end if;
  if link is not null then
   coid:=public.dmcrm_link_co_buyer(p_org,a.id,link);
   if coid=cust.id then raise exception 'A customer cannot be their own co-buyer.';end if;
   select * into co from public.dmcrm_customers where org_id=p_org and id=coid;
   payload:=jsonb_set(payload,'{customer,co_buyer}',case when coid is null then 'null'::jsonb else public.dmcrm_customer_person(co) end);
  end if;
  rid:=public.dmcrm_command_before_customer_links(p_org,p_actor,payload);
  if link is not null then
   update public.dmcrm_customers set co_buyer_id=coid where org_id=p_org and id=rid;
   if typ='create_customer' then
    update public.dmcrm_opportunities set co_buyer_id=coid where org_id=p_org and customer_id=rid;
   end if;
  end if;
  return rid;
 end if;
 return public.dmcrm_command_before_customer_links(p_org,p_actor,payload);
end $$;
revoke all on function public.dmcrm_resolve_customer(uuid,uuid),public.dmcrm_customer_person(public.dmcrm_customers),public.dmcrm_customer_reference(),public.dmcrm_opportunity_co_buyer(),public.dmcrm_refresh_co_buyer(),public.dmcrm_quote_co_buyer(),public.dmcrm_link_co_buyer(uuid,uuid,jsonb),public.dmcrm_command_before_customer_links(uuid,uuid,jsonb),public.dmcrm_command(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.dmcrm_command(uuid,uuid,jsonb) to service_role;
