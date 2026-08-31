import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Playwright drives a native browser binary and must not be bundled into a
  // route. It is loaded through a dynamic import on the server only.
  serverExternalPackages: ["playwright"],
};

export default nextConfig;
