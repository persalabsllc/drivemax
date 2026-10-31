import type { ProtectionContract } from "./protection";
import { protectionPlans } from "./protection-programs";

// DM-ANC-2026-10-v1: retain this edition for every agreement issued against it.
const coverage = {
  maintenance: [
    [
      "Included maintenance",
      "We pay the reasonable, authorized charge for an engine oil and filter change and tire rotation, up to $125 COMBINED per covered visit, including covered parts, labor and applicable service taxes. This is not $125 for each operation. Use oil and a filter appropriate for the vehicle manufacturer's specification. The included visit count is shown on page 1. A visit uses one benefit even when the cost is less than $125 or a rotation cannot be performed because of the vehicle's tire configuration. Unused dollars from a visit do not carry forward.",
    ],
    [
      "Visit allowance",
      "You may redeem only the number of visits purchased. Follow the manufacturer's maintenance schedule; this agreement does not extend an oil-change interval or replace your maintenance responsibilities. The visit must occur before the date or mileage expiration, whichever applies first. You pay any amount above $125 and charges for services outside this agreement. No cash is paid in place of unused visits except an applicable cancellation refund.",
    ],
    [
      "Maintenance exclusions",
      "Other maintenance or repairs are not included: brakes, alignments, tire replacement, balancing unless expressly included in the authorized rotation, air or cabin filters, fuel treatments, flushes, transmission or differential services, coolant, spark plugs, wipers and breakdown repairs. Pre-existing damage and repairs resulting from improper maintenance are excluded. This agreement does not provide the separate Deluxe or Platinum mechanical-breakdown coverage.",
    ],
  ],
  tire_wheel: [
    [
      "Tires and road hazards",
      "We cover damage to a covered vehicle's tires caused by contact with potholes, curbs, objects or debris in the roadway and similar road hazards during ordinary driving. A puncture or piercing is covered when a qualified tire facility determines it cannot be safely patched under the tire manufacturer's repair requirements. We pay the reasonable, authorized cost of repair when appropriate, or replacement when the tire cannot be safely repaired, with comparable size, type and quality.",
    ],
    [
      "Wheels, parts and labor",
      "We cover rims or wheels cracked, bent or otherwise damaged by the road hazards described above. We authorize repair when it can safely restore the wheel, or a comparable replacement when it cannot. Covered charges include the covered tire or wheel parts, reasonable labor, mounting and balancing, and applicable taxes on the authorized work. Unrelated upgrades or replacement of undamaged matching tires or wheels are not included.",
    ],
    [
      "Tire and wheel exclusions",
      "Normal tread wear, dry rot, corrosion, age deterioration, pre-existing damage, manufacturing defects payable by another warranty, punctures that can safely be patched, theft, vandalism, collision damage beyond the covered road-hazard contact, racing, deliberate damage and off-road competition are excluded. Alignment, suspension, brakes and other vehicle systems are not covered. Damage caused by knowingly continuing to drive on a flat or unsafe wheel is excluded to the extent that continued driving caused additional damage.",
    ],
  ],
  pdr: [
    [
      "Credit-card-size dents",
      "We cover eligible dents, dings and creases in the exterior metal body panels of the covered vehicle when each damaged area fits within the footprint of a standard credit card: no more than 3.375 inches by 2.125 inches. Each dent is evaluated separately. Damage must occur during the term and be capable of repair using paintless dent repair while preserving the existing paint and finish.",
    ],
    [
      "Repair method",
      "A qualified paintless dent repair technician must be able to reach and repair the area using the paintless process. We pay the reasonable, authorized paintless-repair labor. The agreement does not promise a particular repair method will work on every panel or location. There is no stated numerical dent limit; every repair must meet the size, method and other eligibility requirements.",
    ],
    [
      "Dent exclusions",
      "Dents larger than the stated credit-card footprint; damaged, cracked or missing paint; torn or stretched metal that cannot be restored by paintless repair; inaccessible areas that cannot be safely reached; and repairs requiring panel replacement, sanding, body filler, bonding or repainting are excluded. Scratches, chips, corrosion, glass, trim and pre-existing dents are excluded. This is not collision or comprehensive vehicle insurance.",
    ],
  ],
  appearance: [
    [
      "Interior protection",
      "We cover stains and tears in the vehicle's interior upholstery and trim surfaces that occur during the agreement. Covered surfaces include fabric, carpet, leather and vinyl seat and interior trim surfaces. We authorize reasonable professional cleaning, stain removal or repair; when those methods cannot restore a covered damaged area, we may authorize restoration or replacement of that affected material with comparable material. The benefit addresses the damaged area, not replacement of undamaged matching interior sections.",
    ],
    [
      "Exterior paint protection",
      "We cover damage to the vehicle's exterior painted finish from fading, sun spots, acid rain, bird droppings and tree sap during the term. Covered remedies include professional cleaning, finish restoration, refinishing or repainting of the affected area as reasonably necessary to correct the covered damage. Remove contaminants promptly using the manufacturer's care instructions and avoid cleaners that can cause further damage. No particular chemical treatment is a condition of this edition.",
    ],
    [
      "Eight years, unlimited mileage",
      "Coverage lasts 96 months (eight years) from the issue date on page 1, with UNLIMITED MILEAGE. Only the expiration date ends the time term; a high odometer reading alone does not end coverage. There is no stated aggregate dollar or numerical repair limit for eligible appearance claims under this edition.",
    ],
    [
      "Appearance exclusions",
      "Pre-existing conditions; deliberate damage; burns; collision, fire, flood or vandalism; rust or structural corrosion; rock chips, scratches or dents unrelated to the listed covered causes; mechanical or electrical failures; and damage caused by improper repair or abrasive cleaning are excluded. Normal wear without a covered stain, tear or listed paint condition is excluded. Repairs are limited to the affected covered material or finish and do not increase the vehicle's original specification.",
    ],
  ],
  key_replacement: [
    [
      "Replacement keys and fobs",
      "We cover replacement of a key or key fob for the VIN on page 1 when it is lost, stolen or becomes inoperable during the term. The reasonable, authorized cost includes the replacement key or fob, required cutting and programming, and related labor and service taxes. A remote and mechanical blade supplied as one integrated replacement assembly count as one key; two separately issued replacement keys count as two.",
    ],
    [
      "Three total; two in twelve months",
      "The maximum benefit is THREE replacement keys over the entire contract, and no more than TWO in ANY ROLLING 12-MONTH PERIOD. This is not a calendar-year reset. The replacement service date controls the rolling period. Every key replaced counts toward both limits, including multiple keys in a single visit. A transfer, a new year or a later software change does not replenish benefits already used.",
    ],
    [
      "Key exclusions",
      "Additional spare keys when an eligible loss or failure has not occurred; pre-existing missing or inoperable keys; ordinary battery replacement alone; aftermarket upgrades; replacement of locks, ignition cylinders, security modules or unrelated vehicle electronics; theft of the vehicle; roadside dispatch and towing are excluded. Proof of ownership and identification may be required by the servicing locksmith or dealer. The service must occur during coverage even if payment is recorded later.",
    ],
  ],
} as const;

export function ancillaryTerms(c: ProtectionContract) {
  if (!(c.plan in coverage)) throw Error("Unknown ancillary agreement.");
  const specific = coverage[c.plan as keyof typeof coverage];
  const miles = c.term_miles === null;
  return [
    {
      title: "Coverage and exclusions",
      subtitle: `${protectionPlans[c.plan]} - this agreement covers only the selected product`,
      sections: [
        [
          "Our agreement",
          "Drive Max Used Cars LLC is the provider and administrator identified on page 1. We provide the expressly listed benefits for the single covered vehicle during the purchased term. Purchase is optional and is not required to buy a vehicle or obtain financing. This agreement is separate from any included dealer warranty, manufacturer warranty or other product agreement.",
        ],
        ...specific,
        [
          "Limits applying to this product",
          `Coverage starts on the date and odometer recorded on page 1. ${miles ? "There is no mileage expiration; coverage ends on the stated expiration date." : "Coverage ends on the stated expiration date or when the expiration odometer is reached, whichever happens first. Purchased miles are additional to the starting odometer."} The deductible is $0. ${c.plan === "maintenance" ? `The purchased allowance is ${c.maintenance_visits} visits at up to $125 each, for a maximum of $${c.claim_limit?.toFixed(2)} in covered services.` : c.plan === "key_replacement" ? "The key-count limits above apply. There is no separately stated aggregate dollar limit." : "There is no separately stated aggregate dollar limit; only reasonable, authorized costs for eligible covered work are paid."} Benefits do not extend the contract term. We do not pay an amount twice if another warranty or responsible party pays it.`,
        ],
      ],
    },
    {
      title: "Claims, cancellation and transfer",
      subtitle: "Keep these terms with the signed registration on page 1",
      sections: [
        [
          "Request service before authorizing work",
          "Contact Drive Max at the phone number on page 1 with the contract number, VIN, current odometer and a description of the concern. A qualified service facility must supply an itemized estimate and any photographs or measurements needed to establish eligibility. Obtain our authorization before work begins. You may use a qualified facility of your choice, subject to reasonable charges and prior authorization. If an emergency makes prior contact unreasonable, preserve documentation and contact us as soon as reasonably possible; a covered claim will not be denied solely for that reason.",
        ],
        [
          "Payment and records",
          "Provide the service date, odometer, itemized final invoice, authorization reference and proof of payment when requesting reimbursement. We may pay the facility or reimburse the contract holder for approved costs. You pay noncovered work and amounts beyond the stated benefit. Keep your agreement and receipts. Lost wages, inconvenience, diminished value, rental vehicles, towing, roadside assistance and consequential losses are not included, except where law requires otherwise. Deliberate material misrepresentation is a violation that may subject the agreement to cancellation as described below.",
        ],
        [
          "Cancel at any time",
          `Send a written cancellation request to the provider at the address on page 1 with your contract number, requested effective date and documented odometer reading. ${miles ? "The unused percentage is based on elapsed calendar days divided by the total calendar days in the term; mileage does not reduce the refund." : "The used percentage is the greater of elapsed calendar days divided by the total calendar days in the term, or miles driven since issuance divided by the purchased additional miles."} Usage is capped at 100%. Multiply the purchase price by the unused percentage, then subtract benefits or claims already paid and an administration fee equal to the LESSER of $100 or 10% of that prorated amount. The refund cannot be below $0. Benefits are not deducted twice. Taxes are handled as required by law. A financed agreement's refund may be paid to the lienholder; cancellation does not automatically reduce the loan payment.`,
        ],
        [
          "Provider cancellation and transfer",
          "We may cancel only for nonpayment or a direct violation expressly stated as grounds for cancellation, including deliberate material misrepresentation or deliberate odometer tampering that prevents eligibility determination. We will give written notice of the reason and effective date; we cannot cancel merely because a claim is expensive. Before expiration you may assign this agreement without a transfer fee to a subsequent vehicle purchaser meeting the same acceptance criteria. Send the new owner's contact details, ownership-transfer proof, transfer date and odometer. Time, mileage and used benefits do not restart.",
        ],
        [
          "Complete agreement and questions",
          "The completed registration and the coverage and claims terms on pages 2 and 3 form this product's agreement. Other products in the printing packet remain separate agreements with their own prices, benefits and cancellation calculations. Oral statements do not expand coverage. Changes require a written provider agreement and cannot remove rights required by law. Contact Drive Max for a written explanation of a claim decision. North Carolina law governs, subject to federal law. No binding arbitration or waiver of nonwaivable consumer rights is required. By signing page 1 you acknowledge receiving all three pages and the selected coverage, price and limits.",
        ],
      ],
    },
  ];
}
