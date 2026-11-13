export type OpenPosition = {
  slug: string;
  title: string;
  schedule: string;
  location: string;
  earnings: string;
  summary: string;
  overview: string;
  compensation: string;
  advancement: string;
  responsibilities: { title: string; items: string[] }[];
  qualifications: string[];
};

export const openPositions: OpenPosition[] = [
  {
    slug: "automotive-sales-consultant",
    title: "Automotive Sales Consultant",
    schedule: "Full-time",
    location: "New Bern, NC · On-site",
    earnings: "$24,000–$75,000 per year",
    summary:
      "Put customers first, guide them through the buying process, and help keep our vehicles and dealership ready for the next opportunity.",
    overview:
      "Drive Max Used Cars is looking for a motivated, dependable Automotive Sales Consultant who enjoys helping people and takes pride in a job well done. At our family-owned dealership, you’ll be involved in the entire customer experience—from the first inquiry to delivery and follow-up—and lend a hand with the day-to-day work that keeps a small dealership running. Customer service is our number one priority.",
    compensation:
      "Commission-based pay with a biweekly draw against earned commissions, paid every two weeks. Estimated total annual earnings are $24,000–$75,000, depending on sales performance and bonuses. This is an earnings estimate, not a guaranteed salary. We’ll discuss the commission, draw, and bonus details during the interview process.",
    advancement:
      "The right person has the opportunity to grow into the store’s General Sales Manager role. We’re looking for someone who can earn customer trust, deliver consistent results, take ownership of their work, and develop into a leader as the business grows.",
    responsibilities: [
      {
        title: "Sales & customer care",
        items: [
          "Provide friendly, attentive service before, during, and after the sale. Listen to customers, answer questions honestly, and help them choose a vehicle that fits their needs.",
          "Prospect for new business through outreach, referrals, and online channels; respond promptly to incoming leads and follow up consistently.",
          "Handle phone, email, online, and in-person inquiries; schedule appointments, present vehicles and pricing, show cars, and coordinate test drives.",
          "Complete trade-in appraisals, document vehicle condition and details, and work with management on valuations and deal terms.",
          "Prepare and print accurate deal paperwork, keep customer and follow-up records organized, and help make each vehicle delivery smooth and professional.",
          "Explain and sell optional products, including service contracts and prepaid maintenance, with clear information about pricing and coverage so customers can make informed choices.",
        ],
      },
      {
        title: "Vehicle presentation & dealership support",
        items: [
          "Perform light vehicle preparation, including cleaning windows, vacuuming, and keeping vehicles presentable for customers.",
          "Apply dealership stickers and place required dealership information and marketing materials on vehicles.",
          "Photograph vehicles, post them for sale, and help keep online listings accurate and up to date.",
          "Safely shuttle vehicles to and from the mechanic, take vehicles to the car wash, and help coordinate vehicle readiness.",
          "Help keep the lot and customer areas neat, organized, and welcoming, and pitch in with other everyday dealership tasks.",
        ],
      },
    ],
    qualifications: [
      "A customer-first attitude, clear communication, and a professional, dependable approach to work.",
      "Initiative, strong follow-through, attention to detail, and the ability to stay organized while handling multiple responsibilities.",
      "Comfort with phone calls, email, online vehicle listings, and learning dealership software.",
      "A valid driver’s license and the ability to safely operate and transport dealership vehicles.",
      "Willingness to handle both sales responsibilities and hands-on vehicle preparation. Automotive, retail sales, or customer service experience is helpful.",
    ],
  },
];

export function positionPath(slug: string) {
  return `/about/employment/${encodeURIComponent(slug)}`;
}

export function findOpenPosition(slug: string) {
  return openPositions.find((position) => position.slug === slug);
}
