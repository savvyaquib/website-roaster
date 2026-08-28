import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Analyzer dependencies that must not be bundled (e.g. the browser driver in
  // Phase 3) are added to `serverExternalPackages` when those phases land.
};

export default nextConfig;
