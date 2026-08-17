import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { runGmailBackfill } from "@/lib/backfill";
import { prisma } from "@/lib/db";
import { errorResponse, requireTenant } from "@/lib/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Current backfill progress, for a UI to poll or render on load. */
export async function GET() {
  try {
    const { userId } = await requireTenant();
    const state = await prisma.syncState.findUnique({
      where: { tenantId_kind: { tenantId: userId, kind: "gmail_backfill" } },
    });
    return NextResponse.json({ state });
  } catch (error) {
    return errorResponse(error);
  }
}

/**
 * Starts a backfill.
 *
 * Runs inline by default so the caller gets a real result, but a large mailbox
 * will outlive an HTTP request — pass `background: true` to kick it off and
 * follow progress over /api/stream instead.
 */
export async function POST(request: NextRequest) {
  try {
    const { userId } = await requireTenant();
    const body = (await request.json().catch(() => ({}))) as {
      query?: string;
      maxMessages?: number;
      background?: boolean;
    };

    const existing = await prisma.syncState.findUnique({
      where: { tenantId_kind: { tenantId: userId, kind: "gmail_backfill" } },
    });
    if (existing?.status === "running") {
      return NextResponse.json(
        { error: "A backfill is already running", state: existing },
        { status: 409 },
      );
    }

    const options = {
      query: body.query,
      maxMessages: Math.min(body.maxMessages ?? 500, 5_000),
    };

    if (body.background) {
      void runGmailBackfill(userId, options).catch((error) =>
        console.error("[backfill] background run failed:", error),
      );
      return NextResponse.json({ started: true, ...options }, { status: 202 });
    }

    const result = await runGmailBackfill(userId, options);
    return NextResponse.json({ started: true, ...result });
  } catch (error) {
    return errorResponse(error);
  }
}
