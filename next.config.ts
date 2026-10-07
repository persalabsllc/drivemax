import type { NextConfig } from "next";
const config: NextConfig = {
  outputFileTracingIncludes: {
    "/api/control-room/appraisals": [
      "./supabase/migrations/202610060001_appraisals.sql",
    ],
  },
  images: {
    remotePatterns: process.env.NEXT_PUBLIC_SUPABASE_URL
      ? [
          {
            protocol: "https",
            hostname: new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname,
            pathname: "/storage/v1/object/public/vehicle-photos/**",
          },
        ]
      : [],
  },
};
export default config;
