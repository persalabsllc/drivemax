import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEALER_ADMINISTRATION_FEE,
  formatVehiclePrice,
  totalVehiclePrice,
} from "../lib/vehicle-pricing";
import { inventoryMatches, type Vehicle } from "../lib/inventory";

test("the public total adds exactly $399 without changing the entered price", () => {
  const inventory = { internet_price: 7500 };
  assert.equal(DEALER_ADMINISTRATION_FEE, 399);
  assert.equal(totalVehiclePrice(inventory.internet_price), 7899);
  assert.equal(totalVehiclePrice(inventory.internet_price), 7899);
  assert.equal(inventory.internet_price, 7500);
  assert.equal(totalVehiclePrice(8500), 8899);
  assert.equal(totalVehiclePrice(7500.25), 7899.25);
  assert.equal(totalVehiclePrice(1), 400);
  assert.equal(totalVehiclePrice(2000000), 2000399);
});

test("price formatting keeps cents when needed and never rounds a total down to a whole dollar", () => {
  assert.equal(formatVehiclePrice(7500), "$7,500");
  assert.equal(formatVehiclePrice(DEALER_ADMINISTRATION_FEE), "$399");
  assert.equal(formatVehiclePrice(totalVehiclePrice(7500)), "$7,899");
  assert.equal(formatVehiclePrice(totalVehiclePrice(7500.01)), "$7,899.01");
  assert.equal(formatVehiclePrice(7899.5), "$7,899.50");
});

test("inventory budgets use the advertised total including the dealer fee", () => {
  const vehicle = {
    status: "available",
    internet_price: 9601,
    body_style: "Sedan",
    year: 2020,
    make: "Toyota",
    model: "Camry",
    trim: "LE",
    stock_number: "TEST001",
    features: [],
  } as unknown as Vehicle;
  assert.equal(inventoryMatches(vehicle, "", "", "10000"), true);
  assert.equal(
    inventoryMatches({ ...vehicle, internet_price: 9601.01 }, "", "", "10000"),
    false,
  );
  assert.equal(inventoryMatches(vehicle, "Toyota", "Sedan", "10000"), true);
  assert.equal(inventoryMatches(vehicle, "Honda", "", "10000"), false);
  assert.equal(inventoryMatches({ ...vehicle, status: "sold" }), false);
  assert.equal(inventoryMatches({ ...vehicle, internet_price: 20000 }), true);
});
