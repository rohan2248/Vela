import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { processOAuthCallback } from "corsair/oauth";
import { corsair } from "@/server/corsair";
import { env } from "@/lib/env";
import { connectCalendar, connectGmail } from "@/lib/watch";

/**
 * OAuth landing point for every Corsair plugin.
 *
 * On success Corsair has already created/updated the corsair_accounts row and
 * stored the tokens encrypted under the KEK. What remains is app-level: record
 * which Google identity this is, and open the push subscription.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const code = params.get("code");
  const state = params.get("state");
  const oauthError = params.get("error");

  // Back to the workspace, not the landing page — connecting an account is
  // something you do from inside the app, and that is where the result banner
  // reads the ?connect= and ?plugin= params.
  const redirect = (query: Record<string, string>) =>
    NextResponse.redirect(
      new URL(`/workspace?${new URLSearchParams(query)}`, env.appUrl),
    );

  if (oauthError) {
    return redirect({ connect: "error", reason: oauthError });
  }
  if (!code || !state) {
    return redirect({ connect: "error", reason: "missing_code_or_state" });
  }

  try {
    const { plugin, tenantId } = await processOAuthCallback(corsair, {
      // Must match the connect route byte for byte, or Google rejects the swap.
      redirectUri: env.corsairRedirectUri,
      code,
      state,
    });

    // Post-connect setup is best-effort: the account is already usable for
    // search and chat even if push registration fails, and the renewal job
    // retries anything left unregistered.
    try {
      if (plugin === "gmail") await connectGmail(tenantId);
      else if (plugin === "googlecalendar") await connectCalendar(tenantId);
    } catch (setupError) {
      console.error(`[connect] post-connect setup failed for ${plugin}:`, setupError);
      return redirect({ connect: "partial", plugin });
    }

    return redirect({ connect: "success", plugin });
  } catch (error) {
    console.error("[connect] OAuth callback failed:", error);
    const message = error instanceof Error ? error.message : String(error);

    // generateOAuthUrl signs state with a 10-minute lifetime; a slow consent
    // screen is the usual cause and is worth telling the user about plainly.
    const reason = /state/i.test(message) ? "state_expired" : "exchange_failed";
    return redirect({ connect: "error", reason });
  }
}
