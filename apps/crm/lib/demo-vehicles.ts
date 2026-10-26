import { type InventoryVehicle, type DecodedVin } from "./vehicles";
const fixtures = [
  {
    vin: "1HGCM82633A004352",
    year: 2003,
    make: "Honda",
    model: "Accord",
    trim: "EX",
    mileage: 121400,
    price: 5995,
    cost: 3000,
    recon: 450,
    color: "Silver",
  },
  {
    vin: "1FTFW1ET1EFA00001",
    year: 2014,
    make: "Ford",
    model: "F-150",
    trim: "XLT",
    mileage: 146200,
    price: 12995,
    cost: 8700,
    recon: 650,
    color: "Blue",
  },
  {
    vin: "5N1AT2MV8GC000001",
    year: 2016,
    make: "Nissan",
    model: "Rogue",
    trim: "SV",
    mileage: 109800,
    price: 9995,
    cost: 6200,
    recon: 500,
    color: "White",
  },
];
export function demoInventory(
  org_id: string,
  today: string,
): InventoryVehicle[] {
  return fixtures.map((v, i) => {
    const d = new Date(today + "T12:00:00Z");
    d.setUTCDate(d.getUTCDate() - [12, 27, 43][i]);
    return {
      ...v,
      id: `00000000-0000-4000-8000-00000000008${i}`,
      org_id,
      stock_number: `DM-10${i + 1}`,
      acquired_on: d.toISOString().slice(0, 10),
      status: "in_stock",
      created_at: d.toISOString(),
      updated_at: d.toISOString(),
    };
  });
}
export function demoVinDecode(vin: string): DecodedVin | null {
  const v = fixtures.find((v) => v.vin === vin);
  return v
    ? {
        vin,
        year: v.year,
        make: v.make,
        model: v.model,
        trim: v.trim,
        body: "",
        warning: null,
      }
    : null;
}
