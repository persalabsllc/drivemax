import webpush from "web-push";
/** Uses the existing Supabase scheduler. No new paid service or provider is provisioned. */
export async function setupWorkflowScheduler(client) {
  if (!process.env.CRM_EMAIL_WORKER_SECRET)
    throw Object.assign(Error("Workflow worker configuration missing"), {
      code: "WORKFLOW_SECRET_MISSING",
    });
  await client.query(
    "create extension if not exists pg_cron with schema pg_catalog",
  );
  await client.query(
    "create extension if not exists pg_net with schema extensions",
  );
  await client.query(
    "create extension if not exists supabase_vault with schema vault",
  );
  const existing = (
    await client.query(
      "select id from vault.secrets where name='dmcrm_automation_worker' limit 1",
    )
  ).rows[0];
  if (existing)
    await client.query("select vault.update_secret($1,$2)", [
      existing.id,
      process.env.CRM_EMAIL_WORKER_SECRET,
    ]);
  else
    await client.query(
      "select vault.create_secret($1,'dmcrm_automation_worker','Drive Max CRM scheduled email and push worker')",
      [process.env.CRM_EMAIL_WORKER_SECRET],
    );
  const keys = webpush.generateVAPIDKeys();
  await client.query(
    "insert into public.dmcrm_push_config(id,public_key,private_key) values('vapid',$1,$2) on conflict(id) do nothing",
    [keys.publicKey, keys.privateKey],
  );
  await client.query(`create or replace function public.dmcrm_schedule_tick() returns void language plpgsql security definer set search_path='' as $$
 declare worker_secret text;begin
 perform public.dmcrm_workflow_prepare();perform public.dmcrm_push_prepare();
 update public.dmcrm_workflow_health set last_background_at=now();
 select decrypted_secret into worker_secret from vault.decrypted_secrets where name='dmcrm_automation_worker' limit 1;
 if worker_secret is null then raise exception 'Workflow worker not configured';end if;
 perform net.http_post(url:='https://crm.drivemaxusedcars.com/api/automation/run',headers:=jsonb_build_object('Authorization','Bearer '||worker_secret,'Content-Type','application/json'),body:='{}'::jsonb,timeout_milliseconds:=60000);
 end $$;
 revoke all on function public.dmcrm_schedule_tick() from public,anon,authenticated,service_role;`);
  await client.query(
    "select cron.schedule('dmcrm-sales-workflows','*/5 * * * *','select public.dmcrm_schedule_tick()')",
  );
  const job = (
    await client.query(
      "select active,schedule from cron.job where jobname='dmcrm-sales-workflows'",
    )
  ).rows[0];
  if (!job?.active || job.schedule !== "*/5 * * * *")
    throw Object.assign(Error("Scheduler not active"), {
      code: "WORKFLOW_SCHEDULER_INACTIVE",
    });
}
