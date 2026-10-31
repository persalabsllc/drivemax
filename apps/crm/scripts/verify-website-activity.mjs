import { randomUUID } from "node:crypto";
// Also runs during production migration, entirely inside a rolled-back savepoint.
export async function verifyWebsiteActivity(client) {
  const org = "d5a1c100-0000-4000-8000-000000000001",
    token = "a".repeat(64);
  const one = async (sql, args = []) => (await client.query(sql, args)).rows[0];
  const check = (ok, label) => {
    if (!ok) throw Error("Website activity: " + label);
  };
  const reject = async (fn) => {
    await client.query("savepoint activity_denied");
    let caught;
    try {
      await fn();
    } catch (e) {
      caught = e;
    }
    await client.query("rollback to savepoint activity_denied");
    check(caught?.code === "42501", "permission rejection");
  };
  await client.query("savepoint activity_verification");
  try {
    const owner = (
      await one(
        "select user_id from dmcrm_members where org_id=$1 and active and role='owner' limit 1",
        [org],
      )
    ).user_id;
    const day = (
      await one(
        "select to_char(now() at time zone 'America/New_York','YYYY-MM-DD') as day",
      )
    ).day;
    const users = {};
    for (const role of ["sales", "finance", "manager"]) {
      const user = randomUUID(),
        id = randomUUID();
      users[role] = { user, id };
      await client.query("insert into auth.users(id,email) values($1,$2)", [
        user,
        `${user}@example.invalid`,
      ]);
      await client.query(
        "insert into dmcrm_members(org_id,user_id,name,role) values($1,$2,$3,$4)",
        [org, user, "Fictional activity " + role, role],
      );
      await client.query(
        "insert into dmcrm_staff(id,org_id,user_id,name,role) values($1,$2,$3,$4,$5)",
        [id, org, user, "Fictional activity " + role, role],
      );
    }
    const vid = randomUUID(),
      slug = "activity-fixture-" + vid,
      path = "/inventory/" + slug,
      browser = randomUUID();
    await client.query(
      "insert into vehicles(id,slug,year,make,model,vin,stock_number,miles,internet_price,description,photos,status) values($1,$2,2018,'Fictional','Fixture',$3,$4,1000,4999,'Fictional vehicle used only in a rollback test.',array['fixture.webp'],'available')",
      [
        vid,
        slug,
        "1" + vid.replaceAll("-", "").slice(0, 16).toUpperCase(),
        "QA-" + vid,
      ],
    );
    const event = (kind = "page_view", p = path) => ({
      id: randomUUID(),
      kind,
      path: p,
    });
    const record = (events, id = browser, hash = token) =>
      client.query(
        "select dmcrm_web_record($1,$2,$3,$4::jsonb,'Facebook','Mobile')",
        [org, id, hash, JSON.stringify(events)],
      );
    const read = (actor = owner, customer = null, session = null) =>
      one("select dmcrm_web_read($1,$2,$3,$3,$4,$5,0,'',$6) value", [
        org,
        actor,
        day,
        session,
        customer,
        vid,
      ]).then((r) => r.value);
    const first = event();
    await record([
      first,
      event("photo_view"),
      { ...event("engagement"), seconds: 15 },
    ]);
    await record([first]);
    let data = await read();
    check(
      data.summary.visitors === 1 &&
        data.summary.visits === 1 &&
        data.summary.views === 1,
      "deduplicated initial visit",
    );
    check(
      data.vehicles[0].photo_views === 1 && data.summary.active_seconds === 15,
      "vehicle interaction and active time",
    );
    const sid = data.sessions[0].id;
    await record([
      event("page_view", "/control-room"),
      event("page_view", "/apply?secret=123"),
      event("page_view", "/inventory/nonexistent"),
      event("lead_submitted"),
    ]);
    check(
      (await read()).summary.views === 1,
      "unsafe routes and fake conversions rejected",
    );
    await reject(() => record([event()], browser, "b".repeat(64)));
    for (const role of ["sales", "finance"])
      await reject(() => read(users[role].user));
    await reject(() => read(randomUUID()));
    check(
      (await read(users.manager.user)).summary.views === 1,
      "manager report access",
    );
    const customer = randomUUID(),
      other = randomUUID(),
      opp = randomUUID(),
      lead = randomUUID();
    await client.query(
      "insert into dmcrm_customers(id,org_id,name,assigned_to) values($1,$2,'Fictional tracked customer',$3),($4,$2,'Other tracked customer',$5)",
      [customer, org, users.sales.id, other, users.finance.id],
    );
    await client.query(
      "insert into dmcrm_opportunities(id,org_id,customer_id,title,assigned_to) values($1,$2,$3,'Fictional tracked opportunity',$4)",
      [opp, org, customer, users.sales.id],
    );
    await client.query(
      "insert into dmcrm_website_intake(id,org_id,message_id,payload,received_at) values($1,$2,$3,'{}',now())",
      [lead, org, randomUUID()],
    );
    const link = (id = lead) =>
      client.query("select dmcrm_web_link($1,$2,$3,'form',$4)", [
        org,
        browser,
        token,
        id,
      ]);
    await link();
    await link();
    check(
      (await read()).summary.leads === 0,
      "pending intake not falsely counted as lead",
    );
    await client.query(
      "update dmcrm_website_intake set state='imported',customer_id=$2,opportunity_id=$3,activity_id=$4,imported_at=now() where id=$1",
      [lead, customer, opp, randomUUID()],
    );
    data = await read();
    check(
      data.summary.leads === 1 &&
        data.summary.form_submissions === 1 &&
        data.vehicles[0].lead_visits === 1,
      "durable conversion link and retry deduplication",
    );
    const appointment = randomUUID(),
      chat = randomUUID(),
      sale = randomUUID();
    await client.query(
      "insert into dmcrm_appointments(id,org_id,customer_id,opportunity_id,assigned_to,kind,starts_at,duration_minutes,status,created_by) values($1,$2,$3,$4,$5,'vehicle_viewing',now()+interval '7 days',30,'confirmed',$6)",
      [appointment, org, customer, opp, users.sales.id, owner],
    );
    await client.query(
      "insert into dmcrm_chat_threads(id,org_id,token_hash,customer_id,opportunity_id,appointment_id) values($1,$2,$3,$4,$5,$6)",
      [chat, org, token, customer, opp, appointment],
    );
    await client.query("select dmcrm_web_link($1,$2,$3,'chat',$4)", [
      org,
      browser,
      token,
      chat,
    ]);
    await client.query(
      "insert into dmcrm_sales(id,org_id,opportunity_id,customer_id,sold_on,snapshot,status) values($1,$2,$3,$4,current_date,'{}','sold')",
      [sale, org, opp, customer],
    );
    data = await read();
    check(
      data.summary.leads === 1 &&
        data.summary.chats === 1 &&
        data.summary.appointments === 1 &&
        data.summary.sales === 1,
      "form and chat share one lead, appointment and sale",
    );
    await client.query(
      "update dmcrm_appointments set status='canceled' where id=$1",
      [appointment],
    );
    await client.query("update dmcrm_sales set status='unwound' where id=$1", [
      sale,
    ]);
    data = await read();
    check(
      data.summary.appointments === 0 && data.summary.sales === 0,
      "canceled appointments and unwound sales excluded",
    );
    const mine = await read(users.sales.user, customer);
    check(
      mine.summary === null &&
        mine.vehicles.length === 0 &&
        mine.sessions.length === 1,
      "assigned customer history without global totals",
    );
    check(
      (await read(users.sales.user, customer, sid)).events.length === 2,
      "assigned timeline access",
    );
    await reject(() => read(users.finance.user, customer));
    await reject(() => read(users.sales.user, other));
    // A customer parameter cannot be used to read another customer's session.
    const second = randomUUID();
    await record([event()], second);
    const secondSession = (
      await one("select id from dmcrm_web_sessions where visitor_id=$1", [
        second,
      ])
    ).id;
    await reject(() => read(users.sales.user, customer, secondSession));
    await client.query(
      "update dmcrm_web_sessions set last_at=now()-interval '31 minutes' where id=$1",
      [sid],
    );
    await record([event()]);
    data = await read();
    check(
      data.summary.visitors === 2 &&
        data.summary.visits === 3 &&
        data.summary.returning_visits === 1,
      "inactivity splits visits, browser remains unique",
    );
    const latest = data.sessions.find(
      (s) => s.visitor_id === browser && s.id !== sid,
    );
    check(
      latest && !latest.lead,
      "return visit does not falsely count a new lead",
    );
    const detail = await read(owner, null, sid);
    check(
      detail.events.every((e) => !("token_hash" in e)),
      "timeline exposes no browser credential",
    );
    for (const role of ["anon", "authenticated"]) {
      check(
        !(
          await one(
            "select has_table_privilege($1,'dmcrm_web_events','select') allowed",
            [role],
          )
        ).allowed,
        "raw event privacy",
      );
      check(
        !(
          await one(
            "select has_function_privilege($1,'dmcrm_web_read(uuid,uuid,date,date,uuid,uuid,integer,text,uuid)','execute') allowed",
            [role],
          )
        ).allowed,
        "no direct browser report RPC",
      );
    }
    await client.query(
      "update dmcrm_web_sessions set last_at=now()-interval '181 days' where id=$1",
      [sid],
    );
    await client.query("select dmcrm_web_prune()");
    check(
      !(
        await one(
          "select exists(select 1 from dmcrm_web_events where session_id=$1) present",
          [sid],
        )
      ).present,
      "retention cascades events and links",
    );
  } finally {
    await client.query("rollback to savepoint activity_verification");
  }
}
