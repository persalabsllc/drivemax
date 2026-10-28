import { randomUUID } from "node:crypto";

// Runs inside the release transaction. All fixtures, reminder jobs, and file
// metadata roll back; no uploads or external messages are sent.
export async function verifyCustomerLinks(client) {
  const org = "d5a1c100-0000-4000-8000-000000000001";
  const one = async (sql, args = []) => (await client.query(sql, args)).rows[0];
  const check = (ok, step) => {
    if (!ok)
      throw Object.assign(Error(`Customer relationships: ${step}`), {
        code: "CUSTOMER_LINK_VERIFY_FAILED",
      });
  };
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  await client.query("savepoint customer_links_verification");
  try {
    const owner = await one(
      "select s.id,s.user_id from public.dmcrm_staff s join public.dmcrm_members m on m.org_id=s.org_id and m.user_id=s.user_id where s.org_id=$1 and s.active and m.active and s.role='owner' limit 1",
      [org],
    );
    check(owner?.id, "owner");
    const cmd = async (p) =>
      (
        await one("select public.dmcrm_command($1,$2,$3::jsonb) id", [
          org,
          owner.user_id,
          JSON.stringify(p),
        ])
      ).id;
    const row = async (table, id) =>
      (
        await one(
          `select to_jsonb(t) data from public.dmcrm_${table} t where id=$1`,
          [id],
        )
      )?.data;
    const person = (first, last) => ({
      first_name: first,
      middle_name: "",
      last_name: last,
      suffix: "",
      phone: "",
      email: "",
      license_state: "NC",
      license_number: "",
      address1: "",
      address2: "",
      city: "",
      state: "NC",
      zip: "",
      county: "",
      mailing_different: false,
      mailing_address1: "",
      mailing_address2: "",
      mailing_city: "",
      mailing_state: "",
      mailing_zip: "",
    });
    const details = (name, phone, email) => ({
      name,
      phone,
      email,
      source: "Other",
      status: "new",
      vehicle_interest: "Verification vehicle",
      trade_vehicle: "",
      birthday: null,
      initial_opportunity: true,
    });
    const targetId = await cmd({
      type: "create_customer",
      customer: {
        ...details(
          "Merge verification current",
          "2525550101",
          "current@example.invalid",
        ),
        co_buyer_link: { mode: "new", person: person("Co-buyer", "First") },
      },
    });
    let target = await row("customers", targetId);
    const co1 = target.co_buyer_id;
    check(co1 && co1 !== targetId, "independent co-buyer profile");
    check(
      Number(
        (
          await one(
            "select count(*) n from public.dmcrm_opportunities where customer_id=$1",
            [co1],
          )
        ).n,
      ) === 0,
      "co-buyer has no new sales lead",
    );
    check(
      Number(
        (
          await one(
            "select count(*) n from public.dmcrm_attention_items($1,$2) where kind='lead' and customer_id=$3",
            [org, owner.user_id, co1],
          )
        ).n,
      ) === 0,
      "no co-buyer lead alert",
    );
    let first = (
      await one(
        "select to_jsonb(o) data from public.dmcrm_opportunities o where customer_id=$1",
        [targetId],
      )
    ).data;
    check(first.co_buyer_id === co1, "initial opportunity linked");
    const secondId = await cmd({
      type: "create_opportunity",
      customer_id: targetId,
      opportunity: {
        title: "Second verification deal",
        source: "Other",
        status: "working",
        inventory_id: null,
        vehicle_interest: "Second vehicle",
        vehicle_details: null,
        trade: null,
        trade_vehicle: "",
      },
    });
    await cmd({
      type: "set_co_buyer",
      opportunity_id: first.id,
      expected_updated_at: first.updated_at,
      link: { mode: "none" },
    });
    check(
      (await row("opportunities", first.id)).co_buyer === null &&
        (await row("opportunities", secondId)).co_buyer_id === co1,
      "removal is scoped to one opportunity",
    );
    check(!!(await row("customers", co1)), "removing link retains profile");
    first = await row("opportunities", first.id);
    await cmd({
      type: "save_paperwork",
      opportunity_id: first.id,
      revision: first.paperwork_revision,
      paperwork: {
        $common: {
          "co_buyer.name": "Previous person",
          "buyers.names": "Previous people",
          "buyer.name": "Primary correction",
          "deal.balance": "999",
        },
        "bill-of-sale": { cobuyer_name: "Previous person" },
      },
    });
    await cmd({
      type: "set_co_buyer",
      opportunity_id: first.id,
      expected_updated_at: first.updated_at,
      link: { mode: "new", person: person("Co-buyer", "Second") },
    });
    first = await row("opportunities", first.id);
    check(
      first.paperwork.$common["buyer.name"] === "Primary correction" &&
        !first.paperwork.$common["co_buyer.name"] &&
        !first.paperwork.$common["buyers.names"] &&
        !first.paperwork["bill-of-sale"].cobuyer_name,
      "only old co-buyer print overrides cleared",
    );
    const co2 = first.co_buyer_id;
    const firstQuote = await cmd({
      type: "save_quote",
      customer_id: targetId,
      opportunity_id: first.id,
      vehicle: first.vehicle_interest,
      values: {
        price: 10000,
        docFee: 499,
        tax: 300,
        titleFee: 114,
        tradeAllowance: 0,
        addOns: 0,
        payoff: 0,
        downPayment: 1000,
        apr: 5,
        months: 60,
        acv: 0,
        recon: 0,
        fiMenu: {
          version: 1,
          products: [],
          packages: ["Premium", "Plus", "Standard", "Basic"].map((name) => ({
            name,
            product_ids: [],
          })),
          selected: null,
        },
      },
    });
    check(
      (await row("quotes", firstQuote)).values.fiMenu.co_buyer_name ===
        "Co-buyer Second",
      "F&I menu uses the deal co-buyer, not profile default",
    );
    await cmd({ type: "close_opportunity", id: first.id, outcome: "sold" });
    first = await row("opportunities", first.id);
    check(
      first.sale_snapshot.customer.co_buyer_id === co2 &&
        first.sale_snapshot.customer.co_buyer.last_name === "Second",
      "sale records the selected deal co-buyer",
    );
    await client.query(
      "update public.dmcrm_customers set name='Co-buyer revised',person=jsonb_set(person,'{last_name}','\"Revised\"') where id=$1",
      [co1],
    );
    check(
      (await row("opportunities", secondId)).co_buyer.last_name === "Revised",
      "active links refresh from own profile",
    );
    await client.query(
      "update public.dmcrm_customers set name='Co-buyer later',person=jsonb_set(person,'{last_name}','\"Later\"') where id=$1",
      [co2],
    );
    check(
      (await row("opportunities", first.id)).co_buyer.last_name === "Second",
      "closed co-buyer stays recorded",
    );

    const sourceId = await cmd({
      type: "create_customer",
      customer: {
        ...details(
          "Merge verification legacy",
          "2525550102",
          "legacy@example.invalid",
        ),
        co_buyer_link: { mode: "existing", customer_id: co1 },
      },
    });
    const sourceOpp = await one(
      "select * from public.dmcrm_opportunities where customer_id=$1",
      [sourceId],
    );
    await cmd({
      type: "save_quote",
      customer_id: sourceId,
      opportunity_id: sourceOpp.id,
      vehicle: sourceOpp.vehicle_interest,
      values: {
        price: 10000,
        docFee: 499,
        tax: 300,
        titleFee: 114,
        tradeAllowance: 0,
        addOns: 0,
        payoff: 0,
        downPayment: 1000,
        apr: 5,
        months: 60,
        acv: 0,
        recon: 0,
      },
    });
    await cmd({ type: "close_opportunity", id: sourceOpp.id, outcome: "sold" });
    const sale = await one(
      "select * from public.dmcrm_sales where opportunity_id=$1",
      [sourceOpp.id],
    );
    const title = await one(
      "select * from public.dmcrm_title_cases where opportunity_id=$1",
      [sourceOpp.id],
    );
    const fileId = randomUUID(),
      messageId = randomUUID(),
      appointmentId = randomUUID(),
      token = randomUUID();
    await client.query(
      "insert into public.dmcrm_deal_files(id,org_id,customer_id,opportunity_id,name,kind,size,mime,path,created_by) values($1,$2,$3,$4,'Merge verification.pdf','title',100,'application/pdf',$5,$6)",
      [
        fileId,
        org,
        sourceId,
        sourceOpp.id,
        `${org}/verification/${fileId}.pdf`,
        owner.user_id,
      ],
    );
    await client.query(
      "insert into public.dmcrm_messages(id,org_id,customer_id,opportunity_id,channel,direction,status,recipient,body,created_by) values($1,$2,$3,$4,'email','inbound','received','legacy@example.invalid','Merge verification correspondence',$5)",
      [messageId, org, sourceId, sourceOpp.id, owner.user_id],
    );
    await client.query(
      "insert into public.dmcrm_appointments(id,org_id,customer_id,opportunity_id,assigned_to,kind,starts_at,duration_minutes,created_by) values($1,$2,$3,$4,$5,'paperwork',now()+interval '3 days',30,$6)",
      [appointmentId, org, sourceId, sourceOpp.id, owner.id, owner.user_id],
    );
    await client.query(
      "insert into public.dmcrm_workflow_contacts(org_id,customer_id,token) values($1,$2,$3)",
      [org, sourceId, token],
    );
    await client.query(
      "insert into public.dmcrm_workflow_pauses(org_id,customer_id,paused) values($1,$2,true)",
      [org, sourceId],
    );
    await client.query(
      "update public.dmcrm_customers set email_opt_out=true where id=$1",
      [sourceId],
    );
    await client.query(
      "insert into public.dmcrm_facebook_contacts(org_id,page_id,sender_id,customer_id,opportunity_id) values($1,$2,$3,$4,$5)",
      [org, `qa-${fileId}`, `qa-${messageId}`, sourceId, sourceOpp.id],
    );
    const fileBefore = await row("deal_files", fileId);
    const quoteBefore = (
      await client.query(
        "select id,values,vehicle_details,trade_snapshot from public.dmcrm_quotes where customer_id in($1,$2) order by id",
        [sourceId, targetId],
      )
    ).rows;
    const jobsBefore = Number(
      (
        await one(
          "select count(*) n from public.dmcrm_workflow_jobs where customer_id in($1,$2)",
          [sourceId, targetId],
        )
      ).n,
    );
    target = await row("customers", targetId);
    const source = await row("customers", sourceId);
    const merge = {
      type: "merge_customers",
      source_id: sourceId,
      target_id: targetId,
      source_updated_at: source.updated_at,
      target_updated_at: target.updated_at,
      details_from: "source",
      confirmed: true,
    };
    check((await cmd(merge)) === targetId, "merge returned kept ID");
    check((await cmd(merge)) === targetId, "merge retry is idempotent");
    const after = await row("customers", targetId);
    check(
      after.name === source.name && after.email_opt_out,
      "reviewed identity and opt-out retained",
    );
    check(
      (await row("customers", sourceId)).merged_into === targetId,
      "source archived as alias",
    );
    check(
      same((await row("sales", sale.id)).snapshot, sale.snapshot),
      "sale snapshot unchanged",
    );
    check(
      same(
        (await row("opportunities", first.id)).sale_snapshot,
        first.sale_snapshot,
      ),
      "other sold snapshot unchanged",
    );
    const fileAfter = await row("deal_files", fileId);
    check(
      fileAfter.customer_id === targetId &&
        same({ ...fileAfter, customer_id: sourceId }, fileBefore),
      "file only reparented, original metadata retained",
    );
    check(
      (await row("title_cases", title.id)).customer_id === targetId &&
        (await row("title_cases", title.id)).customer_name ===
          title.customer_name,
      "title-work identity preserved",
    );
    check(
      (await row("messages", messageId)).customer_id === targetId &&
        (await row("messages", messageId)).body ===
          "Merge verification correspondence",
      "correspondence retained",
    );
    check(
      (await row("appointments", appointmentId)).customer_id === targetId,
      "appointment moved",
    );
    check(
      (
        await one(
          "select customer_id from public.dmcrm_facebook_contacts where org_id=$1 and page_id=$2",
          [org, `qa-${fileId}`],
        )
      ).customer_id === targetId,
      "Facebook identity moved",
    );
    check(
      same(
        (
          await client.query(
            "select id,values,vehicle_details,trade_snapshot from public.dmcrm_quotes where customer_id=$1 order by id",
            [targetId],
          )
        ).rows,
        quoteBefore,
      ),
      "quotes not recalculated",
    );
    check(
      Number(
        (
          await one(
            "select count(*) n from public.dmcrm_workflow_jobs where customer_id=$1",
            [targetId],
          )
        ).n,
      ) === jobsBefore,
      "merge creates no extra workflows",
    );
    check(
      (
        await one(
          "select paused from public.dmcrm_workflow_pauses where org_id=$1 and customer_id=$2",
          [org, targetId],
        )
      ).paused,
      "paused workflows remain paused",
    );
    check(
      Number(
        (
          await one(
            "select count(*) n from public.dmcrm_customer_merges where org_id=$1 and source_id=$2",
            [org, sourceId],
          )
        ).n,
      ) === 1,
      "one durable merge audit",
    );
    check(
      (
        await one(
          "select count(*) n from public.dmcrm_customer_aliases where org_id=$1 and customer_id=$2 and email='current@example.invalid'",
          [org, targetId],
        )
      ).n > 0,
      "overwritten target contact remains searchable",
    );

    // An old unsubscribe link and an in-flight request using the duplicate ID still work.
    await client.query(
      "update public.dmcrm_customers set email_opt_out=false where id=$1",
      [targetId],
    );
    check(
      (await one("select public.dmcrm_public_unsubscribe($1,true) ok", [token]))
        .ok && (await row("customers", targetId)).email_opt_out,
      "old unsubscribe token follows merge",
    );
    const late = await cmd({
      type: "add_activity",
      customer_id: sourceId,
      kind: "note",
      body: "Late request after merge",
    });
    check(
      (await row("activities", late)).customer_id === targetId,
      "stale customer ID resolves",
    );
    const inquiryId = randomUUID();
    await client.query(
      "insert into public.dmcrm_website_intake(id,org_id,message_id,payload,received_at) values($1,$2,$3,$4::jsonb,now())",
      [
        inquiryId,
        org,
        randomUUID(),
        JSON.stringify({
          name: "Merge verification current",
          email: "current@example.invalid",
          phone: "2525550101",
          kind: "contact",
          body: "Verification inquiry",
          details: {},
        }),
      ],
    );
    check(
      (
        await one("select public.dmcrm_import_website_inquiry($1) ok", [
          inquiryId,
        ])
      ).ok,
      "website inquiry imports after merge",
    );
    const inquiry = await row("website_intake", inquiryId);
    check(
      inquiry.customer_id === targetId &&
        !inquiry.created_customer &&
        !inquiry.match_review,
      "previous contact details find the kept profile",
    );
  } finally {
    await client.query("rollback to savepoint customer_links_verification");
    await client.query("release savepoint customer_links_verification");
  }
}
