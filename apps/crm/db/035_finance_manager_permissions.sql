-- Finance can work deals and protection products without dealership administration.
alter table public.dmcrm_members drop constraint dmcrm_members_role_check;
alter table public.dmcrm_members add constraint dmcrm_members_role_check check(role in('owner','manager','finance','sales'));
alter table public.dmcrm_staff drop constraint dmcrm_staff_role_check;
alter table public.dmcrm_staff add constraint dmcrm_staff_role_check check(role in('owner','manager','finance','sales'));

-- Change only the scoped protection gates and owner-controlled role validation.
-- Abort the migration if a predecessor has drifted instead of silently broadening access.
do $$ declare fn text;src text;old_text text;new_text text;begin
 foreach fn in array array['dmcrm_command_before_product_pricing','dmcrm_command'] loop
  select pg_get_functiondef(('public.'||fn||'(uuid,uuid,jsonb)')::regprocedure) into src;
  old_text:='m.role in(''owner'',''manager'')';new_text:='m.role in(''owner'',''manager'',''finance'')';
  if strpos(src,old_text)=0 then raise exception 'Protection permission gate missing: %',fn;end if;
  execute replace(src,old_text,new_text);
 end loop;
 select pg_get_functiondef('public.dmcrm_command_v4(uuid,uuid,jsonb)'::regprocedure) into src;
 old_text:='data->>''role'' not in(''manager'',''sales'')';
 if strpos(src,old_text)=0 then raise exception 'Staff role validation missing';end if;
 execute replace(replace(replace(src,old_text,'data->>''role'' not in(''manager'',''finance'',''sales'')'),
  'Only the owner can add managers','Only the owner can add managers or finance managers'),
  'Only the owner can manage managers; owner access is protected','Only the owner can manage managers or finance managers; owner access is protected');
end $$;

create function public.dmcrm_role_command_allowed(p_role text,p_type text) returns boolean language sql immutable set search_path='' as $$
 select coalesce(p_role in('owner','manager') or
  (p_role in('sales','finance') and p_type in('save_profile_name','save_email_signature','set_email_opt_out','pause_customer_workflows','save_deal_progress','save_buyer_preferences','save_title_amounts','save_title_case','save_temp_tag','attach_title_document','save_appointment','set_appointment_status','review_attention','save_message','delete_message_draft','create_opportunity','update_opportunity','close_opportunity','save_insurance','save_paperwork','create_customer','update_customer','set_co_buyer','add_activity','check_in','check_out','mark_sold','create_task','complete_task')) or
  (p_role='finance' and p_type in('save_quote','convert_quick_quote','convert_quick_quote_existing','issue_protection_batch','issue_protection','cancel_protection','record_protection_claim','record_protection_refund','submit_protection_claim','update_protection_claim','pay_protection_claim','close_protection_claim')),false);
$$;
revoke all on function public.dmcrm_role_command_allowed(text,text) from public,anon,authenticated,service_role;

alter function public.dmcrm_command(uuid,uuid,jsonb) rename to dmcrm_command_before_finance_roles;
revoke all on function public.dmcrm_command_before_finance_roles(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
create function public.dmcrm_command(p_org uuid,p_actor uuid,p_command jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare actor_role text;typ text:=p_command->>'type';v jsonb;old_v jsonb;old_trade jsonb;field_name text;
begin
 select m.role into actor_role from public.dmcrm_members m join public.dmcrm_staff s on s.org_id=m.org_id and s.user_id=m.user_id and s.role=m.role
  where m.org_id=p_org and m.user_id=p_actor and m.active and s.active for share of m,s;
 if actor_role is null then raise exception 'Active team membership required' using errcode='42501';end if;
 if not public.dmcrm_role_command_allowed(actor_role,typ) or (actor_role='sales' and typ='save_message' and p_command->>'quote_id' is not null) then
  raise exception 'Manager access required for this action.' using errcode='42501';
 end if;
 -- Cost fields are absent from sales workspaces. Preserve the real values on a
 -- vehicle/trade edit, and ignore forged cost/ACV values sent by a sales client.
 if actor_role='sales' and typ in('create_customer','update_customer','create_opportunity','update_opportunity') then
  field_name:=case when typ in('create_customer','update_customer') then 'customer' else 'opportunity' end;
  v:=p_command->field_name;
  if typ='update_opportunity' then
   select vehicle_details,trade into old_v,old_trade from public.dmcrm_opportunities where org_id=p_org and id=(p_command->>'id')::uuid for update;
   if old_v->>'vin' is distinct from v->'vehicle_details'->>'vin' then old_v:=null;end if;
   if old_trade->>'vin' is distinct from v->'trade'->>'vin' then old_trade:=null;end if;
  end if;
  if jsonb_typeof(v->'vehicle_details')='object' then
   v:=jsonb_set(v,'{vehicle_details}',(v->'vehicle_details')||jsonb_build_object('cost',old_v->'cost','recon',old_v->'recon'));
  end if;
  if jsonb_typeof(v->'trade')='object' then
   v:=jsonb_set(v,'{trade}',(v->'trade')||jsonb_build_object('acv',coalesce(old_trade->'acv','0'::jsonb)));
  end if;
  p_command:=jsonb_set(p_command,array[field_name],v);
 end if;
 return public.dmcrm_command_before_finance_roles(p_org,p_actor,p_command);
end $$;
revoke all on function public.dmcrm_command(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.dmcrm_command(uuid,uuid,jsonb) to service_role;

-- Finance may file deal documents, but inventory-only files stay with management.
create or replace function public.dmcrm_document_access(p_org uuid,p_actor uuid,p_opportunity uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.dmcrm_members m join public.dmcrm_staff s on s.org_id=m.org_id and s.user_id=m.user_id and s.role=m.role
 where m.org_id=p_org and m.user_id=p_actor and m.active and s.active and (m.role in('owner','manager') or exists(select 1 from public.dmcrm_opportunities o where o.org_id=p_org and o.id=p_opportunity and (m.role='finance' or o.assigned_to=s.id))));
$$;
-- A pending upload or old quote draft cannot bypass a later role downgrade.
do $$ declare src text;old_text text;begin
 select pg_get_functiondef('public.dmcrm_complete_document(uuid,uuid,uuid,text)'::regprocedure) into src;
 old_text:='if not public.dmcrm_document_access(p_org,p_actor,u.opportunity_id) then';
 if strpos(src,old_text)=0 then raise exception 'Document completion gate missing';end if;
 execute replace(src,old_text,'if exists(select 1 from public.dmcrm_members where org_id=p_org and user_id=p_actor and role=''sales'') and u.kind not in(''insurance'',''identification'',''stipulation'') then raise exception ''Document access denied'' using errcode=''42501'';end if; '||old_text);
 select pg_get_functiondef('public.dmcrm_queue_email(uuid,uuid,uuid,integer,jsonb)'::regprocedure) into src;
 old_text:='if m.status in(''queued'',''sent'',''delivered'')';
 if strpos(src,old_text)=0 then raise exception 'Email queue permission gate missing';end if;
 execute replace(src,old_text,'if a.role=''sales'' and m.quote_id is not null then raise exception ''Desking access required'' using errcode=''42501'';end if; '||old_text);
end $$;
