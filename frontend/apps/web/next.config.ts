import path from "node:path";
import type { NextConfig } from "next";

const outputFileTracingRoot = path.resolve(process.cwd(), "../..");
const releaseTag = (process.env.RELEASE_TAG ?? "dev").trim().replace(/[^A-Za-z0-9_-]/g, "-");
const isDevelopment = process.env.NODE_ENV !== "production";
const immutableAssetCache = "public, max-age=31536000, immutable";
const noStoreCache = "no-store, max-age=0, must-revalidate";
const longLivedAssetCache = isDevelopment ? noStoreCache : immutableAssetCache;

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot,
  generateBuildId: async () => releaseTag,
  env: {
    NEXT_PUBLIC_RELEASE_TAG: releaseTag,
  },
  images: {
    localPatterns: [
      {
        pathname: "/docs/**",
        search: `?v=${releaseTag}`,
      },
    ],
  },

  async redirects() {
    return [
      {
        source: '/workspace/projects/:path*',
        destination: '/workspace/tasks/:path*/',
        permanent: false,
      },
    ];
  },

  async headers() {
    return [
      {
        source: "/_next/static/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: longLivedAssetCache,
          },
        ],
      },
      {
        source: "/sounds/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: longLivedAssetCache,
          },
        ],
      },
      {
        source: "/docs/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: longLivedAssetCache,
          },
        ],
      },
      {
        source: "/firebase-config.json",
        headers: [
          {
            key: "Cache-Control",
            value: longLivedAssetCache,
          },
        ],
      },
      {
        source: "/firebase-messaging-sw.js",
        headers: [
          {
            key: "Cache-Control",
            value: longLivedAssetCache,
          },
        ],
      },
      {
        source: "/",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=0, s-maxage=0, must-revalidate",
          },
        ],
      },
      {
        source: "/:path((?!_next/|.*\\..*).*)",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=0, s-maxage=0, must-revalidate",
          },
        ],
      },
    ];
  },

  // Optional: Add trailing slashes for cleaner URLs
  trailingSlash: true,
  reactStrictMode: false
};

export default nextConfig;
