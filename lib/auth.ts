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
  advanced: {
    cookies: {
      // The OAuth callback only succeeds if the `state` cookie set at sign-in
      // still matches the server-side state record. Better Auth ships that
      // cookie with a 5-minute Max-Age while the record it must match lives
      // 10 -- so a Google round-trip lasting between 5 and 10 minutes comes
      // back to a record with no cookie and dies as `state_mismatch`. That is
      // exactly the first-ever sign-in: account chooser, then password and
      // 2FA, then the unverified-app warning, then consent. Outlive the
      // record so the record is the only thing that can expire.
      state: { attributes: { maxAge: 900 } },
    },
  },
  onAPIError: {
    // Otherwise OAuth failures land on /api/auth/error, which in production
    // bounces to "/" -- the marketing page, which shows nothing about the
    // failure and offers no way to retry beyond finding the CTA again.
    errorURL: "/sign-in",
  },
  plugins: [nextCookies()],
});
