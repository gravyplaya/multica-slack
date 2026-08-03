import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  experimental: {
    // No experimental flags needed for the Stage 1 shell; the typed-data and
    // realtime work in later stages can revisit this section deliberately
    // rather than leave speculative toggles on.
  },
};

export default nextConfig;
