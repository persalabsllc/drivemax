import type { NextConfig } from "next";
const config: NextConfig = {
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
