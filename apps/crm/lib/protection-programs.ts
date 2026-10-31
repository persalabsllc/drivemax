// Program identifiers are persisted in menu snapshots and issued agreements.
export const protectionPlanIds = [
  "deluxe",
  "platinum",
  "maintenance",
  "tire_wheel",
  "pdr",
  "appearance",
  "key_replacement",
] as const;
export type ProtectionPlan = (typeof protectionPlanIds)[number];
export const protectionPlans: Record<ProtectionPlan, string> = {
  deluxe: "Deluxe",
  platinum: "Platinum",
  maintenance: "Prepaid maintenance",
  tire_wheel: "Tire & wheel",
  pdr: "Paintless dent repair",
  appearance: "Appearance protection",
  key_replacement: "Key replacement",
};
export const protectionKind = (plan: ProtectionPlan) =>
  plan === "deluxe" || plan === "platinum" ? "service_contract" : plan;
export const isMechanicalPlan = (plan: string) =>
  plan === "deluxe" || plan === "platinum";
export const protectionDescriptions: Record<ProtectionPlan, string> = {
  deluxe:
    "Listed engine, transmission, transfer case and drive axle powertrain components.",
  platinum:
    "Listed powertrain components plus alternator, water pump, thermostat, listed sensors and engine accessories.",
  maintenance:
    "Oil and filter change plus tire rotation, up to $125 combined per covered visit. The selected visit count applies.",
  tire_wheel:
    "Road-hazard tire and wheel damage from potholes, curbs and roadway objects; unrepairable punctures and damaged or cracked rims. Includes covered parts, labor, mounting and balancing.",
  pdr: "Paintless repair of eligible dents and dings no larger than a credit card, with intact paint and access for paintless repair.",
  appearance:
    "Eight years, unlimited mileage. Interior stains and tears; exterior paint fading, sun spots and damage from acid rain, bird droppings and tree sap.",
  key_replacement:
    "Replacement keys or key fobs, including cutting and programming. Maximum 3 over the contract and 2 in any rolling 12-month period.",
};
