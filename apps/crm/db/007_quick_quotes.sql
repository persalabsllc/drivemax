-- Anonymous calculations are never stored. A row exists only after the user
-- explicitly creates a customer and saves the quote, in one transaction.
create table public.dmcrm_quick_quote_conversions (
 id uuid primary key,
 org_id uuid not null references public.dmcrm_orgs(id),
 actor uuid not null references auth.users(id),
 customer_id uuid not null,
 opportunity_id uuid not null,
 quote_id uuid not null references public.dmcrm_quotes(id),
 created_at timestamptz not null default now(),
 foreign key(org_id,customer_id) references public.dmcrm_customers(org_id,id),
 foreign key(org_id,opportunity_id) references public.dmcrm_opportunities(org_id,id)
);
alter table public.dmcrm_quick_quote_conversions enable row level security;
revoke all on public.dmcrm_quick_quote_conversions from public,anon,authenticated;
grant all on public.dmcrm_quick_quote_conversions to service_role;

alter function public.dmcrm_command(uuid,uuid,jsonb) rename to dmcrm_command_v6;
revoke all on function public.dmcrm_command_v6(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
create function public.dmcrm_command(p_org uuid,p_actor uuid,p_command jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare actor public.dmcrm_staff%rowtype; prior public.dmcrm_quick_quote_conversions%rowtype;
 rid uuid; cid uuid; oid uuid; qid uuid; q jsonb:=p_command->'quote'; vals jsonb;
 label text; trade_label text; closed_op public.dmcrm_opportunities%rowtype;
begin
 if p_command->>'type' is distinct from 'convert_quick_quote' then
  rid:=public.dmcrm_command_v6(p_org,p_actor,p_command);
  if p_command->>'type'='mark_sold' or (p_command->>'type'='close_opportunity' and p_command->>'outcome'='sold') then
   select o.* into closed_op from public.dmcrm_opportunities o join public.dmcrm_quick_quote_conversions c on c.org_id=o.org_id and c.opportunity_id=o.id
    where o.org_id=p_org and o.id=rid;
   vals:=closed_op.sale_snapshot->'quote'->'values';
   -- An estimate can omit trade identity, but a completed sale must be able to
   -- intake the trade. Raising here rolls back the entire sold transition.
   if closed_op.id is not null and closed_op.trade is null and (closed_op.trade_vehicle<>'' or
    coalesce((vals->>'tradeAllowance')::numeric,0)>0 or coalesce((vals->>'payoff')::numeric,0)>0 or
    coalesce((vals->>'acv')::numeric,0)>0 or coalesce((vals->>'recon')::numeric,0)>0) then
    raise exception 'Complete the trade vehicle details or remove the trade before marking this deal sold.';
   end if;
  end if;
  return rid;
 end if;
 select s.* into actor from public.dmcrm_staff s join public.dmcrm_members m on m.org_id=s.org_id and m.user_id=s.user_id
  where s.org_id=p_org and s.user_id=p_actor and s.active and m.active for share of s,m;
 if actor.id is null then raise exception 'CRM membership required' using errcode='42501';end if;
 rid:=(p_command->>'id')::uuid;
 if rid is null then raise exception 'Conversion key required';end if;
 -- A retry after a lost response must reopen the same customer, not create another.
 perform pg_advisory_xact_lock(hashtextextended('dmcrm:quick-quote:'||rid::text,0));
 select * into prior from public.dmcrm_quick_quote_conversions where id=rid;
 if prior.id is not null then
  if prior.org_id<>p_org or prior.actor<>p_actor then raise exception 'Quote conversion unavailable' using errcode='42501';end if;
  return prior.customer_id;
 end if;
 vals:=q->'values';
 if jsonb_typeof(vals) is distinct from 'object' then raise exception 'Quote figures required';end if;
 label:=coalesce(nullif(trim(q->>'vehicle'),''),'Vehicle to be selected');
 trade_label:=case when coalesce((vals->>'tradeAllowance')::numeric,0)>0 or coalesce((vals->>'payoff')::numeric,0)>0
  or coalesce((vals->>'acv')::numeric,0)>0 or coalesce((vals->>'recon')::numeric,0)>0 then 'Trade details pending' else '' end;
 cid:=public.dmcrm_command_v6(p_org,p_actor,jsonb_build_object('type','create_customer',
  'customer',(p_command->'customer')||jsonb_build_object('initial_opportunity',false)));
 -- The existing opportunity command locks and checks the inventory vehicle,
 -- reads its canonical description/cost/VIN, and assigns the acting salesperson.
 oid:=public.dmcrm_command_v6(p_org,p_actor,jsonb_build_object('type','create_opportunity','customer_id',cid,
  'opportunity',jsonb_build_object('title',label,'source',p_command->'customer'->>'source','status','working',
   'inventory_id',q->'inventory_id','vehicle_interest',label,'vehicle_details',null,'trade_vehicle',trade_label,'trade',null)));
 select vehicle_interest into label from public.dmcrm_opportunities where org_id=p_org and id=oid;
 update public.dmcrm_opportunities set title=label where org_id=p_org and id=oid;
 qid:=public.dmcrm_command_v6(p_org,p_actor,jsonb_build_object('type','save_quote','customer_id',cid,'opportunity_id',oid,
  'vehicle',label,'values',vals));
 insert into public.dmcrm_quick_quote_conversions(id,org_id,actor,customer_id,opportunity_id,quote_id) values(rid,p_org,p_actor,cid,oid,qid);
 insert into public.dmcrm_activities(org_id,customer_id,opportunity_id,kind,body,created_by)
  values(p_org,cid,oid,'system','Quick quote saved to new customer profile',actor.name);
 insert into public.dmcrm_audit(org_id,actor,action,record_id) values(p_org,p_actor,'convert_quick_quote',rid);
 return cid;
end $$;
revoke all on function public.dmcrm_command(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.dmcrm_command(uuid,uuid,jsonb) to service_role;
