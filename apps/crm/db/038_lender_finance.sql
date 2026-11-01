-- Internal financing terms live with each saved payment option. Existing
-- quotes, sale snapshots and accounting entries are deliberately not backfilled.
create function public.dmcrm_lender_terms(f jsonb) returns jsonb
language plpgsql immutable set search_path='' as $$
declare k text;n numeric;
begin
 if jsonb_typeof(f) is distinct from 'object' or jsonb_typeof(f->'lender') is distinct from 'string'
  or length(f->>'lender')>250 then raise exception 'Review the lender details.';end if;
 foreach k in array array['buyRate','payoutPercent','reserveOverride','lenderFees'] loop
  if k in('buyRate','reserveOverride') and f->k='null'::jsonb then continue;end if;
  if jsonb_typeof(f->k) is distinct from 'number' then raise exception 'Review the lender rates, payout and fees.';end if;
  n:=(f->>k)::numeric;
  if k='payoutPercent' and round(n,2)<>n then raise exception 'Use at most two decimal places for payout percent.';end if;
  if n<0 or n>(case k when 'buyRate' then 50 when 'payoutPercent' then 100 else 1000000 end) then
   raise exception 'Review the lender rates, payout and fees.';
  end if;
 end loop;
 return jsonb_build_object('lender',trim(f->>'lender'),'buyRate',f->'buyRate','payoutPercent',f->'payoutPercent',
  'reserveOverride',case when f->>'reserveOverride' is null then null else round((f->>'reserveOverride')::numeric,2) end,
  'lenderFees',round((f->>'lenderFees')::numeric,2));
end $$;

create function public.dmcrm_lender_values(v jsonb) returns jsonb
language plpgsql immutable set search_path='' as $$
declare options jsonb:=v->'financeOptions';item jsonb;items jsonb:='[]';f jsonb;idx integer;has_terms boolean:=v ? 'lenderFinance';
begin
 if has_terms then v:=jsonb_set(v,'{lenderFinance}',public.dmcrm_lender_terms(v->'lenderFinance'));end if;
 if jsonb_typeof(options)='array' then
  for item in select value from jsonb_array_elements(options) loop
   if item ? 'lenderFinance' then
    item:=jsonb_set(item,'{lenderFinance}',public.dmcrm_lender_terms(item->'lenderFinance'));has_terms:=true;
   end if;
   items:=items||jsonb_build_array(item);
  end loop;
  if has_terms then
   if jsonb_array_length(items)<>3 or (v ? 'selectedOption' and (jsonb_typeof(v->'selectedOption')<>'number' or v->>'selectedOption' not in('0','1','2'))) then
    raise exception 'Select a valid financing option.';end if;
   idx:=coalesce((v->>'selectedOption')::integer,2);
   item:=items->idx;
   if jsonb_typeof(item->'apr') is distinct from 'number' or (item->>'apr')::numeric not between 0 and 50
    or jsonb_typeof(item->'months') is distinct from 'number' or (item->>'months')::numeric not between 1 and 120
    or trunc((item->>'months')::numeric)<>(item->>'months')::numeric then raise exception 'Review the selected rate and term.';end if;
   -- Never accept a reserve based on a different row than the customer quote.
   v:=jsonb_set(v,'{financeOptions}',items)-'lenderFinance';
   if item ? 'lenderFinance' then v:=jsonb_set(v,'{lenderFinance}',item->'lenderFinance');end if;
   v:=v||jsonb_build_object('months',item->'months','apr',case when v->>'mode'='cash' then '0'::jsonb else item->'apr' end);
  end if;
 end if;
 if has_terms and v ? 'lenderFinance' then
  if jsonb_typeof(v->'apr') is distinct from 'number' or (v->>'apr')::numeric not between 0 and 50
   or jsonb_typeof(v->'months') is distinct from 'number' or (v->>'months')::numeric not between 1 and 120
   or trunc((v->>'months')::numeric)<>(v->>'months')::numeric
   or (v ? 'daysToFirstPayment' and (jsonb_typeof(v->'daysToFirstPayment')<>'number' or (v->>'daysToFirstPayment')::numeric not between 30 and 365)) then
   raise exception 'Review the financing rate, term and first payment date.';end if;
 end if;
 return v;
end $$;

create function public.dmcrm_lender_payment(principal numeric,apr numeric,months integer,days integer) returns numeric
language plpgsql immutable set search_path='' as $$
declare adjusted numeric:=greatest(principal,0)+round(greatest(principal,0)*apr/100*greatest(days-30,0)/365,2);r numeric:=apr/1200;
begin
 if adjusted<=0 then return 0;end if;
 if r=0 then return round(adjusted/months,2);end if;
 return round(adjusted*r/(1-power(1+r,-months)),2);
end $$;

create function public.dmcrm_lender_accounting(v jsonb) returns jsonb
language plpgsql immutable set search_path='' as $$
declare f jsonb;tax numeric;products numeric;balance numeric;buy_payment numeric;sell_payment numeric;reserve numeric;days integer;
begin
 v:=public.dmcrm_lender_values(v);f:=v->'lenderFinance';
 if f is null or v->>'mode'='cash' then return '{}'::jsonb;end if;
 tax:=case when v->>'taxMode'='auto' then round(greatest(0,(v->>'price')::numeric+(v->>'docFee')::numeric+coalesce((v->>'addOns')::numeric,0)-(v->>'tradeAllowance')::numeric)*0.03,2) else (v->>'tax')::numeric end;
 if jsonb_typeof(v->'products')='array' then
  select round(coalesce(sum((p->>'price')::numeric),0),2) into products from jsonb_array_elements(v->'products') p;
 else products:=coalesce((v->>'serviceContract')::numeric,0);end if;
 balance:=round(round((v->>'price')::numeric+(v->>'docFee')::numeric+coalesce((v->>'addOns')::numeric,0)+products+
  coalesce((v->>'otherTaxes')::numeric,0)+tax+(v->>'titleFee')::numeric-(v->>'tradeAllowance')::numeric+(v->>'payoff')::numeric,2)-(v->>'downPayment')::numeric,2);
 days:=coalesce((v->>'daysToFirstPayment')::integer,30);
 if f->>'reserveOverride' is not null then reserve:=(f->>'reserveOverride')::numeric;
 elsif f->>'buyRate' is null then reserve:=0;
 else
  buy_payment:=public.dmcrm_lender_payment(balance,(f->>'buyRate')::numeric,(v->>'months')::integer,days);
  sell_payment:=public.dmcrm_lender_payment(balance,(v->>'apr')::numeric,(v->>'months')::integer,days);
  reserve:=round(greatest(0,(sell_payment-buy_payment)*(v->>'months')::integer*(f->>'payoutPercent')::numeric/100),2);
 end if;
 if reserve is null or reserve>1000000 then raise exception 'Review the reserve amount.';end if;
 return jsonb_build_object('lender',f->'lender','buy_rate',f->'buyRate','finance_reserve',reserve,'lender_fees',f->'lenderFees',
  'finance_reserve_source',case when f->>'reserveOverride' is null then 'estimate' else 'confirmed' end);
end $$;

create function public.dmcrm_quote_lender_finance() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 new.values:=public.dmcrm_lender_values(new.values);
 perform public.dmcrm_lender_accounting(new.values);
 return new;
end $$;
create trigger dmcrm_quote_lender_finance before insert or update of values on public.dmcrm_quotes
 for each row execute function public.dmcrm_quote_lender_finance();

-- BEFORE insert makes reserve/fees available to the existing AFTER-insert
-- commission trigger. Later quote edits and new lender estimates cannot rewrite it.
create function public.dmcrm_sale_lender_finance() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if tg_op='INSERT' then
  new.accounting:=new.accounting||public.dmcrm_lender_accounting(new.snapshot#>'{quote,values}');
 end if;
 if new.accounting ? 'lender_fees' and (jsonb_typeof(new.accounting->'lender_fees') is distinct from 'number'
  or (new.accounting->>'lender_fees')::numeric not between 0 and 1000000) then raise exception 'Review lender fees.';end if;
 if new.accounting ? 'finance_reserve_source' and (jsonb_typeof(new.accounting->'finance_reserve_source') is distinct from 'string'
  or new.accounting->>'finance_reserve_source' not in('estimate','confirmed','manual')) then raise exception 'Review reserve status.';end if;
 return new;
end $$;
create trigger dmcrm_sale_lender_finance before insert or update of accounting on public.dmcrm_sales
 for each row execute function public.dmcrm_sale_lender_finance();

-- Fees reduce the front commission basis too. No historical commissions change.
do $$ declare src text;needle text:='-coalesce((a->>''other_cost'')::numeric,0)';begin
 select pg_get_functiondef('public.dmcrm_default_commission(jsonb,text)'::regprocedure) into src;
 if strpos(src,needle)=0 then raise exception 'Front commission formula missing';end if;
 execute replace(src,needle,needle||'-coalesce((a->>''lender_fees'')::numeric,0)');
end $$;

revoke all on function public.dmcrm_lender_terms(jsonb),public.dmcrm_lender_values(jsonb),
 public.dmcrm_lender_payment(numeric,numeric,integer,integer),public.dmcrm_lender_accounting(jsonb),
 public.dmcrm_quote_lender_finance(),public.dmcrm_sale_lender_finance() from public,anon,authenticated,service_role;
