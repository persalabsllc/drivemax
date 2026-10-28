import { z } from "zod";
import { buyerSchema, personFromCustomer } from "./people";
import type { Customer, Workspace } from "./model";

export const coBuyerLinkSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("none") }),
  z.object({ mode: z.literal("existing"), customer_id: z.uuid() }),
  z.object({ mode: z.literal("new"), person: buyerSchema }),
]);
export type CoBuyerLink = z.infer<typeof coBuyerLinkSchema>;
export type CustomerAlias = {
  id: string;
  org_id: string;
  customer_id: string;
  name: string;
  email: string;
  phone: string;
  merged_at: string;
};
export const customerLinkCommands = [
  z.object({
    type: z.literal("set_co_buyer"),
    opportunity_id: z.uuid(),
    expected_updated_at: z.string().min(1).max(50),
    link: coBuyerLinkSchema,
  }),
  z
    .object({
      type: z.literal("merge_customers"),
      source_id: z.uuid(),
      target_id: z.uuid(),
      source_updated_at: z.string().min(1).max(50),
      target_updated_at: z.string().min(1).max(50),
      details_from: z.enum(["source", "target"]),
      confirmed: z.literal(true),
    })
    .refine((v) => v.source_id !== v.target_id, {
      message: "Choose two different customer profiles.",
    }),
] as const;
export const customerLinkErrors = [
  "Choose two different customer profiles.",
  "Confirm these profiles belong to the same person.",
  "Customer profiles changed. Refresh and review the merge again.",
  "This customer was merged. Refresh to open the kept profile.",
  "Check one profile out of the showroom before merging two active visits.",
  "Remove the co-buyer link between these profiles before merging them.",
  "A customer cannot be their own co-buyer.",
  "Co-buyer profile unavailable. Refresh and choose a customer.",
  "Enter the co-buyer’s first and last name.",
  "Deal changed. Refresh before changing the co-buyer.",
  "Closed deals keep their original co-buyer.",
  "Assigned salesperson or manager required",
  "Manager access required",
];

export function coBuyerSelection(c: {
  co_buyer_id?: string | null;
  co_buyer?: Customer["person"];
}): CoBuyerLink {
  return c.co_buyer_id
    ? { mode: "existing", customer_id: c.co_buyer_id }
    : c.co_buyer
      ? { mode: "new", person: c.co_buyer }
      : { mode: "none" };
}

// Use one person's identity/address together; fill missing contact fields only.
// The unselected details remain in the merge audit and searchable aliases.
export function mergedCustomerDetails(
  target: Customer,
  source: Customer,
  from: "source" | "target",
) {
  const primary = from === "source" ? source : target;
  const other = from === "source" ? target : source;
  const phone = primary.phone || other.phone;
  const email = primary.email || other.email;
  return {
    name: primary.name,
    phone,
    email,
    person: { ...personFromCustomer(primary), phone, email },
    birthday: primary.birthday || other.birthday,
    source: primary.source || other.source,
    insurance: primary.insurance || other.insurance || null,
    email_opt_out: !!(target.email_opt_out || source.email_opt_out),
  };
}

export function customerRecordCounts(ws: Workspace, id: string) {
  return {
    deals: ws.opportunities.filter((o) => o.customer_id === id).length,
    sold: ws.opportunities.filter(
      (o) => o.customer_id === id && o.status === "sold",
    ).length,
    messages:
      (ws.messages ?? []).filter((m) => m.customer_id === id).length +
      (ws.facebook_messages ?? []).filter((m) => m.customer_id === id).length,
    notes: ws.activities.filter((a) => a.customer_id === id).length,
    files: (ws.deal_files ?? []).filter((f) => f.customer_id === id).length,
  };
}
