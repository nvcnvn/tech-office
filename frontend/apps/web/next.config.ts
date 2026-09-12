import path from "node:path";
import type { NextConfig } from "next";

const outputFileTracingRoot = path.resolve(process.cwd(), "../..");
const releaseTag = (process.env.RELEASE_TAG ?? "dev").trim().replace(/[^A-Za-z0-9_-]/g, "-");
const isDevelopment = process.env.NODE_ENV !== "production";
const immutableAssetCache = "public, max-age=31536000, immutable";
const noStoreCache = "no-store, max-age=0, must-revalidate";
const longLivedAssetCache = isDevelopment ? noStoreCache : immutableAssetCache;

// The E2E harness builds the app rather than serving it from `next dev`, because
// on-demand compilation makes cold-route navigations race the compiler (drift D54/D71).
// It does not deploy the result, so three things the deployment build needs are skipped
// when it is the one building:
//
//   - `output: "standalone"` + file tracing. Tracing walks node_modules from the monorepo
//     root and took ~40 minutes here, dwarfing the ~21s compile. Nothing serves the
//     standalone bundle in a test run.
//   - ESLint. `pnpm lint` is its own gate (and is currently red — drift D67); folding it
//     into the E2E harness would make a lint warning look like a broken UI.
//   - Type errors. The web type check is a separate gate too. Failing the E2E run on one
//     would report the wrong problem in the wrong place.
//
// Every one of these is ON for a normal `pnpm build`. The switch is the presence of
// NEXT_DIST_DIR, which only e2e/playwright.config.ts sets.
const isE2EBuild = Boolean(process.env.NEXT_DIST_DIR);

const nextConfig: NextConfig = {
  ...(isE2EBuild ? {} : { output: "standalone" as const }),
  outputFileTracingRoot,
  ...(isE2EBuild
    ? {
        eslint: { ignoreDuringBuilds: true },
        typescript: { ignoreBuildErrors: true },
      }
    : {}),
  // Defaults to Next's own ".next", so nothing changes for `pnpm dev` or a production
  // build. The E2E harness overrides it (see e2e/playwright.config.ts) so that its web
  // server does not share a build directory with a developer's `pnpm --filter web dev`.
  //
  // Two `next dev` processes pointed at one .next continuously invalidate each other's
  // compilation cache. Observed while making this suite green: a stale dev server on
  // :13000 — not even answering requests any more — dragged a full-suite run from nine
  // minutes to several hours, with next-server pinned at ~245% CPU recompiling routes
  // the other process had just evicted. The gate has to survive a developer having their
  // dev server running, because they usually will.
  distDir: process.env.NEXT_DIST_DIR || ".next",
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
