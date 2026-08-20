import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    // Feature-card icons on the landing page are served from this CDN.
    remotePatterns: [{ protocol: "https", hostname: "images.higgs.ai" }],
  },
  // Keep Prisma out of the server bundle. Bundling rewrites the client's
  // __dirname, which is how it loses track of its query engine binary; left
  // external it resolves the engine from node_modules at runtime as intended.
  serverExternalPackages: ["@prisma/client", ".prisma/client"],
};

export default nextConfig;
