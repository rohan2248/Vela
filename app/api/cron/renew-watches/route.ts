import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { env } from "@/lib/env";
import { renewExpiringWatches } from "@/lib/watch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Re-registers Google push subscriptions before they lapse.
 *
 * Gmail's users.watch and Calendar's events.watch both expire after 7 days and
 * Corsair renews neither, so without this running at least daily realtime just
 * stops with no error anywhere.
 */
export async function GET(request: NextRequest) {
  const secret = env.cronSecret;

  if (secret) {
    const authorization = request.headers.get("authorization");
    const provided =
      authorization?.replace(/^Bearer\s+/i, "") ??
      request.nextUrl.searchParams.get("secret");
    if (provided !== secret) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  } else if (process.env.NODE_ENV === "production") {
    // Fail closed. This endpoint issues Google API calls on behalf of every
    // connected user, so leaving it open would let anyone burn their quota.
    console.error("[cron] refusing to run: CRON_SECRET is not set");
    return NextResponse.json(
      { error: "CRON_SECRET is not configured" },
      { status: 503 },
    );
  } else {
    console.warn("[cron] CRON_SECRET unset — allowed because NODE_ENV is not production");
  }

  const report = await renewExpiringWatches();
  return NextResponse.json({ ...report, at: new Date().toISOString() });
}
