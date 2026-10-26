import { randomUUID } from "node:crypto";

/** Exercise the public website's real intake procedure, then discard every
 * fixture. No HTTP/email provider is invoked; uncommitted outbox rows cannot
 * be claimed by the website notification worker. Caller owns the transaction. */
export async function verifyWebsiteIntake(client) {
  const org = "d5a1c100-0000-4000-8000-000000000001";
  const marker = randomUUID();
  const vin = ("1" + marker.replaceAll("-", "").slice(0, 16)).toUpperCase();
  const requestIds = [randomUUID(), randomUUID(), randomUUID()];
  await client.query("savepoint website_intake_check");
  try {
    const {
      rows: [websiteVehicle],
    } = await client.query(
      `insert into public.vehicles(slug,year,make,model,vin,stock_number,miles,internet_price)
       values($1,2020,'Fixture','Vehicle',$2,$1,25000,10000) returning id`,
      ["crm-check-" + marker, vin],
    );
    const {
      rows: [inventoryVehicle],
    } = await client.query(
      `insert into public.dmcrm_inventory(org_id,year,make,model,vin,stock_number,mileage,cost,price,acquired_on)
       values($1,2020,'Fixture','Vehicle',$2,$3,25000,7000,10000,current_date) returning id`,
      [org, vin, "CRM-CHECK-" + marker],
    );
    for (const [index, id] of requestIds.entries()) {
      const payload = {
        requestId: id,
        kind: index ? "vehicle" : "contact",
        name: "CRM connection check " + marker + " " + index,
        email: `${id}@example.invalid`,
        phone: `202555010${index}`,
        preferredContact: "Phone call",
        message: "Temporary connection check; rolled back before commit.",
        smsConsent: "not_provided",
        ...(index === 1
          ? {
              vehicleId: websiteVehicle.id,
              purpose: "test-drive",
              originalVehicleVin: vin,
              originalVehicleTitle: "2020 Fixture Vehicle",
              preferredVisit: "Tomorrow afternoon",
            }
          : index === 2
            ? {
                purpose: "purchase-offer",
                sellerYear: "2020",
                sellerMake: "Fixture",
                sellerModel: "Vehicle",
                sellerVin: vin,
                sellerMiles: "25000",
                condition: "Good",
                titleStatus: "Clean title",
              }
            : {}),
      };
      await client.query("select public.submit_lead($1::jsonb)", [
        JSON.stringify(payload),
      ]);
      // A browser retry must not create another CRM opportunity or task.
      await client.query("select public.submit_lead($1::jsonb)", [
        JSON.stringify(payload),
      ]);
    }
    const { rows } = await client.query(
      `select q.id,q.state,o.inventory_id,o.status,
        (select count(*)::int from public.dmcrm_tasks t where t.org_id=q.org_id and t.origin_key='website:'||q.id) tasks,
        (select count(*)::int from public.dmcrm_activities a where a.id=q.activity_id and a.customer_id=q.customer_id and a.opportunity_id=q.opportunity_id) activities
       from public.dmcrm_website_intake q join public.dmcrm_opportunities o on o.id=q.opportunity_id and o.org_id=q.org_id
       where q.id=any($1::uuid[])`,
      [requestIds],
    );
    if (
      rows.length !== 3 ||
      rows.some(
        (r) =>
          r.state !== "imported" ||
          r.status !== "new" ||
          r.tasks !== 1 ||
          r.activities !== 1 ||
          r.inventory_id !==
            (r.id === requestIds[1] ? inventoryVehicle.id : null),
      )
    )
      throw Object.assign(new Error("Website intake verification failed"), {
        code: "WEBSITE_INTAKE_CHECK_FAILED",
      });
  } finally {
    await client.query("rollback to savepoint website_intake_check");
    await client.query("release savepoint website_intake_check");
  }
}
