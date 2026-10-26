import { z } from "zod";
const text = z.string().trim().max(250);
export const personSchema = z.object({
  first_name: text,
  middle_name: text,
  last_name: text,
  suffix: text.max(20),
  license_state: text.max(2),
  license_number: text.max(40),
  address1: text,
  address2: text,
  city: text,
  state: text.max(2),
  zip: text.max(15),
  county: text,
  mailing_different: z.boolean(),
  mailing_address1: text,
  mailing_address2: text,
  mailing_city: text,
  mailing_state: text.max(2),
  mailing_zip: text.max(15),
  phone: text.max(30),
  email: z.union([z.email().max(250), z.literal("")]),
});
export type Person = z.infer<typeof personSchema>;
export const blankPerson: Person = {
  first_name: "",
  middle_name: "",
  last_name: "",
  suffix: "",
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
  mailing_state: "NC",
  mailing_zip: "",
  phone: "",
  email: "",
};
export function fullName(p: Partial<Person>) {
  return [p.first_name, p.middle_name, p.last_name, p.suffix]
    .filter(Boolean)
    .join(" ");
}
export function personFromCustomer(c: {
  name: string;
  phone?: string;
  email?: string;
  person?: Person | null;
}): Person {
  if (c.person)
    return {
      ...blankPerson,
      ...c.person,
      phone: c.phone || c.person.phone || "",
      email: c.email || c.person.email || "",
    };
  const parts = c.name.trim().split(/\s+/);
  const suffix = /^(jr\.?|sr\.?|ii|iii|iv|v)$/i.test(parts.at(-1) || "")
    ? parts.pop()!
    : "";
  return {
    ...blankPerson,
    first_name: parts.shift() || "",
    last_name: parts.length > 1 ? parts.pop()! : parts.shift() || "",
    middle_name: parts.join(" "),
    suffix,
    phone: c.phone || "",
    email: c.email || "",
  };
}
const policyDate = z.union([z.literal(""), z.iso.date()]);
export const insuranceSchema = z
  .object({
    company: text,
    agent: text,
    agent_phone: text.max(30),
    agent_email: z.union([z.email().max(250), z.literal("")]),
    agent_address: text,
    policy_number: text,
    effective_from: policyDate,
    effective_to: policyDate,
    collision_deductible: z.number().min(0).max(100000).nullable(),
    comprehensive_deductible: z.number().min(0).max(100000).nullable(),
  })
  .refine(
    (v) =>
      !v.effective_from ||
      !v.effective_to ||
      v.effective_to >= v.effective_from,
    { message: "The policy end date must be on or after its start date." },
  );
export type Insurance = z.infer<typeof insuranceSchema>;
export const blankInsurance: Insurance = {
  company: "",
  agent: "",
  agent_phone: "",
  agent_email: "",
  agent_address: "",
  policy_number: "",
  effective_from: "",
  effective_to: "",
  collision_deductible: null,
  comprehensive_deductible: null,
};
export function mailingAddress(p: Person) {
  return p.mailing_different
    ? {
        address1: p.mailing_address1,
        address2: p.mailing_address2,
        city: p.mailing_city,
        state: p.mailing_state,
        zip: p.mailing_zip,
      }
    : {
        address1: p.address1,
        address2: p.address2,
        city: p.city,
        state: p.state,
        zip: p.zip,
      };
}

export const buyerSchema = personSchema.refine(
  (p) => !!p.first_name && !!p.last_name,
  { message: "Enter the buyer’s first and last name." },
);
export const coBuyerSchema = buyerSchema.refine(
  (p) =>
    !!p.license_state &&
    !!p.license_number &&
    !!p.address1 &&
    !!p.city &&
    !!p.state &&
    !!p.zip &&
    (!p.mailing_different ||
      (!!p.mailing_address1 &&
        !!p.mailing_city &&
        !!p.mailing_state &&
        !!p.mailing_zip)),
  {
    message: "Complete the co-buyer’s license, residence, and mailing address.",
  },
);
