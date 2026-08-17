import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { generateOAuthUrl } from "corsair/oauth";
import { corsair } from "@/server/corsair";
import { env } from "@/lib/env";
import { errorResponse, requireTenant } from "@/lib/tenant";

const SUPPORTED = new Set(["gmail", "googlecalendar"]);

/**
 * Starts the OAuth handshake for one plugin.
 *
 * The tenant is the signed-in user's id, so each user's tokens land in their own
 * corsair_accounts row and `corsair.withTenant(userId)` reaches only their data.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ plugin: string }> },
) {
  try {
    // Authenticate before validating the path, so an anonymous caller can't
    // enumerate which integrations exist.
    const { userId } = await requireTenant();

    const { plugin } = await params;
    if (!SUPPORTED.has(plugin)) {
      return NextResponse.json(
        { error: `Unsupported plugin: ${plugin}` },
        { status: 400 },
      );
    }

    const { url } = await generateOAuthUrl(corsair, plugin, {
      tenantId: userId,
      redirectUri: env.corsairRedirectUri,
    });

    // The signed state embedded in `url` is only valid for 10 minutes, so send
    // the user straight there rather than returning it for later use.
    return NextResponse.redirect(url);
  } catch (error) {
    return errorResponse(error);
  }
}
