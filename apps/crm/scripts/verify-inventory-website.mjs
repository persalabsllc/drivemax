import { randomUUID } from "node:crypto";

/** Verify the real CRM trigger and Control Room records inside the caller's
 * transaction. Every inventory/listing fixture is rolled back before commit. */
export async function verifyInventoryWebsite(client) {
  const marker = randomUUID().replaceAll("-", "");
  const vin = ("2" + marker.slice(0, 16)).toUpperCase();
  const org = "d5a1c100-0000-4000-8000-000000000001";
  const check = (ok) => {
    if (!ok)
      throw Object.assign(new Error("Inventory website verification failed"), {
        code: "INVENTORY_WEBSITE_CHECK_FAILED",
      });
  };
  const listing = async (id) =>
    (
      await client.query(
        `select q.state,v.* from public.dmcrm_inventory_website q join public.vehicles v on v.id=q.website_id where q.inventory_id=$1`,
        [id],
      )
    ).rows[0];
  await client.query("savepoint inventory_website_check");
  try {
    const {
      rows: [i],
    } = await client.query(
      `insert into public.dmcrm_inventory(org_id,year,make,model,vin,stock_number,mileage,color,cost,recon,price,acquired_on)
       values($1,2020,'Fixture','Sync',$2,$3,25000,'Blue',7000,500,10000,current_date) returning id`,
      [org, vin, "SYNC-" + marker],
    );
    const created = await listing(i.id);
    check(
      created?.state === "synced" &&
        created.status === "draft" &&
        created.vin === vin &&
        Number(created.internet_price) === 10000 &&
        created.photos.length === 0,
    );
    await client.query(
      "update public.vehicles set internet_price=12500,description='Temporary verification listing; always rolled back.',photos=array['fixture/photo.webp'],status='available' where id=$1",
      [created.id],
    );
    await client.query(
      "update public.dmcrm_inventory set mileage=26000,price=11000,recon=750 where id=$1",
      [i.id],
    );
    const edited = await listing(i.id);
    check(
      edited.id === created.id &&
        edited.miles === 26000 &&
        Number(edited.internet_price) === 12500 &&
        edited.photos[0] === "fixture/photo.webp",
    );
    await client.query(
      "update public.dmcrm_inventory set status='sold' where id=$1",
      [i.id],
    );
    check((await listing(i.id)).status === "sold");
    await client.query(
      "update public.vehicles set status='available' where id=$1",
      [created.id],
    );
    check((await listing(i.id)).status === "sold");
    await client.query(
      "update public.dmcrm_inventory set status='in_stock' where id=$1",
      [i.id],
    );
    check((await listing(i.id)).status === "draft");
    check(
      Number(
        (
          await client.query(
            "select count(*) n from public.vehicles where vin=$1",
            [vin],
          )
        ).rows[0].n,
      ) === 1,
    );
  } finally {
    await client.query("rollback to savepoint inventory_website_check");
    await client.query("release savepoint inventory_website_check");
  }
}
