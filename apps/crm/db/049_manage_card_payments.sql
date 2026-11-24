alter table public.dmcrm_card_payments
  drop constraint dmcrm_card_payments_status_check,
  add constraint dmcrm_card_payments_status_check check (status in ('pending','failed','processing','paid','canceled')),
  add column archived_at timestamptz,
  add column archived_by uuid,
  add column replacement_id uuid unique references public.dmcrm_card_payments(id),
  add foreign key (org_id,archived_by) references public.dmcrm_staff(org_id,id),
  add check ((archived_at is null) = (archived_by is null)),
  add check (replacement_id is null or archived_at is not null),
  add check (archived_at is null or status='canceled' or (status='pending' and stripe_intent_id is null));

-- Binding and archiving take the same row lock. An in-flight Stripe create may
-- finish after an unbound draft is archived, but it can no longer bind its
-- intent or release a client secret, including through an older app instance.
create or replace function public.dmcrm_sync_card_payment(p_org uuid,p_id uuid,p_revision integer,
  p_intent text,p_status text,p_live boolean,p_paid_at timestamptz,p_brand text,p_last4 text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare payment public.dmcrm_card_payments%rowtype;
begin
  select * into strict payment from public.dmcrm_card_payments p
    where p.org_id=p_org and p.id=p_id for update;
  if payment.archived_at is not null then raise exception 'payment_archived'; end if;
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

-- The server verifies a bound intent has been canceled by Stripe. A change
-- snapshots the original details into one replacement in the same transaction.
create function public.dmcrm_manage_card_payment(p_org uuid,p_actor uuid,p_id uuid,p_intent text,
  p_replacement uuid,p_amount integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  employee public.dmcrm_staff%rowtype;
  payment public.dmcrm_card_payments%rowtype;
  replacement public.dmcrm_card_payments%rowtype;
begin
  select s.* into employee from public.dmcrm_staff s
    join public.dmcrm_members m on m.org_id=s.org_id and m.user_id=s.user_id and m.role=s.role
    where s.org_id=p_org and s.user_id=p_actor and s.active and m.active
      and s.role in ('owner','manager','sales','finance') for share of s,m;
  if not found then raise exception 'payment_employee_denied'; end if;
  select * into payment from public.dmcrm_card_payments p where p.org_id=p_org and p.id=p_id for update;
  if not found then raise exception 'payment_missing'; end if;
  if employee.id<>payment.employee_id and employee.role not in ('owner','manager') then
    raise exception 'payment_employee_denied';
  end if;
  if (p_replacement is null) <> (p_amount is null) or p_amount not between 50 and 99999999
    or p_id=p_replacement or p_amount=payment.amount_cents then
    raise exception 'payment_invalid_change';
  end if;
  if payment.archived_at is not null then
    if payment.replacement_id is distinct from p_replacement then raise exception 'payment_retry_conflict'; end if;
    if p_replacement is null then return to_jsonb(payment); end if;
    select * into replacement from public.dmcrm_card_payments p
      where p.org_id=p_org and p.id=p_replacement and p.amount_cents=p_amount and p.archived_at is null;
    if not found then raise exception 'payment_retry_conflict'; end if;
    return to_jsonb(replacement);
  end if;
  if payment.stripe_intent_id is distinct from p_intent then raise exception 'payment_binding_changed'; end if;
  if (p_intent is null and payment.status<>'pending') or (p_intent is not null and payment.status<>'canceled') then
    raise exception 'payment_not_editable';
  end if;
  if p_replacement is not null then
    insert into public.dmcrm_card_payments(id,org_id,inventory_id,stock_number,vehicle_name,
      employee_id,employee_name,payer_name,purpose,amount_cents,created_at)
    values(p_replacement,p_org,payment.inventory_id,payment.stock_number,payment.vehicle_name,
      payment.employee_id,payment.employee_name,payment.payer_name,payment.purpose,p_amount,payment.created_at)
    on conflict (id) do nothing returning * into replacement;
    if not found then raise exception 'payment_retry_conflict'; end if;
  end if;
  update public.dmcrm_card_payments set archived_at=now(),archived_by=employee.id,
    replacement_id=p_replacement,revision=revision+1 where id=p_id returning * into payment;
  if p_replacement is not null then return to_jsonb(replacement); end if;
  return to_jsonb(payment);
end $$;
revoke all on function public.dmcrm_manage_card_payment(uuid,uuid,uuid,text,uuid,integer) from public,anon,authenticated;
grant execute on function public.dmcrm_manage_card_payment(uuid,uuid,uuid,text,uuid,integer) to service_role;
