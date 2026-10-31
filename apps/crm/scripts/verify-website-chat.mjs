import { randomUUID } from "node:crypto";
// Runs entirely inside a savepoint: no test customers, chats or bookings remain.
export async function verifyWebsiteChat(client) {
  const org = "d5a1c100-0000-4000-8000-000000000001";
  const one = async (sql, args = []) => (await client.query(sql, args)).rows[0];
  const check = (ok, label) => {
    if (!ok) throw Error("Website chat: " + label);
  };
  const reject = async (fn, code) => {
    await client.query("savepoint chat_denied");
    let error;
    try {
      await fn();
    } catch (e) {
      error = e;
    }
    await client.query("rollback to savepoint chat_denied");
    check(
      error && (!code || error.code === code),
      "expected rejection " + (code || ""),
    );
  };
  const call = async (id, action, data = {}, token = "a".repeat(64)) =>
    (
      await one("select dmcrm_chat_public($1,$2,$3,$4,$5::jsonb) value", [
        org,
        id,
        token,
        action,
        JSON.stringify(data),
      ])
    ).value;
  const staff = async (actor, action, data = {}) =>
    (
      await one("select dmcrm_chat_staff($1,$2,$3,$4::jsonb) value", [
        org,
        actor,
        action,
        JSON.stringify(data),
      ])
    ).value;
  const finish = async (id, run, body = "AI reply") =>
    client.query(
      "select dmcrm_chat_finish($1,$2,$3,$4,$5::jsonb,$6,100,50,true)",
      [org, id, run, body, "{}", 0.001],
    );
  await client.query("savepoint chat_verification");
  try {
    const owner = (
      await one(
        "select user_id from dmcrm_members where org_id=$1 and active and role='owner' limit 1",
        [org],
      )
    ).user_id;
    const people = [];
    for (const role of ["sales", "finance"]) {
      const user = randomUUID(),
        id = randomUUID();
      people.push({ user, id });
      await client.query("insert into auth.users(id,email) values($1,$2)", [
        user,
        `chat-${user}@example.invalid`,
      ]);
      await client.query(
        "insert into dmcrm_members(org_id,user_id,name,role) values($1,$2,$3,$4)",
        [org, user, "Chat " + role, role],
      );
      await client.query(
        "insert into dmcrm_staff(id,org_id,user_id,name,role) values($1,$2,$3,$4,$5)",
        [id, org, user, "Chat " + role, role],
      );
    }
    await client.query(
      "update dmcrm_chat_settings set enabled=true,ai_enabled=true,booking_enabled=true,monthly_budget=25,assigned_to=$2 where org_id=$1",
      [org, people[0].id],
    );
    const id = randomUUID();
    let snapshot = await call(id, "start");
    check(snapshot.messages.length === 1, "greeting");
    await reject(() => call(id, "read", {}, "b".repeat(64)), "42501");
    await reject(() => staff(randomUUID(), "list"), "42501");
    await reject(() => staff(people[0].user, "settings", {}), "42501");
    await reject(() => staff(people[1].user, "settings", {}), "42501");
    const run = randomUUID();
    snapshot = await call(id, "message", {
      request_id: run,
      body: "Is the Tahoe available?",
      intent: "availability",
    });
    check(snapshot.run_id === run, "budget reservation");
    await call(id, "message", { request_id: run, body: "retry" });
    check(
      (
        await one(
          "select count(*)::int n from dmcrm_chat_messages where thread_id=$1 and sender='visitor'",
          [id],
        )
      ).n === 1,
      "idempotent visitor message",
    );
    await staff(people[0].user, "take", { id });
    await finish(id, run, "SHOULD NOT APPEAR");
    snapshot = await call(id, "read");
    check(
      !snapshot.messages.some((m) => m.body === "SHOULD NOT APPEAR"),
      "takeover fences in-flight AI",
    );
    await reject(() => staff(people[1].user, "read", { id }), "42501");
    check(
      !(await staff(people[1].user, "list")).threads.some((t) => t.id === id),
      "assigned transcript hidden from other staff",
    );
    const reply = randomUUID();
    await staff(people[0].user, "reply", {
      id,
      request_id: reply,
      body: "Hello from sales",
    });
    await staff(people[0].user, "reply", {
      id,
      request_id: reply,
      body: "Hello from sales",
    });
    check(
      (await call(id, "read")).messages.filter((m) => m.sender === "staff")
        .length === 1,
      "idempotent staff reply",
    );
    const person = {
      name: "Fictional Chat " + id,
      email: `${id}@example.invalid`,
      phone: "2525550199",
      consent: true,
    };
    await reject(() => call(id, "contact", { ...person, consent: false }));
    await reject(() => call(id, "contact", { ...person, consent: undefined }));
    await call(id, "contact", person);
    await call(id, "contact", person);
    const t = await one("select * from dmcrm_chat_threads where id=$1", [id]);
    check(t.customer_id && t.opportunity_id, "atomic CRM lead");
    check(
      (
        await one(
          "select count(*)::int n from dmcrm_tasks where origin_key=$1",
          ["website-chat:" + id],
        )
      ).n === 1,
      "single follow-up task",
    );
    const second = randomUUID();
    await call(second, "start");
    await call(second, "contact", person);
    check(
      (
        await one("select customer_id from dmcrm_chat_threads where id=$1", [
          second,
        ])
      ).customer_id === t.customer_id,
      "repeat contact reuses customer",
    );
    check(
      !JSON.stringify(await call(id, "read")).includes(t.customer_id),
      "public result hides private CRM IDs",
    );
    const slots = (await call(id, "slots")).slots;
    check(slots.length > 0, "real appointment choices");
    await reject(() =>
      call(id, "book", { starts_at: slots[0].starts_at, confirmed: false }),
    );
    const booked = await call(id, "book", {
      starts_at: slots[0].starts_at,
      confirmed: true,
    });
    check(booked.appointment.status === "confirmed", "appointment saved");
    await call(id, "book", { starts_at: slots[1].starts_at, confirmed: true });
    check(
      (
        await one(
          "select count(*)::int n from dmcrm_appointments where customer_id=$1",
          [t.customer_id],
        )
      ).n === 1,
      "booking retries do not duplicate",
    );
    await reject(() =>
      call(second, "book", { starts_at: slots[0].starts_at, confirmed: true }),
    );
    await reject(() =>
      call(second, "book", {
        starts_at: "2020-01-01T12:00:00Z",
        confirmed: true,
      }),
    );
    const ap = await one(
      "select * from dmcrm_appointments where id=(select appointment_id from dmcrm_chat_threads where id=$1)",
      [id],
    );
    check(
      ap.created_by === null && ap.booking_source === "website_chat",
      "honest automated provenance",
    );
    await staff(people[0].user, "release", { id });
    await client.query(
      "update dmcrm_chat_settings set monthly_budget=0 where org_id=$1",
      [org],
    );
    snapshot = await call(id, "message", {
      request_id: randomUUID(),
      body: "Please help",
    });
    check(
      snapshot.state === "waiting" && !snapshot.run_id,
      "zero budget fails over without provider call",
    );
    await staff(owner, "close", { id });
    await reject(() =>
      call(id, "message", { request_id: randomUUID(), body: "Closed" }),
    );
    await client.query(
      "update dmcrm_chat_threads set expires_at=now()-interval '1 minute' where id=$1",
      [second],
    );
    await reject(() => call(second, "read"), "42501");
    const roles = await one(
      "select has_function_privilege('anon','dmcrm_chat_public(uuid,uuid,text,text,jsonb)','execute') a,has_function_privilege('authenticated','dmcrm_chat_staff(uuid,uuid,text,jsonb)','execute') b,has_table_privilege('anon','dmcrm_chat_messages','select') c",
    );
    check(!roles.a && !roles.b && !roles.c, "no public database access");
  } finally {
    await client.query("rollback to savepoint chat_verification");
    await client.query("release savepoint chat_verification");
  }
}
