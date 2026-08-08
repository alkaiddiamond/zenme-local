import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  output: "standalone",
  experimental: {
    proxyClientMaxBodySize: "55mb",
  },
};

export default nextConfig;
