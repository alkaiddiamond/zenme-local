import type { NextConfig } from "next";

const dynamicWorkspaceTracingExcludes = [
  "./app/**/*.{ts,tsx}",
  "./components/**/*.{ts,tsx}",
  "./desktop/**/*",
  "./dist-desktop/**/*",
  "./.electron-builder-cache/**/*",
  "./docs/**/*",
  "./lib/**/*.{ts,tsx}",
  "./scripts/**/*",
  "./*.{md,ts,mts}",
];

const nextDistDir = process.env.ZENME_NEXT_DIST_DIR?.trim() ||
  (process.env.NODE_ENV === "development" ? ".next-dev" : ".next");

const nextConfig: NextConfig = {
  cacheComponents: true,
  distDir: nextDistDir,
  output: "standalone",
  outputFileTracingExcludes: {
    "/*": [
      "./dist-desktop/**/*",
      "./.electron-builder-cache/**/*",
    ],
    "/api/projects/**": dynamicWorkspaceTracingExcludes,
    "/api/settings/agent-plugins": dynamicWorkspaceTracingExcludes,
  },
  experimental: {
    proxyClientMaxBodySize: "55mb",
  },
};

export default nextConfig;
