import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // This repository sits beside other JavaScript projects. Pinning the root keeps
  // Next's file tracing and development bundler inside this app.
  outputFileTracingRoot: process.cwd(),
  outputFileTracingIncludes: {
    "/api/cron/refresh-deals": [
      "./scripts/fetch-publix.mjs",
      "./costco/fetch-weekly-deals.mjs",
      "./wholefoods/fetch-weekly-deals.mjs",
    ],
  },
  turbopack: { root: process.cwd() },
};

export default nextConfig;
