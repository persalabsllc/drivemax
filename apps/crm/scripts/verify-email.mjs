import { randomUUID } from "node:crypto";
const org = "d5a1c100-0000-4000-8000-000000000001";
export async function verifyEmail(client) {
  const one = async (sql, values = []) =>
    (await client.query(sql, values)).rows[0];
  const assert = (ok) => {
    if (!ok) {
      const e = Error("Email integration verification failed");
      e.code = "EMAIL_VERIFY_FAILED";
      throw e;
    }
  };
  const customerId = randomUUID(),
    messageId = randomUUID(),
    replyId = randomUUID(),
    providerId = `verify-${randomUUID()}`,
    templateId = randomUUID(),
    leadId = randomUUID();
  await client.query("savepoint email_verification");
  try {
    const actor = await one(
      "select s.user_id from public.dmcrm_staff s join public.dmcrm_members m on m.org_id=s.org_id and m.user_id=s.user_id where s.org_id=$1 and s.active and m.active and s.role='owner' limit 1",
      [org],
    );
    assert(actor?.user_id);
    const command = (p) =>
      client.query("select public.dmcrm_command($1,$2,$3::jsonb)", [
        org,
        actor.user_id,
        JSON.stringify(p),
      ]);
    const recipient = `verify-${customerId}@example.invalid`;
    await client.query(
      "insert into public.dmcrm_customers(id,org_id,name,email,phone,source) values($1,$2,'Email verification fixture',$3,'2025550199','Internal verification')",
      [customerId, org, recipient],
    );
    await command({
      type: "save_message",
      id: messageId,
      revision: 0,
      customer_id: customerId,
      opportunity_id: null,
      task_id: null,
      quote_id: null,
      channel: "email",
      recipient,
      subject: "Internal verification",
      body: "This transaction is rolled back. No email is sent.",
    });
    assert(
      !(await one(
        "select * from public.dmcrm_email_outbox where message_id=$1",
        [messageId],
      )),
    );
    await client.query("select public.dmcrm_queue_email($1,$2,$3,0,'[]')", [
      org,
      actor.user_id,
      messageId,
    ]);
    await client.query("select public.dmcrm_queue_email($1,$2,$3,0,'[]')", [
      org,
      actor.user_id,
      messageId,
    ]);
    const claim = await one("select * from public.dmcrm_email_claim($1)", [
      messageId,
    ]);
    assert(claim?.message_id === messageId && claim.recipient === recipient);
    assert(
      !(await one("select * from public.dmcrm_email_claim($1)", [messageId])),
    );
    await client.query("select public.dmcrm_email_delivery($1,'delivered')", [
      providerId,
    ]);
    assert(
      (
        await one("select public.dmcrm_email_finish($1,$2,'sent',$3,null) ok", [
          messageId,
          claim.claim_token,
          providerId,
        ])
      ).ok,
    );
    assert(
      (
        await one("select status from public.dmcrm_messages where id=$1", [
          messageId,
        ])
      ).status === "delivered",
    );
    for (let i = 0; i < 2; i++)
      assert(
        (
          await one(
            "select public.dmcrm_email_receive($1,$2,$3,'Re: verification','Verified reply',now()) ok",
            [claim.reply_token, replyId, recipient],
          )
        ).ok,
      );
    assert(
      Number(
        (
          await one(
            "select count(*) n from public.dmcrm_messages where provider_id=$1",
            [replyId],
          )
        ).n,
      ) === 1,
    );
    assert(
      !(
        await one(
          "select public.dmcrm_email_receive($1,$2,'unrelated@example.invalid','No','No',now()) ok",
          [claim.reply_token, randomUUID()],
        )
      ).ok,
    );
    await command({
      type: "save_email_template",
      id: templateId,
      revision: 0,
      template: {
        name: "Verification fixture",
        category: "New lead",
        subject: "Thank you {{first_name}}",
        body: "Hi {{first_name}}, a team member will be in touch shortly.",
      },
    });
    const cfg = await one(
      "select * from public.dmcrm_email_settings where org_id=$1",
      [org],
    );
    await command({
      type: "save_email_settings",
      revision: cfg.revision,
      enabled: true,
      template_id: templateId,
      signature: "Drive Max verification fixture",
    });
    await client.query("select public.submit_lead($1::jsonb)", [
      JSON.stringify({
        requestId: leadId,
        kind: "contact",
        name: "Verification Customer",
        email: `verify-${leadId}@example.invalid`,
        phone: "2025550198",
        preferredContact: "Email",
        message: "Internal email verification; rolled back.",
      }),
    ]);
    const auto = await one(
      "select m.body,m.status,q.state from public.dmcrm_email_autoreplies a join public.dmcrm_messages m on m.id=a.message_id join public.dmcrm_website_intake q on q.id=a.intake_id where a.intake_id=$1",
      [leadId],
    );
    assert(
      auto?.state === "imported" &&
        auto.status === "queued" &&
        auto.body.includes("Hi Verification,"),
    );
  } finally {
    await client.query("rollback to savepoint email_verification");
    await client.query("release savepoint email_verification");
  }
  assert(
    !(await one("select id from public.dmcrm_customers where id=$1", [
      customerId,
    ])),
  );
  assert(
    !(await one(
      "select message_id from public.dmcrm_email_outbox where message_id=$1",
      [messageId],
    )),
  );
  assert(!(await one("select id from public.leads where id=$1", [leadId])));
}
