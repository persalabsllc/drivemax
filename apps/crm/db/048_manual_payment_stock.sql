alter table public.dmcrm_card_payments
  alter column inventory_id drop not null,
  add constraint dmcrm_manual_card_payment_stock check (
    inventory_id is not null or
    (length(btrim(stock_number)) between 1 and 250 and length(vehicle_name) <= 160)
  );

create or replace function public.dmcrm_reserve_card_payment(p_org uuid,p_actor uuid,p_data jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  employee public.dmcrm_staff%rowtype;
  payment public.dmcrm_card_payments%rowtype;
  payment_id uuid := (p_data->>'id')::uuid;
  inventory_id uuid := (p_data->>'inventory_id')::uuid;
  amount integer := (p_data->>'amount_cents')::integer;
  payer text := btrim(p_data->>'payer_name');
  purpose text := btrim(p_data->>'purpose');
  stock text;
  vehicle_label text;
begin
  select s.* into employee from public.dmcrm_staff s
    join public.dmcrm_members m on m.org_id=s.org_id and m.user_id=s.user_id and m.role=s.role
    where s.org_id=p_org and s.user_id=p_actor and m.active and s.active
      and s.role in ('owner','manager','finance','sales') for share of s,m;
  if employee.id is null or employee.id is distinct from (p_data->>'employee_id')::uuid then
    raise exception 'payment_employee_denied';
  end if;
  if inventory_id is null then
    stock := regexp_replace(p_data->>'manual_stock_number','^[[:space:]]+|[[:space:]]+$','','g');
    vehicle_label := regexp_replace(coalesce(p_data->>'manual_vehicle_name',''),'^[[:space:]]+|[[:space:]]+$','','g');
    if jsonb_typeof(p_data->'manual_stock_number') is distinct from 'string'
      or length(stock) not between 1 and 250
      or (p_data ? 'manual_vehicle_name' and jsonb_typeof(p_data->'manual_vehicle_name') is distinct from 'string')
      or length(vehicle_label) > 160 then
      raise exception 'payment_manual_stock_invalid';
    end if;
  end if;
  perform pg_advisory_xact_lock(hashtextextended(payment_id::text,4701));
  select * into payment from public.dmcrm_card_payments p where p.id=payment_id;
  if found then
    if (payment.org_id,payment.employee_id,payment.inventory_id,payment.amount_cents,payment.payer_name,payment.purpose)
       is distinct from (p_org,employee.id,inventory_id,amount,payer,purpose)
       or (inventory_id is null and (payment.stock_number,payment.vehicle_name) is distinct from (stock,vehicle_label)) then
      raise exception 'payment_retry_conflict';
    end if;
    return to_jsonb(payment);
  end if;
  if inventory_id is not null then
    select v.stock_number, concat_ws(' ',v.year,v.make,v.model,nullif(v.trim,'')) into stock,vehicle_label
      from public.dmcrm_inventory v where v.org_id=p_org and v.id=inventory_id and v.deleted_at is null for share;
    if not found then raise exception 'payment_inventory_missing'; end if;
  end if;
  insert into public.dmcrm_card_payments(id,org_id,inventory_id,stock_number,vehicle_name,
    employee_id,employee_name,payer_name,purpose,amount_cents)
    values(payment_id,p_org,inventory_id,stock,vehicle_label,employee.id,employee.name,payer,purpose,amount)
    returning * into payment;
  return to_jsonb(payment);
end $$;
