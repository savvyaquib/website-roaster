import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Playwright drives a native browser binary and must not be bundled into a
  // route. It is loaded through a dynamic import on the server only.
  // Both are server-only and heavy: Playwright drives a native browser binary,
  // and axe-core carries the whole engine as a ~1.3 MB source string.
  serverExternalPackages: ["playwright", "axe-core"],
};

export default nextConfig;
