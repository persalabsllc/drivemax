import { demoInventory } from "./demo-vehicles";
import { type Workspace, dayKey, addDays, defaultQuote } from "./model";
export function demoWorkspace(now = new Date()): Workspace {
  const today = dayKey(now),
    stamp = now.toISOString(),
    org = "00000000-0000-4000-8000-000000000001";
  const ids = Array.from(
    { length: 6 },
    (_, i) => `00000000-0000-4000-8000-00000000001${i}`,
  );
  const names = [
    "Jordan Ellis",
    "Morgan Reed",
    "Alex Parker",
    "Taylor Brooks",
    "Jamie Bennett",
    "Casey Walker",
  ];
  const cars = [
    "2018 Honda Accord EX",
    "2017 Toyota RAV4 XLE",
    "2016 Chevrolet Silverado",
    "2019 Kia Sorento LX",
    "2018 Ford Escape SE",
    "2017 Nissan Altima SV",
  ];
  const statuses = [
    "appointment",
    "working",
    "new",
    "sold",
    "working",
    "new",
  ] as const;
  const customers = names.map((name, i) => ({
    id: ids[i],
    org_id: org,
    name,
    email: name.toLowerCase().replace(" ", ".") + "@example.com",
    phone: `(252) 555-010${i}`,
    source: ["Website", "Walk-in", "Referral", "Facebook", "Phone", "Website"][
      i
    ],
    status: statuses[i],
    vehicle_interest: cars[i],
    trade_vehicle:
      i === 0
        ? "2012 Honda Civic · 142,000 mi"
        : i === 1
          ? "2011 Ford Explorer · 168,000 mi"
          : "",
    birthday: i === 4 ? today.replace(/^\d{4}/, "1988") : null,
    sold_on: i === 3 ? today : null,
    created_at: addDays(today, -i) + "T14:00:00Z",
    updated_at: stamp,
  }));
  const visits = [
    {
      id: "00000000-0000-4000-8000-000000000020",
      org_id: org,
      customer_id: ids[0],
      arrived_at: new Date(now.getTime() - 32 * 60000).toISOString(),
      departed_at: null,
      outcome: "browsing" as const,
    },
    {
      id: "00000000-0000-4000-8000-000000000021",
      org_id: org,
      customer_id: ids[1],
      arrived_at: new Date(now.getTime() - 75 * 60000).toISOString(),
      departed_at: null,
      outcome: "browsing" as const,
    },
    {
      id: "00000000-0000-4000-8000-000000000022",
      org_id: org,
      customer_id: ids[3],
      arrived_at: new Date(now.getTime() - 140 * 60000).toISOString(),
      departed_at: new Date(now.getTime() - 80 * 60000).toISOString(),
      outcome: "sold" as const,
    },
  ];
  return {
    org: { id: org, name: "Drive Max Used Cars", slug: "drive-max" },
    member: { id: "demo", name: "Kyle Kratoville", role: "owner" },
    customers,
    inventory: demoInventory(org, today),
    visits,
    tasks: [
      {
        id: "00000000-0000-4000-8000-000000000030",
        org_id: org,
        customer_id: ids[0],
        title: "Appointment · Honda Accord",
        due_date: today,
        kind: "appointment",
        completed_at: null,
        canceled_at: null,
      },
      {
        id: "00000000-0000-4000-8000-000000000031",
        org_id: org,
        customer_id: ids[2],
        title: "Check in after yesterday’s inquiry",
        due_date: addDays(today, -1),
        kind: "unsold_followup",
        completed_at: null,
        canceled_at: null,
      },
      {
        id: "00000000-0000-4000-8000-000000000032",
        org_id: org,
        customer_id: ids[4],
        title: "Jamie Bennett · birthday",
        due_date: today,
        kind: "birthday",
        completed_at: null,
        canceled_at: null,
      },
      {
        id: "00000000-0000-4000-8000-000000000033",
        org_id: org,
        customer_id: ids[3],
        title: "2-day sold follow-up",
        due_date: addDays(today, 2),
        kind: "sold_followup",
        completed_at: null,
        canceled_at: null,
      },
    ],
    activities: [
      {
        id: "00000000-0000-4000-8000-000000000040",
        org_id: org,
        customer_id: ids[0],
        kind: "note",
        body: "Looking for a reliable daily driver. Interested in the Accord. Has a Civic to trade and would like to compare payment options.",
        created_at: stamp,
        created_by: "Kyle Kratoville",
      },
      {
        id: "00000000-0000-4000-8000-000000000041",
        org_id: org,
        customer_id: ids[0],
        kind: "call",
        body: "Connected · Confirmed today’s appointment. Customer plans to bring their trade.",
        created_at: addDays(today, -1) + "T15:00:00Z",
        created_by: "Kyle Kratoville",
      },
      {
        id: "00000000-0000-4000-8000-000000000042",
        org_id: org,
        customer_id: ids[3],
        kind: "system",
        body: "Deal marked sold. Follow-up tasks created.",
        created_at: stamp,
        created_by: "Kyle Kratoville",
      },
    ],
    quotes: [
      {
        id: "00000000-0000-4000-8000-000000000050",
        org_id: org,
        customer_id: ids[0],
        vehicle: cars[0],
        values: {
          ...defaultQuote,
          price: 13995,
          tradeAllowance: 2800,
          downPayment: 1500,
          acv: 2500,
          recon: 650,
        },
        created_at: stamp,
      },
    ],
  };
}
