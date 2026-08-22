"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowRight } from "lucide-react";

import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";

const CREAM = "#E1E0CC";

// Better Auth bounces a failed OAuth round-trip back here with ?error=<code>
// (see onAPIError.errorURL in lib/auth.ts). Unmapped codes still surface raw,
// so a screenshot of the failure is worth something.
const OAUTH_ERRORS: Record<string, string> = {
  state_mismatch: "That sign-in attempt expired. Please try again.",
  state_not_found: "That sign-in attempt expired. Please try again.",
  invalid_code: "Google turned down that sign-in. Please try again.",
  access_denied: "Sign-in was cancelled.",
  email_not_found: "Google didn't share an email address for that account.",
};

// Same footage as the hero, so arriving here reads as the same place.
const BACKGROUND_VIDEO =
  "https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260405_170732_8a9ccda6-5cff-4628-b164-059c500a2b41.mp4";

const SignInForm = () => {
  const failedCode = useSearchParams().get("error");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(
    failedCode
      ? (OAUTH_ERRORS[failedCode] ?? `Sign-in failed (${failedCode}).`)
      : null,
  );

  const handleGoogleSignIn = async () => {
    setError(null);
    setLoading(true);
    try {
      const { error: failure } = await authClient.signIn.social({
        provider: "google",
        // Signing in is how you get into the app, so land in the workspace —
        // "/" is the marketing page and has no idea you're authenticated.
        callbackURL: "/workspace",
      });
      // The client returns failures rather than throwing, so without this a
      // rejected request leaves the button stuck on "Redirecting…" forever.
      if (failure) {
        setError(failure.message ?? "Couldn't reach Google. Please try again.");
        setLoading(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setLoading(false);
    }
  };

  return (
    // Same inset frame as the hero: min-h-screen with the card free to grow
    // taller than the viewport on short screens rather than clipping.
    <main className="flex min-h-screen w-full flex-col bg-black p-4 md:p-6">
      <div className="relative flex flex-1 items-center justify-center overflow-hidden rounded-2xl px-4 py-16 md:rounded-[2rem]">
        <video
          className="absolute inset-0 h-full w-full object-cover"
          src={BACKGROUND_VIDEO}
          autoPlay
          loop
          muted
          playsInline
        />
        <div className="noise-overlay pointer-events-none absolute inset-0 opacity-[0.7] mix-blend-overlay" />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/50 via-black/30 to-black/70" />

        {/* Wordmark doubles as the way back to the landing page. */}
        <Link
          href="/"
          className="absolute left-6 top-5 text-xl font-medium tracking-[-0.05em] transition-opacity hover:opacity-70 md:left-8 md:top-6"
          style={{ color: CREAM }}
        >
          Vela
          <span className="relative -top-[0.55em] text-[0.4em]">*</span>
        </Link>

        <div className="relative z-10 w-full max-w-md rounded-2xl bg-[#101010] p-8 sm:p-10">
          <p className="text-[10px] uppercase tracking-[0.2em] text-cream sm:text-xs">
            Secure sign-in
          </p>

          <h1 className="mt-6 text-3xl leading-[0.95] text-cream sm:text-4xl">
            Sign in to <span className="font-serif italic">Vela</span>
          </h1>

          <p className="mt-4 text-xs leading-relaxed text-cream/70 sm:text-sm">
            Connect your Google account so Vela can read your mail and calendar.
            It never sends a word without your approval.
          </p>

          <Button
            type="button"
            variant="ghost"
            size="lg"
            onClick={handleGoogleSignIn}
            disabled={loading}
            className="group mt-8 h-auto w-full justify-between gap-2 rounded-full bg-cream py-1.5 pl-6 pr-1.5 text-sm font-medium text-black hover:bg-cream sm:text-base"
          >
            <span className="flex items-center gap-3">
              <GoogleIcon />
              {loading ? "Redirecting…" : "Continue with Google"}
            </span>
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-black transition-transform duration-300 group-hover:scale-110 sm:h-10 sm:w-10">
              <ArrowRight
                className="size-4 sm:size-[18px]"
                style={{ color: CREAM }}
              />
            </span>
          </Button>

          {error && (
            <p className="mt-4 text-center text-xs text-red-400 sm:text-sm">
              {error}
            </p>
          )}

          <p className="mt-8 text-center text-[10px] text-gray-500 sm:text-xs">
            For testing purposes only
          </p>
        </div>
      </div>
    </main>
  );
};

const GoogleIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
    <path
      fill="#4285F4"
      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1Z"
    />
    <path
      fill="#34A853"
      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z"
    />
    <path
      fill="#FBBC05"
      d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84Z"
    />
    <path
      fill="#EA4335"
      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.06l3.66 2.84C6.71 7.3 9.14 5.38 12 5.38Z"
    />
  </svg>
);

// useSearchParams opts the tree out of prerendering, so it needs a boundary
// of its own rather than taking the whole page down with it.
const SignInPage = () => (
  <Suspense>
    <SignInForm />
  </Suspense>
);

export default SignInPage;
