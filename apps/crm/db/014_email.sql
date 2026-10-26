-- One durable outbox shared by the CRM and the website's existing email transport.
-- Browser roles never receive provider credentials, reply tokens or queued attachments.
create table public.dmcrm_email_templates (
 id uuid primary key default gen_random_uuid(),org_id uuid not null references public.dmcrm_orgs(id),
 name text not null check(length(name) between 1 and 100),category text not null,
 subject text not null check(length(subject) between 1 and 250 and subject !~ E'[\r\n]'),
 body text not null check(length(body) between 1 and 12000),system_key text,
 revision integer not null default 0,updated_at timestamptz not null default now(),
 unique(org_id,id),unique(org_id,system_key)
);
create table public.dmcrm_email_settings (
 org_id uuid primary key references public.dmcrm_orgs(id),auto_reply_enabled boolean not null default false,
 auto_reply_template_id uuid,auto_reply_signature text not null default 'Drive Max Used Cars',
 enabled_from timestamptz not null default now(),revision integer not null default 0,
 foreign key(org_id,auto_reply_template_id) references public.dmcrm_email_templates(org_id,id),
 check(not auto_reply_enabled or auto_reply_template_id is not null),check(length(auto_reply_signature)<=3000)
);
create table public.dmcrm_email_signatures (
 org_id uuid not null,user_id uuid not null,body text not null check(length(body)<=3000),revision integer not null default 0,
 primary key(org_id,user_id),foreign key(org_id,user_id) references public.dmcrm_members(org_id,user_id)
);
create table public.dmcrm_email_suppressions (
 org_id uuid not null references public.dmcrm_orgs(id),email text not null,reason text not null,
 created_at timestamptz not null default now(),primary key(org_id,email),check(email=lower(trim(email)))
);
alter table public.dmcrm_customers add column email_opt_out boolean not null default false;
create table public.dmcrm_email_outbox (
 message_id uuid primary key,org_id uuid not null,reply_token uuid not null unique default gen_random_uuid(),
 recipient text not null,subject text not null,body text not null,sender_name text not null,
 attachments jsonb not null default '[]',state text not null default 'pending' check(state in('pending','sending','sent','failed','canceled')),
 attempts integer not null default 0,first_attempt_at timestamptz,next_attempt_at timestamptz not null default now(),
 locked_at timestamptz,claim_token uuid,provider_id text unique,last_error text,created_at timestamptz not null default now(),
 foreign key(org_id,message_id) references public.dmcrm_messages(org_id,id),
 check(jsonb_typeof(attachments)='array' and jsonb_array_length(attachments)<=1)
);
create index dmcrm_email_pending on public.dmcrm_email_outbox(next_attempt_at) where state in('pending','sending');
create table public.dmcrm_email_autoreplies (
 intake_id uuid primary key references public.dmcrm_website_intake(id),org_id uuid not null references public.dmcrm_orgs(id),
 message_id uuid references public.dmcrm_messages(id),state text not null check(state in('queued','skipped')),
 reason text,created_at timestamptz not null default now()
);
create table public.dmcrm_email_events (
 provider_id text primary key,state text not null check(state in('delivered','bounced','complained','suppressed','failed')),
 priority integer not null,created_at timestamptz not null default now()
);
do $$ declare tbl text;begin
 foreach tbl in array array['dmcrm_email_templates','dmcrm_email_settings','dmcrm_email_signatures','dmcrm_email_suppressions','dmcrm_email_outbox','dmcrm_email_autoreplies','dmcrm_email_events'] loop
  execute format('alter table public.%I enable row level security',tbl);
  execute format('revoke all on public.%I from public,anon,authenticated',tbl);
  execute format('grant all on public.%I to service_role',tbl);
 end loop;
end $$;

create function public.dmcrm_email_template_valid(p_text text) returns boolean
language sql immutable set search_path='' as $$
 select p_text is not null and regexp_replace(p_text,'\{\{[[:space:]]*(first_name|customer_name|vehicle|salesperson|dealership|phone|website)[[:space:]]*\}\}','','g') not like '%{{%';
$$;
create function public.dmcrm_email_render(p_text text,p_values jsonb) returns text
language plpgsql immutable set search_path='' as $$
declare m text[];out_text text:='';remaining text:=p_text;pos integer;
begin
 -- A single pass prevents customer-controlled values from becoming template code.
 loop
  m:=regexp_match(remaining,'(\{\{[[:space:]]*([a-z_]+)[[:space:]]*\}\})');
  exit when m is null;
  pos:=strpos(remaining,m[1]);out_text:=out_text||left(remaining,pos-1)||coalesce(p_values->>m[2],'');
  remaining:=substr(remaining,pos+length(m[1]));
 end loop;
 return out_text||remaining;
end $$;

alter function public.dmcrm_command(uuid,uuid,jsonb) rename to dmcrm_command_v13;
revoke all on function public.dmcrm_command_v13(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
create function public.dmcrm_command(p_org uuid,p_actor uuid,p_command jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare typ text:=p_command->>'type';a public.dmcrm_staff%rowtype;t public.dmcrm_email_templates%rowtype;
 cfg public.dmcrm_email_settings%rowtype;sig public.dmcrm_email_signatures%rowtype;c public.dmcrm_customers%rowtype;
 rid uuid:=(p_command->>'id')::uuid;data jsonb:=p_command->'template';rev integer:=(p_command->>'revision')::integer;
begin
 if typ not in('save_email_template','delete_email_template','save_email_signature','save_email_settings','set_email_opt_out') then
  return public.dmcrm_command_v13(p_org,p_actor,p_command);
 end if;
 select s.* into a from public.dmcrm_staff s join public.dmcrm_members member_row on member_row.org_id=s.org_id and member_row.user_id=s.user_id
  where s.org_id=p_org and s.user_id=p_actor and s.active and member_row.active for share of s,member_row;
 if a.id is null then raise exception 'CRM membership required' using errcode='42501';end if;
 if typ in('save_email_template','delete_email_template','save_email_settings') and a.role not in('owner','manager') then raise exception 'Manager access required' using errcode='42501';end if;
 if typ in('save_email_template','delete_email_template') then
  -- Serializes template edits and workflow selection, including deletion.
  select * into cfg from public.dmcrm_email_settings where org_id=p_org for update;
  select * into t from public.dmcrm_email_templates where org_id=p_org and id=rid for update;
  if rev is null or rev<>coalesce(t.revision,0) then raise exception 'Email settings changed. Refresh before saving.';end if;
  if typ='delete_email_template' then
   if t.id is null then raise exception 'Email template unavailable';end if;
   if cfg.auto_reply_enabled and cfg.auto_reply_template_id=rid then raise exception 'Choose another automatic reply template or turn off the workflow before deleting this template.';end if;
   update public.dmcrm_email_settings set auto_reply_template_id=null,revision=revision+1 where org_id=p_org and auto_reply_template_id=rid;
   delete from public.dmcrm_email_templates where org_id=p_org and id=rid;
  else
   if length(trim(coalesce(data->>'name',''))) not between 1 and 100
    or length(trim(coalesce(data->>'subject',''))) not between 1 and 250 or data->>'subject' ~ E'[\r\n]'
    or length(trim(coalesce(data->>'body',''))) not between 1 and 12000
    or not public.dmcrm_email_template_valid(data->>'subject') or not public.dmcrm_email_template_valid(data->>'body')
    or coalesce(data->>'category','') not in('New lead','Follow-up','Sold','Anniversary','Birthday','Other') then raise exception 'Check the email template fields and personalization tokens.';end if;
   insert into public.dmcrm_email_templates(id,org_id,name,category,subject,body)
    values(rid,p_org,trim(data->>'name'),data->>'category',trim(data->>'subject'),trim(data->>'body'))
    on conflict(id) do update set name=excluded.name,category=excluded.category,subject=excluded.subject,body=excluded.body,revision=dmcrm_email_templates.revision+1,updated_at=now()
     where dmcrm_email_templates.org_id=p_org and dmcrm_email_templates.revision=rev returning id into rid;
   if rid is null then raise exception 'Email template unavailable' using errcode='42501';end if;
  end if;
 elsif typ='save_email_signature' then
  if coalesce(length(p_command->>'body'),3001)>3000 then raise exception 'Keep the signature under 3,000 characters.';end if;
  select * into sig from public.dmcrm_email_signatures where org_id=p_org and user_id=p_actor for update;
  if rev is null or rev<>coalesce(sig.revision,0) then raise exception 'Email settings changed. Refresh before saving.';end if;
  insert into public.dmcrm_email_signatures(org_id,user_id,body) values(p_org,p_actor,trim(p_command->>'body'))
   on conflict(org_id,user_id) do update set body=excluded.body,revision=dmcrm_email_signatures.revision+1 where dmcrm_email_signatures.revision=rev;
  if not found then raise exception 'Email settings changed. Refresh before saving.';end if;
  rid:=p_actor;
 elsif typ='save_email_settings' then
  select * into cfg from public.dmcrm_email_settings where org_id=p_org for update;
  if cfg.org_id is null or rev is null or cfg.revision<>rev then raise exception 'Email settings changed. Refresh before saving.';end if;
  rid:=nullif(p_command->>'template_id','')::uuid;
  if (p_command->>'enabled')::boolean and rid is null then raise exception 'Choose an automatic reply template.';end if;
  if rid is not null and not exists(select 1 from public.dmcrm_email_templates where org_id=p_org and id=rid) then raise exception 'Email template unavailable';end if;
  if coalesce(length(p_command->>'signature'),3001)>3000 then raise exception 'Keep the signature under 3,000 characters.';end if;
  update public.dmcrm_email_settings set auto_reply_enabled=(p_command->>'enabled')::boolean,auto_reply_template_id=rid,auto_reply_signature=trim(p_command->>'signature'),
   enabled_from=case when not auto_reply_enabled and (p_command->>'enabled')::boolean then now() else enabled_from end,revision=revision+1 where org_id=p_org;
  rid:=p_org;
 else
  select * into c from public.dmcrm_customers where org_id=p_org and id=(p_command->>'customer_id')::uuid for update;
  if c.id is null then raise exception 'Customer unavailable' using errcode='42501';end if;
  update public.dmcrm_customers set email_opt_out=(p_command->>'opted_out')::boolean where id=c.id;
  if trim(c.email)<>'' then
   if (p_command->>'opted_out')::boolean then
    insert into public.dmcrm_email_suppressions(org_id,email,reason) values(p_org,lower(trim(c.email)),'Customer requested no email') on conflict do nothing;
   else
    delete from public.dmcrm_email_suppressions where org_id=p_org and email=lower(trim(c.email)) and reason='Customer requested no email';
   end if;
  end if;
  insert into public.dmcrm_activities(org_id,customer_id,kind,body,created_by)
   values(p_org,c.id,'system',case when (p_command->>'opted_out')::boolean then 'Email follow-up stopped at customer request.' else 'Customer permission to receive email restored by staff.' end,a.name);
  rid:=c.id;
 end if;
 return rid;
end $$;

-- Only a deliberate Send action queues a saved, unchanged draft. Old drafts stay drafts.
create function public.dmcrm_queue_email(p_org uuid,p_actor uuid,p_id uuid,p_revision integer,p_attachments jsonb default '[]') returns uuid
language plpgsql security definer set search_path='' as $$
declare a public.dmcrm_staff%rowtype;m public.dmcrm_messages%rowtype;c public.dmcrm_customers%rowtype;
begin
 select s.* into a from public.dmcrm_staff s join public.dmcrm_members member_row on member_row.org_id=s.org_id and member_row.user_id=s.user_id
  where s.org_id=p_org and s.user_id=p_actor and s.active and member_row.active for share of s,member_row;
 if a.id is null then raise exception 'CRM membership required' using errcode='42501';end if;
 if p_org<>'d5a1c100-0000-4000-8000-000000000001' then raise exception 'Email is not connected for this dealership';end if;
 select * into m from public.dmcrm_messages where org_id=p_org and id=p_id for update;
 if m.id is null or m.channel<>'email' or m.direction<>'outbound' or (m.created_by<>p_actor and a.role not in('owner','manager')) then raise exception 'Draft unavailable' using errcode='42501';end if;
 if m.status in('queued','sent','delivered') and exists(select 1 from public.dmcrm_email_outbox where message_id=m.id) then return m.id;end if;
 if m.status<>'draft' then raise exception 'Only an unsent draft can be sent';end if;
 if m.revision<>p_revision or p_revision is null then raise exception 'Draft changed in another session. Reload before sending.';end if;
 select * into c from public.dmcrm_customers where org_id=p_org and id=m.customer_id;
 if c.email_opt_out or exists(select 1 from public.dmcrm_email_suppressions where org_id=p_org and email=lower(trim(m.recipient))) then raise exception 'Email is stopped for this recipient. Review the customer email preference or delivery failure.';end if;
 if m.recipient !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or m.subject ~ E'[\r\n]' or length(trim(m.subject)) not between 1 and 250 then raise exception 'Enter a valid email recipient and subject.';end if;
 if not public.dmcrm_email_template_valid(m.body) or m.body like '%{{%' or m.subject like '%{{%' then raise exception 'Replace all personalization fields before sending.';end if;
 if jsonb_typeof(p_attachments)<>'array' or jsonb_array_length(p_attachments)>1 or length(p_attachments::text)>2000000
  or (m.quote_id is not null and jsonb_array_length(p_attachments)<>1) or (m.quote_id is null and p_attachments<>'[]'::jsonb) then raise exception 'The customer quote attachment could not be prepared.';end if;
 insert into public.dmcrm_email_outbox(message_id,org_id,recipient,subject,body,sender_name,attachments)
  values(m.id,p_org,lower(trim(m.recipient)),m.subject,m.body,a.name,p_attachments);
 update public.dmcrm_messages set status='queued',recipient=lower(trim(recipient)),error=null,updated_at=now(),revision=revision+1 where id=m.id;
 return m.id;
end $$;

create function public.dmcrm_prepare_auto_reply(p_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare q public.dmcrm_website_intake%rowtype;cfg public.dmcrm_email_settings%rowtype;t public.dmcrm_email_templates%rowtype;
 c public.dmcrm_customers%rowtype;o public.dmcrm_opportunities%rowtype;values_json jsonb;to_email text;subject_text text;body_text text;mid uuid:=gen_random_uuid();why text;
begin
 if not pg_try_advisory_xact_lock(76102614) then return;end if;
 select * into q from public.dmcrm_website_intake where id=p_id and state='imported';
 if q.id is null or q.org_id<>'d5a1c100-0000-4000-8000-000000000001' or exists(select 1 from public.dmcrm_email_autoreplies where intake_id=q.id) then return;end if;
 select * into cfg from public.dmcrm_email_settings where org_id=q.org_id;
 if cfg.org_id is null or q.received_at<cfg.enabled_from then return;end if;
 select * into c from public.dmcrm_customers where org_id=q.org_id and id=q.customer_id;
 select * into o from public.dmcrm_opportunities where org_id=q.org_id and id=q.opportunity_id;
 to_email:=lower(trim(coalesce(q.payload->>'email','')));
 why:=case when not cfg.auto_reply_enabled then 'Workflow is off'
  when q.received_at<now()-interval '24 hours' then 'Inquiry is too old for an automatic acknowledgment'
  when to_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then 'No email address supplied'
  when c.email_opt_out or exists(select 1 from public.dmcrm_email_suppressions where org_id=q.org_id and email=to_email) then 'Email is stopped for this recipient'
  when exists(select 1 from public.dmcrm_email_autoreplies ar join public.dmcrm_email_outbox b on b.message_id=ar.message_id where ar.org_id=q.org_id and b.recipient=to_email and ar.created_at>now()-interval '10 minutes' and b.state<>'failed') then 'A recent inquiry was already acknowledged' end;
 if why is not null then
  insert into public.dmcrm_email_autoreplies(intake_id,org_id,state,reason) values(q.id,q.org_id,'skipped',why) on conflict do nothing;
  return;
 end if;
 select * into t from public.dmcrm_email_templates where org_id=q.org_id and id=cfg.auto_reply_template_id;
 if t.id is null then return;end if;
 values_json:=jsonb_build_object('first_name',coalesce(nullif(split_part(trim(q.payload->>'name'),' ',1),''),'there'),'customer_name',q.payload->>'name',
  'vehicle',coalesce(nullif(o.vehicle_interest,''),'your next vehicle'),'salesperson','Drive Max team','dealership','Drive Max Used Cars','phone','(252) 541-0040','website','https://www.drivemaxusedcars.com');
 subject_text:=left(regexp_replace(public.dmcrm_email_render(t.subject,values_json),E'[\r\n]+',' ','g'),250);
 body_text:=public.dmcrm_email_render(t.body,values_json)||case when cfg.auto_reply_signature<>'' then E'\n\n'||cfg.auto_reply_signature else '' end;
 if length(body_text)>16000 then
  insert into public.dmcrm_email_autoreplies(intake_id,org_id,state,reason) values(q.id,q.org_id,'skipped','Personalized template exceeds the message limit');return;
 end if;
 insert into public.dmcrm_messages(id,org_id,customer_id,opportunity_id,channel,direction,status,recipient,subject,body,created_by)
  values(mid,q.org_id,q.customer_id,q.opportunity_id,'email','outbound','queued',to_email,subject_text,body_text,'00000000-0000-4000-8000-000000000000');
 insert into public.dmcrm_email_outbox(message_id,org_id,recipient,subject,body,sender_name) values(mid,q.org_id,to_email,subject_text,body_text,'Drive Max team');
 insert into public.dmcrm_email_autoreplies(intake_id,org_id,message_id,state) values(q.id,q.org_id,mid,'queued');
end $$;
create function public.dmcrm_auto_reply_trigger() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.state='imported' then perform public.dmcrm_prepare_auto_reply(new.id);end if;
 return new;
exception when others then
 raise log 'CRM acknowledgment deferred, SQLSTATE %',sqlstate;return new;
end $$;
create trigger dmcrm_auto_reply after insert or update of state on public.dmcrm_website_intake for each row execute function public.dmcrm_auto_reply_trigger();

-- Only the website's authenticated worker can claim; locks prevent concurrent sends.
create function public.dmcrm_email_claim(p_id uuid default null) returns setof public.dmcrm_email_outbox
language plpgsql security definer set search_path='' as $$
declare b public.dmcrm_email_outbox%rowtype;r record;
begin
 perform public.dmcrm_retry_website_intake('d5a1c100-0000-4000-8000-000000000001');
 for r in select q.id from public.dmcrm_website_intake q join public.dmcrm_email_settings cfg on cfg.org_id=q.org_id
  where q.state='imported' and q.received_at>=cfg.enabled_from and not exists(select 1 from public.dmcrm_email_autoreplies ar where ar.intake_id=q.id)
  order by q.received_at,q.id limit 20
 loop
  begin perform public.dmcrm_prepare_auto_reply(r.id);exception when others then raise log 'CRM acknowledgment recovery deferred, SQLSTATE %',sqlstate;end;
 end loop;
 for b in select * from public.dmcrm_email_outbox where org_id='d5a1c100-0000-4000-8000-000000000001'
  and (p_id is null or message_id=p_id) and ((state='pending' and next_attempt_at<=now()) or (state='sending' and locked_at<now()-interval '3 minutes'))
  order by created_at,message_id for update skip locked limit 10
 loop
  if b.first_attempt_at<now()-interval '23 hours' or b.attempts>=8 then
   update public.dmcrm_email_outbox set state='failed',last_error='Delivery could not be confirmed. Review provider status before sending another email.',claim_token=null,locked_at=null where message_id=b.message_id;
   update public.dmcrm_messages set status='failed',error='Delivery could not be confirmed. Review provider status before sending another email.',updated_at=now() where id=b.message_id and status='queued';
   continue;
  end if;
  if exists(select 1 from public.dmcrm_email_suppressions where org_id=b.org_id and email=b.recipient)
   or exists(select 1 from public.dmcrm_messages m join public.dmcrm_customers c on c.org_id=m.org_id and c.id=m.customer_id where m.id=b.message_id and c.email_opt_out) then
   update public.dmcrm_email_outbox set state='failed',last_error='Email is stopped for this recipient.',claim_token=null,locked_at=null where message_id=b.message_id;
   update public.dmcrm_messages set status='failed',error='Email is stopped for this recipient.',updated_at=now() where id=b.message_id and status='queued';
   continue;
  end if;
  return query update public.dmcrm_email_outbox set state='sending',claim_token=gen_random_uuid(),locked_at=now(),attempts=attempts+1,first_attempt_at=coalesce(first_attempt_at,now()) where message_id=b.message_id returning *;
  return;
 end loop;
end $$;

create function public.dmcrm_email_delivery(p_provider text,p_state text) returns boolean
language plpgsql security definer set search_path='' as $$
declare ev public.dmcrm_email_events%rowtype;m public.dmcrm_messages%rowtype;pri integer;
begin
 pri:=case p_state when 'delivered' then 1 when 'failed' then 2 when 'bounced' then 3 when 'suppressed' then 4 when 'complained' then 5 end;
 if pri is null or length(coalesce(p_provider,'')) not between 1 and 250 then raise exception 'Invalid delivery event';end if;
 insert into public.dmcrm_email_events(provider_id,state,priority) values(p_provider,p_state,pri)
  on conflict(provider_id) do update set state=excluded.state,priority=excluded.priority where dmcrm_email_events.priority<excluded.priority;
 select * into ev from public.dmcrm_email_events where provider_id=p_provider;
 select * into m from public.dmcrm_messages where channel='email' and direction='outbound' and provider_id=p_provider for update;
 if m.id is null then return false;end if;
 update public.dmcrm_messages set status=case when ev.state='delivered' then 'delivered' else 'failed' end,
  error=case when ev.state='delivered' then null else 'Email provider reported '||ev.state||'.' end,updated_at=now() where id=m.id;
 if ev.state in('bounced','complained','suppressed') then
  insert into public.dmcrm_email_suppressions(org_id,email,reason) values(m.org_id,lower(trim(m.recipient)),'Email provider reported '||ev.state)
   on conflict(org_id,email) do update set reason=excluded.reason;
 end if;
 return true;
end $$;
create function public.dmcrm_email_finish(p_id uuid,p_claim uuid,p_state text,p_provider text default null,p_error text default null) returns boolean
language plpgsql security definer set search_path='' as $$
declare b public.dmcrm_email_outbox%rowtype;event_state text;
begin
 select * into b from public.dmcrm_email_outbox where message_id=p_id and claim_token=p_claim and state='sending' for update;
 if b.message_id is null then return false;end if;
 if p_state not in('sent','retry','failed') or (p_state='sent' and nullif(p_provider,'') is null) then raise exception 'Invalid delivery result';end if;
 update public.dmcrm_email_outbox set state=case when p_state='retry' then 'pending' else p_state end,
  provider_id=coalesce(p_provider,provider_id),claim_token=null,locked_at=null,last_error=left(p_error,500),
  next_attempt_at=now()+make_interval(secs=>least(1800,30*(2^least(attempts,6))::integer)) where message_id=p_id;
 update public.dmcrm_messages set provider_id=coalesce(p_provider,provider_id),status=case when p_state='sent' then 'sent' when p_state='failed' then 'failed' else 'queued' end,
  error=left(p_error,500),updated_at=now() where id=p_id and status in('queued','sent');
 select state into event_state from public.dmcrm_email_events where provider_id=p_provider;
 if event_state is not null then perform public.dmcrm_email_delivery(p_provider,event_state);end if;
 return true;
end $$;

create function public.dmcrm_email_receive(p_token uuid,p_provider text,p_from text,p_subject text,p_body text,p_received timestamptz) returns boolean
language plpgsql security definer set search_path='' as $$
declare b public.dmcrm_email_outbox%rowtype;m public.dmcrm_messages%rowtype;
begin
 select * into b from public.dmcrm_email_outbox where reply_token=p_token and first_attempt_at is not null;
 if b.message_id is null or b.recipient<>lower(trim(p_from)) then return false;end if;
 select * into m from public.dmcrm_messages where org_id=b.org_id and id=b.message_id;
 if length(coalesce(p_provider,'')) not between 1 and 250 or length(trim(coalesce(p_body,'')))=0 then raise exception 'Invalid received email';end if;
 insert into public.dmcrm_messages(id,org_id,customer_id,opportunity_id,channel,direction,status,recipient,subject,body,created_by,provider_id,created_at,updated_at)
  values(gen_random_uuid(),m.org_id,m.customer_id,m.opportunity_id,'email','inbound','received',b.recipient,left(coalesce(p_subject,''),250),left(p_body,16000),m.created_by,p_provider,least(p_received,now()),least(p_received,now()))
  on conflict(org_id,channel,provider_id) where provider_id is not null do nothing;
 return true;
end $$;

-- A delivery event may arrive before either website sender stores its provider ID.
-- Reconcile that event before saving; unknown events can then be acknowledged once.
create function public.dmcrm_website_delivery_reconcile() returns trigger
language plpgsql security definer set search_path='' as $$
declare ev text;
begin
 if new.provider_id is null then return new;end if;
 select state into ev from public.dmcrm_email_events where provider_id=new.provider_id;
 if ev is null then return new;end if;
 if tg_table_name='messages' then
  if new.direction='outbound' then new.state:=ev;end if;
 elsif ev<>'delivered' then new.last_error:='Provider reported '||ev;
 end if;
 return new;
end $$;
create trigger dmcrm_message_delivery before insert or update on public.messages for each row execute function public.dmcrm_website_delivery_reconcile();
create trigger dmcrm_notification_delivery before insert or update on public.lead_notifications for each row execute function public.dmcrm_website_delivery_reconcile();
revoke all on function public.dmcrm_website_delivery_reconcile() from public,anon,authenticated,service_role;

-- Email exchanges made in Control Room also appear in the existing CRM profile.
create function public.dmcrm_sync_website_email(p_id uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare w public.messages%rowtype;q public.dmcrm_website_intake%rowtype;email_address text;crm_status text;ev_state text;
begin
 select * into w from public.messages where id=p_id;
 if w.id is null or w.direction='note' or (w.direction='inbound' and w.provider_id is null) or w.state='pending' then return false;end if;
 select * into q from public.dmcrm_website_intake where id=w.lead_id and state='imported';
 if q.id is null then return false;end if;
 email_address:=case when w.direction='outbound' then w.recipient else q.payload->>'email' end;
 if nullif(email_address,'') is null then return false;end if;
 crm_status:=case when w.direction='inbound' then 'received' when w.state in('sent','delivered') then w.state else 'failed' end;
 insert into public.dmcrm_messages(id,org_id,customer_id,opportunity_id,channel,direction,status,recipient,subject,body,created_by,provider_id,created_at,updated_at,error)
  values(w.id,q.org_id,q.customer_id,q.opportunity_id,'email',w.direction,crm_status,email_address,left(w.subject,250),left(w.body,16000),coalesce(w.staff_id,'00000000-0000-4000-8000-000000000000'),w.provider_id,w.created_at,w.created_at,case when crm_status='failed' then 'Email provider reported '||w.state||'.' end)
  on conflict(id) do update set status=excluded.status,provider_id=excluded.provider_id,error=excluded.error,updated_at=now() where dmcrm_messages.org_id=q.org_id;
 select state into ev_state from public.dmcrm_email_events where provider_id=w.provider_id;
 if ev_state is not null then perform public.dmcrm_email_delivery(w.provider_id,ev_state);end if;
 if w.state in('bounced','complained','suppressed') then
  insert into public.dmcrm_email_suppressions(org_id,email,reason) values(q.org_id,lower(trim(email_address)),'Email provider reported '||w.state) on conflict(org_id,email) do update set reason=excluded.reason;
 end if;
 return true;
end $$;
create function public.dmcrm_website_email_trigger() returns trigger
language plpgsql security definer set search_path='' as $$
begin perform public.dmcrm_sync_website_email(new.id);return new;
exception when others then raise log 'CRM website email sync deferred, SQLSTATE %',sqlstate;return new;
end $$;
create trigger dmcrm_website_email after insert or update on public.messages for each row execute function public.dmcrm_website_email_trigger();

-- Recover emails received before their website inquiry was imported.
create function public.dmcrm_email_recover() returns void
language plpgsql security definer set search_path='' as $$
declare r record;
begin
 for r in select w.id from public.messages w join public.dmcrm_website_intake q on q.id=w.lead_id and q.state='imported'
  left join public.dmcrm_messages m on m.id=w.id
  where w.direction in('inbound','outbound') and w.state<>'pending' and (w.direction='outbound' or w.provider_id is not null)
   and (m.id is null or m.provider_id is distinct from w.provider_id or m.status is distinct from case when w.direction='inbound' then 'received' when w.state in('sent','delivered') then w.state else 'failed' end)
  order by w.created_at limit 50
 loop begin perform public.dmcrm_sync_website_email(r.id);exception when others then raise log 'CRM email recovery deferred, SQLSTATE %',sqlstate;end;end loop;
end $$;
alter function public.dmcrm_attention(uuid,uuid) rename to dmcrm_attention_v13;
create function public.dmcrm_attention(p_org uuid,p_actor uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if not exists(select 1 from public.dmcrm_staff st join public.dmcrm_members member_row on member_row.org_id=st.org_id and member_row.user_id=st.user_id where st.org_id=p_org and st.user_id=p_actor and st.active and member_row.active) then raise exception 'CRM membership required' using errcode='42501';end if;
 perform public.dmcrm_email_recover();
 result:=public.dmcrm_attention_v13(p_org,p_actor);
 return result||jsonb_build_object('emailQueue',jsonb_build_object('pending',(select count(*) from public.dmcrm_email_outbox where org_id=p_org and state in('pending','sending'))));
end $$;

revoke all on function public.dmcrm_email_template_valid(text),public.dmcrm_email_render(text,jsonb),public.dmcrm_command(uuid,uuid,jsonb),public.dmcrm_queue_email(uuid,uuid,uuid,integer,jsonb),public.dmcrm_prepare_auto_reply(uuid),public.dmcrm_auto_reply_trigger(),public.dmcrm_email_claim(uuid),public.dmcrm_email_delivery(text,text),public.dmcrm_email_finish(uuid,uuid,text,text,text),public.dmcrm_email_receive(uuid,text,text,text,text,timestamptz),public.dmcrm_sync_website_email(uuid),public.dmcrm_website_email_trigger(),public.dmcrm_email_recover(),public.dmcrm_attention_v13(uuid,uuid),public.dmcrm_attention(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.dmcrm_command(uuid,uuid,jsonb),public.dmcrm_queue_email(uuid,uuid,uuid,integer,jsonb),public.dmcrm_email_claim(uuid),public.dmcrm_email_delivery(text,text),public.dmcrm_email_finish(uuid,uuid,text,text,text),public.dmcrm_email_receive(uuid,text,text,text,text,timestamptz),public.dmcrm_attention(uuid,uuid) to service_role;

-- Starter templates remain dealership-editable. This migration runs once.
insert into public.dmcrm_email_templates(org_id,name,category,subject,body,system_key)
select o.id,t.value->>'name',t.value->>'category',t.value->>'subject',t.value->>'body',t.value->>'key' from public.dmcrm_orgs o cross join jsonb_array_elements($templates$[{"key":"new-lead","name":"First response · new website lead","category":"New lead","subject":"Thanks for contacting Drive Max!","body":"Hi {{first_name}},\n\nThank you for your interest in Drive Max Used Cars! We received your inquiry, and a Drive Max team member will be in touch shortly to help.\n\nIf there is anything else you would like us to know, just reply to this email. We look forward to helping you!"},{"key":"day-1","name":"Day 1 · how can we help?","category":"Follow-up","subject":"How can we help with your vehicle search?","body":"Hi {{first_name}},\n\nI'm following up on your interest in {{vehicle}}. What questions can I answer for you?\n\nLet me know what matters most in your next vehicle, and I can help you explore the options. You can reply here or call {{phone}}.\n\nIf you would prefer no further follow-up emails, just reply and let us know."},{"key":"day-2","name":"Day 2 · arrange a visit","category":"Follow-up","subject":"Would you like to stop by Drive Max?","body":"Hi {{first_name}},\n\nWould it help to see {{vehicle}} in person? Send me a day and time that works for you, and I'll check availability and help arrange a visit.\n\nThere is no pressure. We're happy to answer questions and help you find the right fit.\n\nIf you would prefer no further follow-up emails, just reply and let us know."},{"key":"day-3","name":"Day 3 · narrow down the options","category":"Follow-up","subject":"Let's narrow down your options","body":"Hi {{first_name}},\n\nAre you still considering {{vehicle}}, or has your search changed? If you share the features, size, or price range you're looking for, I can help point you toward suitable vehicles.\n\nReply whenever it's convenient. I'm happy to help.\n\nIf you would prefer no further follow-up emails, just reply and let us know."},{"key":"day-4","name":"Day 4 · trade and financing questions","category":"Follow-up","subject":"Any questions about your next steps?","body":"Hi {{first_name}},\n\nIf a trade-in or financing is part of your plans, we can explain the next steps and what information is needed. Please don't send Social Security numbers, account numbers, or other sensitive financial details by email.\n\nWould you prefer a quick phone call or a visit? Let me know what works for you.\n\nIf you would prefer no further follow-up emails, just reply and let us know."},{"key":"day-5","name":"Day 5 · shopping check-in","category":"Follow-up","subject":"How is your vehicle search going?","body":"Hi {{first_name}},\n\nI wanted to check in and see how your vehicle search is going. If you're still looking, I'm here to answer questions about {{vehicle}} or help you consider other options.\n\nIf you've already found a vehicle, congratulations! Just let me know so I can update your inquiry.\n\nIf you would prefer no further follow-up emails, just reply and let us know."},{"key":"day-6","name":"Day 6 · keep the door open","category":"Follow-up","subject":"Here when you're ready","body":"Hi {{first_name}},\n\nI know buying a vehicle takes time. If now isn't the right moment, that's completely fine.\n\nWhenever you're ready, you can reply to this email, call {{phone}}, or browse our current inventory at {{website}}. Thank you again for considering Drive Max.\n\nIf you would prefer no further follow-up emails, just reply and let us know."},{"key":"sold","name":"Sold · thank you for your purchase","category":"Sold","subject":"Thank you for choosing Drive Max!","body":"Hi {{first_name}},\n\nThank you for purchasing {{vehicle}} from Drive Max Used Cars! We appreciate your business and the opportunity to help.\n\nIf you have questions about your paperwork or anything we discussed during your purchase, reply here or call {{phone}}. We're glad to help.\n\nEnjoy your vehicle, and thank you again!"},{"key":"sold-7","name":"7 days after sale · ownership check-in","category":"Sold","subject":"How is everything going with your vehicle?","body":"Hi {{first_name}},\n\nIt's been about a week since your purchase, and I wanted to check in. How is everything going with {{vehicle}}?\n\nIf you have questions about your paperwork or need help finding information from your purchase, please let me know.\n\nThank you again for choosing Drive Max!"},{"key":"anniversary-6","name":"6-month anniversary","category":"Anniversary","subject":"Happy six months with your vehicle!","body":"Hi {{first_name}},\n\nHappy six-month anniversary of your purchase of {{vehicle}}! We hope you're enjoying it and wanted to thank you again for choosing Drive Max.\n\nIf your vehicle needs have changed or you have a question, we're happy to hear from you.\n\nIf you would prefer no further follow-up emails, just reply and let us know."},{"key":"birthday","name":"Birthday wishes","category":"Birthday","subject":"Happy birthday from Drive Max!","body":"Hi {{first_name}},\n\nWishing you a happy birthday and a wonderful year ahead! Thank you for being part of the Drive Max community.\n\nEnjoy your day!\n\nIf you would prefer no further follow-up emails, just reply and let us know."},{"key":"test-drive","name":"Test drive · confirm a requested time","category":"Other","subject":"Let's plan your Drive Max test drive","body":"Hi {{first_name}},\n\nThank you for your interest in a test drive of {{vehicle}}. What day and time works best for you?\n\nOnce we've checked vehicle and staff availability, we'll confirm the appointment with you. You can reply here or reach us at {{phone}}."},{"key":"sell-car","name":"Sell us your car · next steps","category":"Other","subject":"Thanks for telling us about your vehicle","body":"Hi {{first_name}},\n\nThank you for giving Drive Max the opportunity to learn about your vehicle. Our team can review the details with you and arrange a time to see it.\n\nWhat is the best time to reach you? Any offer will depend on our review and inspection of the vehicle."}]$templates$::jsonb) t(value);
insert into public.dmcrm_email_settings(org_id,auto_reply_enabled,auto_reply_template_id,auto_reply_signature)
select org_id,org_id='d5a1c100-0000-4000-8000-000000000001',id,$sig$Drive Max Used Cars
6210 Old US Hwy 70 West
New Bern, NC 28562
(252) 541-0040
https://www.drivemaxusedcars.com$sig$ from public.dmcrm_email_templates where system_key='new-lead';
