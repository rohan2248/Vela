import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    // Feature-card icons on the landing page are served from this CDN.
    remotePatterns: [{ protocol: "https", hostname: "images.higgs.ai" }],
  },
  // Prisma's query engine is loaded via a dynamic require Next's file tracer
  // doesn't always follow — reliably under pnpm's symlinked node_modules,
  // where default tracing has been observed to drop it. Force-include it
  // explicitly so every route's serverless bundle ships the Linux engine.
  outputFileTracingIncludes: {
    "/**/*": ["./prisma/lib/generated/prisma/*.so.node"],
  },
};

export default nextConfig;
