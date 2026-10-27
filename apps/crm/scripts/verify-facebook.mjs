import { randomUUID } from "node:crypto";
// This exercises the production RPC inside a savepoint. No messages are sent.
export async function verifyFacebook(client) {
  const org="d5a1c100-0000-4000-8000-000000000001";
  const one=async(sql,args=[])=>(await client.query(sql,args)).rows[0];
  const check=value=>{if(!value)throw Object.assign(Error("Facebook intake verification failed"),{code:"FACEBOOK_VERIFY_FAILED"});};
  const sender="999"+Date.now(),page="998"+Date.now();
  const event={sender_id:sender,message_id:`verification:${randomUUID()}`,body:"Verification vehicle inquiry",received_at:new Date().toISOString(),referral:{}};
  await client.query("savepoint facebook_verification");
  try {
    const first=await one("select public.dmcrm_receive_facebook($1,$2,$3::jsonb) id",[org,page,JSON.stringify(event)]);
    const duplicate=await one("select public.dmcrm_receive_facebook($1,$2,$3::jsonb) id",[org,page,JSON.stringify(event)]);
    check(first.id===duplicate.id);
    const message=await one("select * from public.dmcrm_facebook_messages where id=$1",[first.id]);
    check(message?.customer_id && message.opportunity_id);
    const tasks=await one("select count(*)::integer n from public.dmcrm_tasks where org_id=$1 and opportunity_id=$2",[org,message.opportunity_id]);
    check(tasks.n===1);
    const replies=await one("select public.dmcrm_receive_facebook($1,$2,$3::jsonb) id",[org,page,JSON.stringify({...event,message_id:`verification:${randomUUID()}`,body:"Same customer, second message"})]);
    const second=await one("select * from public.dmcrm_facebook_messages where id=$1",[replies.id]);
    check(second.customer_id===message.customer_id && second.opportunity_id===message.opportunity_id);
  } finally { await client.query("rollback to savepoint facebook_verification"); await client.query("release savepoint facebook_verification"); }
}
