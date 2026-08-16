import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // sharp, pg-boss and pg are server-only native/node packages; keep them
  // out of the client bundle and let Node resolve them at runtime.
  serverExternalPackages: ["sharp", "pg-boss", "pg", "archiver"],
  images: {
    // Derivatives are pre-sized WebP served from storage; Next image
    // optimization would double-process them.
    unoptimized: true,
  },
  async headers() {
    return [
      {
        // Public gallery pages may be embedded nowhere; derivatives carry
        // long cache lifetimes at the storage layer instead.
        source: "/g/:slug*",
        headers: [{ key: "X-Frame-Options", value: "DENY" }],
      },
    ];
  },
};

export default nextConfig;
