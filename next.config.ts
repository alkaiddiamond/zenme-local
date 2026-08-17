import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  output: "standalone",
  outputFileTracingExcludes: {
    "/api/projects/**": [
      "./app/**/*.{ts,tsx}",
      "./components/**/*.{ts,tsx}",
      "./desktop/**/*",
      "./docs/**/*",
      "./lib/**/*.{ts,tsx}",
      "./scripts/**/*",
      "./*.{md,ts,mts}",
    ],
  },
  experimental: {
    proxyClientMaxBodySize: "55mb",
  },
};

export default nextConfig;
