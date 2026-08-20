import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { prisma } from "./db";
import { nextCookies } from "better-auth/next-js";
import { env } from "./env";

export const auth = betterAuth({
  baseURL: env.appUrl,
  // Every Vercel deployment also gets its own unique preview URL
  // (<project>-<hash>-<team>.vercel.app) alongside the stable production
  // alias in BETTER_AUTH_URL. Without this, requests hitting that per-deploy
  // URL get rejected as an untrusted origin.
  trustedOrigins: [
    env.appUrl,
    "https://*-rohan2248s-projects.vercel.app",
  ],
  database: prismaAdapter(prisma, {
    provider: "postgresql",
  }),
  socialProviders: {
    google: {
      prompt: "select_account",
      clientId: process.env.GOOGLE_CLIENT_ID as string,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET as string,
    },
  },
  plugins: [nextCookies()],
});
