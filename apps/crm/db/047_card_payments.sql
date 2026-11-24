create table public.dmcrm_card_payments (
  id uuid primary key,
  org_id uuid not null references public.dmcrm_orgs(id),
  inventory_id uuid not null,
  stock_number text not null,
  vehicle_name text not null,
  employee_id uuid not null,
  employee_name text not null,
  payer_name text not null check(length(btrim(payer_name)) between 1 and 120),
  purpose text not null check(length(btrim(purpose)) between 1 and 160),
  amount_cents integer not null check(amount_cents between 50 and 99999999),
  stripe_intent_id text unique,
  status text not null default 'pending' check(status in ('pending','processing','paid','canceled')),
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  livemode boolean,
  card_brand text,
  card_last4 text check(card_last4 ~ '^[0-9]{4}$'),
  revision integer not null default 0,
  foreign key(org_id,inventory_id) references public.dmcrm_inventory(org_id,id),
  foreign key(org_id,employee_id) references public.dmcrm_staff(org_id,id),
  check ((status='paid') = (paid_at is not null)),
  check ((stripe_intent_id is null) = (livemode is null)),
  check (status='pending' or stripe_intent_id is not null)
);
create index dmcrm_card_payments_register on public.dmcrm_card_payments(org_id,created_at desc,id);
create index dmcrm_card_payments_employee on public.dmcrm_card_payments(org_id,employee_id,created_at desc,id);
alter table public.dmcrm_card_payments enable row level security;
revoke all on public.dmcrm_card_payments from public,anon,authenticated,service_role;
grant select on public.dmcrm_card_payments to service_role;

-- Reserve an immutable payment before requesting an intent. Parallel retries
-- must resolve to the same employee, vehicle and monetary details.
create function public.dmcrm_reserve_card_payment(p_org uuid,p_actor uuid,p_data jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  employee public.dmcrm_staff%rowtype;
  vehicle public.dmcrm_inventory%rowtype;
  payment public.dmcrm_card_payments%rowtype;
  payment_id uuid := (p_data->>'id')::uuid;
  inventory_id uuid := (p_data->>'inventory_id')::uuid;
  amount integer := (p_data->>'amount_cents')::integer;
  payer text := btrim(p_data->>'payer_name');
  purpose text := btrim(p_data->>'purpose');
begin
  select s.* into employee from public.dmcrm_staff s
    join public.dmcrm_members m on m.org_id=s.org_id and m.user_id=s.user_id and m.role=s.role
    where s.org_id=p_org and s.user_id=p_actor and m.active and s.active
      and s.role in ('owner','manager','finance','sales') for share of s,m;
  if employee.id is null or employee.id is distinct from (p_data->>'employee_id')::uuid then
    raise exception 'payment_employee_denied';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(payment_id::text,4701));
  select * into payment from public.dmcrm_card_payments p where p.id=payment_id;
  if found then
    if (payment.org_id,payment.employee_id,payment.inventory_id,payment.amount_cents,payment.payer_name,payment.purpose)
       is distinct from (p_org,employee.id,inventory_id,amount,payer,purpose) then
      raise exception 'payment_retry_conflict';
    end if;
    return to_jsonb(payment);
  end if;
  select * into vehicle from public.dmcrm_inventory v
    where v.org_id=p_org and v.id=inventory_id and v.deleted_at is null for share;
  if not found then raise exception 'payment_inventory_missing'; end if;
  insert into public.dmcrm_card_payments(id,org_id,inventory_id,stock_number,vehicle_name,
    employee_id,employee_name,payer_name,purpose,amount_cents)
    values(payment_id,p_org,vehicle.id,vehicle.stock_number,
      concat_ws(' ',vehicle.year,vehicle.make,vehicle.model,nullif(vehicle.trim,'')),
      employee.id,employee.name,payer,purpose,amount) returning * into payment;
  return to_jsonb(payment);
end $$;

-- Called exclusively by the server after binding and checking the Stripe response.
-- A later webhook or browser response cannot overwrite a terminal result.
create function public.dmcrm_sync_card_payment(p_org uuid,p_id uuid,p_revision integer,
  p_intent text,p_status text,p_live boolean,p_paid_at timestamptz,p_brand text,p_last4 text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare payment public.dmcrm_card_payments%rowtype;
begin
  select * into strict payment from public.dmcrm_card_payments p
    where p.org_id=p_org and p.id=p_id for update;
  if p_intent is null or p_intent !~ '^pi_[A-Za-z0-9]+$' or p_live is null
    or (payment.stripe_intent_id is not null and (payment.stripe_intent_id<>p_intent or payment.livemode<>p_live)) then
    raise exception 'payment_intent_mismatch';
  end if;
  if payment.status in ('paid','canceled') or
     (payment.revision<>p_revision and p_status not in ('paid','canceled')) then
    return to_jsonb(payment);
  end if;
  if (payment.stripe_intent_id,payment.status,payment.livemode,payment.paid_at,payment.card_brand,payment.card_last4)
     is distinct from (p_intent,p_status,p_live,p_paid_at,p_brand,p_last4) then
    update public.dmcrm_card_payments p set stripe_intent_id=p_intent,status=p_status,livemode=p_live,
      paid_at=p_paid_at,card_brand=p_brand,card_last4=p_last4,revision=revision+1
      where p.org_id=p_org and p.id=p_id returning * into payment;
  end if;
  return to_jsonb(payment);
end $$;
revoke all on function public.dmcrm_reserve_card_payment(uuid,uuid,jsonb),
  public.dmcrm_sync_card_payment(uuid,uuid,integer,text,text,boolean,timestamptz,text,text) from public,anon,authenticated;
grant execute on function public.dmcrm_reserve_card_payment(uuid,uuid,jsonb),
  public.dmcrm_sync_card_payment(uuid,uuid,integer,text,text,boolean,timestamptz,text,text) to service_role;
