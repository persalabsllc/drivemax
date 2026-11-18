-- Preprinted check stock only: store account labels/last four, never MICR data.
create table public.dmcrm_check_accounts (
  id uuid primary key,
  org_id uuid not null references public.dmcrm_orgs(id),
  name text not null check(length(name) between 1 and 80),
  last4 text not null default '' check(last4 ~ '^(\d{4})?$'),
  next_number integer not null check(next_number between 1 and 999999999),
  layout jsonb not null,
  revision integer not null default 1,
  created_at timestamptz not null default now(),
  unique(org_id,id)
);
create table public.dmcrm_checks (
  id uuid primary key,
  org_id uuid not null references public.dmcrm_orgs(id),
  account_id uuid not null,
  account_name text not null,
  account_last4 text not null,
  check_number integer not null check(check_number between 1 and 999999998),
  payee text not null check(length(payee) between 1 and 100),
  amount_cents integer not null check(amount_cents between 1 and 99999999),
  check_date date not null check(check_date between '2000-01-01' and '2100-12-31'),
  memo text not null default '' check(length(memo)<=120),
  address text not null default '' check(length(address)<=240),
  status text not null default 'prepared' check(status in ('prepared','printed','voided')),
  revision integer not null default 1,
  pdf_count integer not null default 0,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  printed_at timestamptz,
  voided_at timestamptz,
  void_reason text not null default '',
  foreign key(org_id,account_id) references public.dmcrm_check_accounts(org_id,id),
  unique(account_id,check_number)
);
create index dmcrm_checks_register on public.dmcrm_checks(org_id,created_at desc,id);
create table public.dmcrm_check_events (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.dmcrm_orgs(id),
  account_id uuid not null references public.dmcrm_check_accounts(id),
  check_id uuid references public.dmcrm_checks(id),
  actor uuid not null,
  action text not null,
  details jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.dmcrm_check_accounts enable row level security;
alter table public.dmcrm_checks enable row level security;
alter table public.dmcrm_check_events enable row level security;
revoke all on public.dmcrm_check_accounts,public.dmcrm_checks,public.dmcrm_check_events from public,anon,authenticated;
grant select on public.dmcrm_check_accounts,public.dmcrm_checks,public.dmcrm_check_events to service_role;

create function public.dmcrm_check_command(p_org uuid,p_actor uuid,p_data jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  act text:=p_data->>'action';
  a public.dmcrm_check_accounts%rowtype;
  c public.dmcrm_checks%rowtype;
  old_row jsonb;
  details jsonb:=p_data->'details';
  rid uuid:=(p_data->>'id')::uuid;
  v_layout jsonb:=p_data->'layout';
  f text;
  xy text;
  v numeric;
begin
  if not exists(select 1 from dmcrm_members m join dmcrm_staff s on s.org_id=m.org_id and s.user_id=m.user_id
    where m.org_id=p_org and m.user_id=p_actor and m.active and s.active and m.role='owner' and s.role='owner') then
    raise exception 'check_owner_required';
  end if;
  if rid is null then raise exception 'check_invalid'; end if;
  if act='save_account' then
    if coalesce(length(btrim(p_data->>'name')),0) not between 1 and 80
      or coalesce(p_data->>'last4','') !~ '^(\d{4})?$'
      or (p_data->>'next_number')::integer not between 1 and 999999998
      or not (p_data ? 'next_number') or jsonb_typeof(v_layout) is distinct from 'object' then raise exception 'check_invalid'; end if;
    foreach f in array array['global','date','payee','amount','words','address','memo'] loop
      foreach xy in array array['x','y'] loop
        v:=case when f='global' then (v_layout->>xy)::numeric else (v_layout->'fields'->f->>xy)::numeric end;
        if v is null or v not between -18 and 18 then raise exception 'check_invalid'; end if;
      end loop;
    end loop;
    -- Serialize new-account retries as well as later changes.
    perform pg_advisory_xact_lock(hashtextextended(rid::text,441));
    select * into a from dmcrm_check_accounts where id=rid for update;
    if found then
      if a.org_id<>p_org then raise exception 'check_account_missing'; end if;
      if a.revision is distinct from (p_data->>'revision')::integer then raise exception 'check_stale'; end if;
      if (p_data->>'next_number')::integer<a.next_number then raise exception 'check_number_used'; end if;
      old_row:=to_jsonb(a);
      update dmcrm_check_accounts set name=btrim(p_data->>'name'),last4=coalesce(p_data->>'last4',''),
        next_number=(p_data->>'next_number')::integer,layout=v_layout,revision=revision+1 where id=a.id returning * into a;
    else
      if (p_data->>'revision')::integer is distinct from 0 then raise exception 'check_stale'; end if;
      insert into dmcrm_check_accounts(id,org_id,name,last4,next_number,layout)
        values(rid,p_org,btrim(p_data->>'name'),coalesce(p_data->>'last4',''),(p_data->>'next_number')::integer,v_layout) returning * into a;
    end if;
    insert into dmcrm_check_events(org_id,account_id,actor,action,details)
      values(p_org,a.id,p_actor,act,jsonb_build_object('before',old_row,'after',to_jsonb(a)));
    return to_jsonb(a);
  elsif act='create' then
    perform pg_advisory_xact_lock(hashtextextended(rid::text,442));
    select * into c from dmcrm_checks where id=rid;
    if found then
      if c.org_id<>p_org then raise exception 'check_missing'; end if;
      if c.account_id is distinct from (p_data->>'account_id')::uuid or c.check_number is distinct from (p_data->>'check_number')::integer
        or c.payee is distinct from details->>'payee' or c.amount_cents is distinct from (details->>'amount_cents')::integer
        or c.check_date is distinct from (details->>'check_date')::date or c.memo is distinct from details->>'memo' or c.address is distinct from details->>'address'
        then raise exception 'check_retry_conflict'; end if;
      return to_jsonb(c);
    end if;
    select * into a from dmcrm_check_accounts where id=(p_data->>'account_id')::uuid and org_id=p_org for update;
    if not found then raise exception 'check_account_missing'; end if;
    if a.next_number is distinct from (p_data->>'check_number')::integer then raise exception 'check_number_changed'; end if;
    insert into dmcrm_checks(id,org_id,account_id,account_name,account_last4,check_number,payee,amount_cents,check_date,memo,address,created_by)
      values(rid,p_org,a.id,a.name,a.last4,a.next_number,btrim(details->>'payee'),(details->>'amount_cents')::integer,
        (details->>'check_date')::date,details->>'memo',details->>'address',p_actor) returning * into c;
    update dmcrm_check_accounts set next_number=next_number+1,revision=revision+1 where id=a.id;
    insert into dmcrm_check_events(org_id,account_id,check_id,actor,action,details)
      values(p_org,a.id,c.id,p_actor,act,to_jsonb(c));
    return to_jsonb(c);
  elsif act in ('pdf','mark_printed','void') then
    select * into c from dmcrm_checks where id=rid and org_id=p_org for update;
    if not found then raise exception 'check_missing'; end if;
    if c.revision is distinct from (p_data->>'revision')::integer then raise exception 'check_stale'; end if;
    if c.status='voided' then raise exception 'check_voided'; end if;
    old_row:=to_jsonb(c);
    if act='pdf' then
      if (p_data->>'stock_confirmed')::boolean is distinct from true then raise exception 'check_invalid'; end if;
      if c.pdf_count>0 and coalesce(length(btrim(p_data->>'reason')),0)<3 then raise exception 'check_reprint_reason'; end if;
      update dmcrm_checks set pdf_count=pdf_count+1,revision=revision+1 where id=c.id returning * into c;
    elsif act='mark_printed' then
      if c.pdf_count=0 then raise exception 'check_pdf_required'; end if;
      if c.status='printed' then return to_jsonb(c); end if;
      update dmcrm_checks set status='printed',printed_at=now(),revision=revision+1 where id=c.id returning * into c;
    else
      if coalesce(length(btrim(p_data->>'reason')),0) not between 3 and 240 then raise exception 'check_invalid'; end if;
      update dmcrm_checks set status='voided',voided_at=now(),void_reason=btrim(p_data->>'reason'),revision=revision+1 where id=c.id returning * into c;
    end if;
    insert into dmcrm_check_events(org_id,account_id,check_id,actor,action,details)
      values(p_org,c.account_id,c.id,p_actor,act,jsonb_build_object('before',old_row,'after',to_jsonb(c),'reason',p_data->>'reason'));
    return to_jsonb(c);
  end if;
  raise exception 'check_invalid';
end $$;
revoke all on function public.dmcrm_check_command(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.dmcrm_check_command(uuid,uuid,jsonb) to service_role;
