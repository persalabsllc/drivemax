-- Inventory checks share the operating account's calibrated blank stock and
-- have their own check-number sequence. Full bank details are server-managed.
do $$
declare
  dealership constant uuid := 'd5a1c100-0000-4000-8000-000000000001';
  purchasing constant uuid := 'd5a1c100-0000-4000-8000-000000007677';
  owner_id uuid;
  stock_layout jsonb;
begin
  if not exists (select 1 from public.dmcrm_orgs where id=dealership)
    or exists (select 1 from public.dmcrm_check_accounts where org_id=dealership and id=purchasing) then
    return;
  end if;

  select layout into strict stock_layout from public.dmcrm_check_accounts
    where org_id=dealership and id='d5a1c100-0000-4000-8000-000000000230';
  select m.user_id into strict owner_id from public.dmcrm_members m
    join public.dmcrm_staff s on s.org_id=m.org_id and s.user_id=m.user_id
    where m.org_id=dealership and m.active and s.active and m.role='owner' and s.role='owner'
    order by m.user_id limit 1;
  perform public.dmcrm_check_command(dealership,owner_id,jsonb_build_object(
    'action','save_account','id',purchasing,'revision',0,'name','Purchasing 7677',
    'last4','7677','next_number',230,
    'layout',stock_layout || '{"stock":"blank_bottom_1002"}'::jsonb));
end $$;
