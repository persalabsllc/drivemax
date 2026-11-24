import { z } from "zod";

// Keep full banking data in runtime memory. Only its suffix and readiness are saved.
const configSchema = z.object({
  org_id: z.uuid(),
  account_id: z.uuid(),
  routing: z.string().regex(/^\d{9}$/).refine((s) => Number(s) > 0
    && [...s].reduce((sum, digit, i) => sum + Number(digit) * [3, 7, 1][i % 3], 0) % 10 === 0),
  account: z.string().regex(/^\d{4,17}$/),
}).strict();

// Call within the migration transaction. Repeated builds preserve numbering,
// alignment and revision; conflicting accounts require explicit reconciliation.
export async function configureCompanyCheckBank(client, rawConfig) {
  if (!rawConfig) return;
  let config;
  try {
    config = configSchema.parse(JSON.parse(rawConfig));
  } catch {
    throw new Error("Invalid company check banking configuration.");
  }
  const { rows: accounts } = await client.query(
    "select * from public.dmcrm_check_accounts where id=$1 for update", [config.account_id],
  );
  const account = accounts[0];
  if (!account) return;
  if (account.org_id !== config.org_id) throw new Error("check_bank_account_locked");
  const last4 = config.account.slice(-4);
  if (account.bank_ready && account.last4 === last4) return;
  if (account.layout?.stock !== "blank_bottom_1002") throw new Error("check_bank_account_locked");
  const { rows: checks } = await client.query(
    "select 1 from public.dmcrm_checks where account_id=$1 limit 1", [account.id],
  );
  if (checks.length) throw new Error("check_bank_account_locked");
  const { rows: owners } = await client.query(`select m.user_id from public.dmcrm_members m
    join public.dmcrm_staff s on s.org_id=m.org_id and s.user_id=m.user_id
    where m.org_id=$1 and m.active and s.active and m.role='owner' and s.role='owner'
    order by m.user_id limit 1`, [config.org_id]);
  if (!owners.length) throw new Error("check_owner_required");
  const { rows: updated } = await client.query(`update public.dmcrm_check_accounts
    set bank_ready=true,last4=$2,revision=revision+1 where id=$1 returning *`, [account.id, last4]);
  await client.query(`insert into public.dmcrm_check_events(org_id,account_id,actor,action,details)
    values($1,$2,$3,'configure_bank',$4::jsonb)`, [config.org_id, account.id, owners[0].user_id,
    JSON.stringify({ before: account, after: updated[0] })]);
}
