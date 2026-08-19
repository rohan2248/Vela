import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    // Feature-card icons on the landing page are served from this CDN.
    remotePatterns: [{ protocol: "https", hostname: "images.higgs.ai" }],
  },
};

export default nextConfig;
