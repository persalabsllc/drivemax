import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  canDesk,
  canManage,
  canRunCommand,
  canAccessView,
  canReadDealFile,
  roleLabel,
} from "../lib/permissions";
import {
  restrictWorkspace,
  managementTables,
  deskingTables,
} from "../lib/workspace-permissions";
import { readWorkspaceRecords } from "../lib/workspace-records";
import { demoWorkspace } from "../lib/demo";
import {
  commandSchema,
  demoCommand,
  defaultQuote,
  type Workspace,
} from "../lib/model";
import { staffSchema, mayManageStaff } from "../lib/team";
import { InventoryView } from "../components/Inventory";
import { OpportunityForm } from "../components/OpportunityForm";
import { ProtectionWorkspace } from "../components/ProtectionWorkspace";
import { QuickQuote } from "../components/QuickQuote";
import { inventorySnapshot } from "../lib/vehicles";

const now = new Date("2026-10-31T16:00:00Z");
const noop = () => {};
function workspace(role: string) {
  const ws = demoWorkspace(now);
  ws.member.role = role;
  return ws;
}
test("Finance Manager has deal capabilities independently of administration; sales and unknown roles fail closed", () => {
  assert.equal(roleLabel("finance"), "Finance Manager");
  for (const role of ["owner", "manager", "finance", "sales", "unknown"]) {
    assert.equal(canManage(role), ["owner", "manager"].includes(role));
    assert.equal(canDesk(role), ["owner", "manager", "finance"].includes(role));
    for (const view of [
      "Management reports",
      "Sales reports",
      "Accounting",
      "Money owed",
      "Appraisals",
    ])
      assert.equal(canAccessView(role, view), canManage(role));
    for (const view of ["Desking", "F&I Products"])
      assert.equal(canAccessView(role, view), canDesk(role));
    for (const type of [
      "save_quote",
      "convert_quick_quote",
      "issue_protection_batch",
      "pay_protection_claim",
    ])
      assert.equal(canRunCommand(role, { type }), canDesk(role));
    for (const type of [
      "save_staff",
      "save_inventory",
      "save_product_pricing",
      "save_management_report",
      "save_accounting",
      "save_email_settings",
      "save_workflow_rule",
      "merge_customers",
    ])
      assert.equal(canRunCommand(role, { type }), canManage(role));
  }
  assert(!canRunCommand("finance", { type: "future_admin_command" }));
  assert(
    !canRunCommand("sales", { type: "save_message", quote_id: "saved-quote" }),
  );
  assert(canRunCommand("sales", { type: "save_message", quote_id: null }));
  assert(commandSchema.options.length > 70);
  const input = {
    first_name: "Test",
    last_name: "Finance",
    email: "finance@example.invalid",
    phone: "2525550100",
    address1: "123 Example Street",
    address2: "",
    city: "New Bern",
    state: "NC",
    zip: "28562",
    role: "finance",
  };
  assert.equal(staffSchema.parse(input).role, "finance");
  assert(
    !mayManageStaff(
      { role: "finance", user_id: "f" },
      { role: "sales", user_id: "s" },
    ),
  );
  assert(
    !mayManageStaff(
      { role: "manager", user_id: "m" },
      { role: "finance", user_id: "f" },
    ),
  );
  assert(
    mayManageStaff(
      { role: "owner", user_id: "o" },
      { role: "finance", user_id: "f" },
    ),
  );
});

test("workspace responses and exports remove costs, snapshots and reports without changing source records", () => {
  const ws = workspace("sales");
  const originalInventory = structuredClone(ws.inventory);
  const c = ws.customers[0],
    o = ws.opportunities[0];
  c.vehicle_details = { ...ws.inventory[0] };
  o.sale_snapshot = {
    customer: structuredClone(c),
    quote: ws.quotes[0],
    insurance: null,
  };
  o.paperwork = { internal: { cost: "PRIVATE" } };
  for (const table of [...managementTables, ...deskingTables])
    if (!ws[table]?.length)
      (ws as any)[table] = [{ id: table, private: "SECRET" }];
  const sales = restrictWorkspace(ws);
  assert.deepEqual(
    ws.inventory,
    originalInventory,
    "redaction does not zero out costs in the authoritative source",
  );
  assert.equal(sales.quotes.length, 0);
  assert.equal(sales.commissions?.length, 0);
  for (const table of [...managementTables, ...deskingTables])
    assert.equal(sales[table]?.length, 0, table);
  for (const v of sales.inventory) {
    assert(!("cost" in v));
    assert(!("recon" in v));
  }
  assert.equal(
    inventorySnapshot(sales.inventory[0]).cost,
    null,
    "sales can still select a vehicle of interest",
  );
  assert(!("cost" in sales.customers[0].vehicle_details!));
  assert(!("quote" in sales.opportunities[0].sale_snapshot!));
  assert(
    !(
      "cost" in sales.opportunities[0].sale_snapshot!.customer.vehicle_details!
    ),
  );
  assert(!("paperwork" in sales.opportunities[0]));
  assert(!JSON.stringify(sales).includes("SECRET"));
  ws.member.role = "finance";
  const finance = restrictWorkspace(ws);
  assert(finance.quotes.length > 0);
  assert(finance.protection_contracts!.length > 0);
  assert.equal(finance.inventory[0].cost, originalInventory[0].cost);
  for (const table of managementTables)
    assert.equal(finance[table]?.length, 0, table);
  ws.member.role = "owner";
  assert.equal(restrictWorkspace(ws), ws, "owner keeps full data");
});

test("restricted tables are never queried and unstructured nested costs are removed before returning data", async () => {
  const ws = demoWorkspace(now),
    queries: string[] = [];
  const client = {
    from(table: string) {
      queries.push(table);
      const q = {
        select() {
          return q;
        },
        eq() {
          return q;
        },
        is() {
          return q;
        },
        order() {
          return q;
        },
        async range() {
          return {
            data: (ws as any)[table.replace("dmcrm_", "")] ?? [],
            error: null,
          };
        },
      };
      return q;
    },
  };
  const sales = await readWorkspaceRecords(client as any, {
    org_id: ws.org.id,
    staff_id: ws.member.staff_id!,
    role: "sales",
  });
  assert(sales.inventory.length > 0);
  assert(!JSON.stringify(sales.inventory).includes('"cost":'));
  for (const table of [...managementTables, ...deskingTables])
    assert(!queries.includes("dmcrm_" + table), table);
  queries.length = 0;
  const finance = await readWorkspaceRecords(client as any, {
    org_id: ws.org.id,
    staff_id: ws.member.staff_id!,
    role: "finance",
  });
  assert(finance.quotes.length > 0);
  assert(queries.includes("dmcrm_protection_contracts"));
  for (const table of managementTables)
    assert(!queries.includes("dmcrm_" + table), table);
});

test("sales vehicle screens omit financial fields and inventory editing; finance has F&I and profit tools", () => {
  const sales = restrictWorkspace(workspace("sales"));
  const inventory = renderToStaticMarkup(
    createElement(InventoryView, {
      inventory: sales.inventory,
      onAdd: noop,
      onEdit: noop,
      showCosts: false,
      canEdit: false,
      websiteConnected: true,
    }),
  );
  assert(
    !/Total invested|<th>Cost| invested|Edit stock|Control Room|Add vehicle/.test(
      inventory,
    ),
  );
  assert(inventory.includes("Asking price"));
  const opportunity = renderToStaticMarkup(
    createElement(OpportunityForm, {
      existing: sales.opportunities[0],
      staff: sales.staff,
      defaultAssignee: sales.member.staff_id!,
      manager: false,
      inventory: sales.inventory,
      busy: false,
      error: "",
      demo: true,
      showCosts: false,
      submit: async () => {},
    }),
  );
  assert(
    !/Vehicle cost|Reconditioning cost|Trade ACV|actual cash value|internal/.test(
      opportunity,
    ),
  );
  const finance = restrictWorkspace(workspace("finance"));
  const fi = renderToStaticMarkup(
    createElement(ProtectionWorkspace, {
      ws: finance,
      run: async () => ({ ok: true }),
      busy: false,
      demo: true,
    }),
  );
  assert(fi.includes("Quote / issue products"));
  assert.equal(
    renderToStaticMarkup(
      createElement(ProtectionWorkspace, {
        ws: sales,
        run: async () => ({ ok: true }),
        busy: false,
        demo: true,
      }),
    ),
    "",
  );
  const quote = renderToStaticMarkup(
    createElement(QuickQuote, {
      ws: finance,
      busy: false,
      error: "",
      onClose: noop,
      onPrint: noop,
      onCreate: async () => ({ ok: true }),
      onComplete: noop,
      demo: true,
      onClearError: noop,
    }),
  );
  assert.match(quote, /Show profit/);
});

test("demo commands enforce role boundaries and restricted document downloads are denied", () => {
  const finance = workspace("finance"),
    c = finance.customers[0],
    o = finance.opportunities[0];
  const quote = {
    type: "save_quote" as const,
    customer_id: c.id,
    opportunity_id: o.id,
    vehicle: o.vehicle_interest,
    values: { ...defaultQuote },
  };
  const next = demoCommand(finance, quote, now);
  assert.equal(next.quotes.length, finance.quotes.length + 1);
  assert.throws(
    () => demoCommand(workspace("sales"), quote, now),
    /access required/,
  );
  for (const role of ["sales", "finance"])
    assert.throws(() =>
      demoCommand(
        workspace(role),
        { type: "save_management_report", report: {} } as any,
        now,
      ),
    );
  assert(!canReadDealFile("sales", { kind: "purchase", opportunity_id: o.id }));
  assert(!canReadDealFile("sales", { kind: "packet", opportunity_id: o.id }));
  assert(canReadDealFile("sales", { kind: "insurance", opportunity_id: o.id }));
  assert(canReadDealFile("finance", { kind: "packet", opportunity_id: o.id }));
  assert(
    !canReadDealFile("finance", { kind: "purchase", opportunity_id: null }),
  );
});
