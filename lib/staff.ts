export type StaffProfile = {
  id: string;
  name: string;
  firstName: string;
  role: string;
  email: string;
  image: string;
  imageAlt: string;
  bio: readonly [string, ...string[]];
};

export type StaffDepartment = {
  id: "sales" | "management" | "accounting" | "detail" | "mechanics";
  name: string;
  description: string;
  profiles: readonly StaffProfile[];
};

// Add future colleagues to the appropriate profiles array. Every department
// uses the same card and responsive grid, including departments currently empty.
// Alex, Morgan, and Jordan are fictional concepts; retain the directory notice.
export const staffDepartments: readonly StaffDepartment[] = [
  {
    id: "sales",
    name: "Sales",
    description:
      "Vehicle questions, test drives, and help finding the right fit for your needs and budget.",
    profiles: [
      {
        id: "alex-carter",
        name: "Alex Carter",
        firstName: "Alex",
        role: "Sales Consultant",
        email: "sales@drivemaxusedcars.com",
        image: "/staff/alex-carter-illustrative.webp",
        imageAlt:
          "AI-generated portrait of fictional sales profile Alex Carter, wearing a black Nike polo with the Drive Max logo",
        bio: [
          "Alex is a car enthusiast who enjoys weekend road trips and easy conversations. His approach is simple: listen first, answer questions clearly, and help shoppers find a vehicle that fits everyday life.",
        ],
      },
    ],
  },
  {
    id: "management",
    name: "Management",
    description:
      "Guidance through your options and a direct point of contact for questions about your Drive Max experience.",
    profiles: [
      {
        id: "kyle-kratoville",
        name: "Kyle Kratoville",
        firstName: "Kyle",
        role: "General Manager",
        email: "kyle@drivemaxusedcars.com",
        image: "/staff/kyle-kratoville-team.webp",
        imageAlt:
          "Kyle Kratoville wearing a black Nike polo with the Drive Max Used Cars logo",
        bio: [
          "Born and raised on Long Island, New York, Kyle made New Bern home on July 4, 2012. He still jokes that the city’s fireworks were a welcome party just for him. With 14 years in the car business, he loves every part of it, especially meeting new people.",
          "Outside the dealership, Kyle enjoys boating on the Neuse River, getting on the air as a ham radio operator, and tending to his fish tanks. At home, two dogs and a cat help keep life interesting.",
          "Have a question about buying, selling, or leasing a vehicle? Want to share your experience with Drive Max Used Cars? Give Kyle a call or send him an email. He’s always happy to help.",
        ],
      },
    ],
  },
  {
    id: "accounting",
    name: "Accounting",
    description:
      "Purchase records, billing questions, and paperwork explained clearly.",
    profiles: [
      {
        id: "morgan-ellis",
        name: "Morgan Ellis",
        firstName: "Morgan",
        role: "Accounting Coordinator",
        email: "sales@drivemaxusedcars.com",
        image: "/staff/morgan-ellis-illustrative.webp",
        imageAlt:
          "AI-generated portrait of fictional accounting profile Morgan Ellis, wearing a black Nike polo with the Drive Max logo",
        bio: [
          "Morgan likes a tidy spreadsheet almost as much as a good cup of coffee. A weekend gardener with a calm, friendly approach, she believes paperwork should feel straightforward and every question deserves a clear answer.",
        ],
      },
    ],
  },
  {
    id: "detail",
    name: "Detail",
    description:
      "Interior and exterior care, with attention to the finishing touches.",
    profiles: [
      {
        id: "jordan-bennett",
        name: "Jordan Bennett",
        firstName: "Jordan",
        role: "Detail Technician",
        email: "sales@drivemaxusedcars.com",
        image: "/staff/jordan-bennett-illustrative.webp",
        imageAlt:
          "AI-generated portrait of fictional detail profile Jordan Bennett, wearing a black Nike polo with the Drive Max logo",
        bio: [
          "Jordan enjoys bringing out the best in a vehicle, from clean glass to the finishing touches inside. A music lover and hands-on hobbyist, he takes pride in the little details that make a car feel ready for its next chapter.",
        ],
      },
    ],
  },
  {
    id: "mechanics",
    name: "Mechanics",
    description:
      "Vehicle preparation, maintenance, and repair work that help keep the focus on quality.",
    profiles: [],
  },
];
