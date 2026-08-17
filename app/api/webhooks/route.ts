import { processWebhook } from "corsair";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { corsair } from "@/server/corsair";
import { resolveTenant } from "@/lib/webhook-tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Single ingress for every Corsair plugin webhook.
 *
 * Note the response policy: almost everything returns 2xx. Google treats a
 * non-2xx as a delivery failure and retries with backoff, and for an event we
 * either can't route or have already handled, that retry storm is worse than
 * dropping it. Genuine failures are logged, not signalled upstream.
 */
export async function POST(request: NextRequest) {
  const headers: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    headers[key] = value;
  });

  const contentType = request.headers.get("content-type");
  let body: string | Record<string, unknown>;
  if (contentType?.includes("application/json")) {
    body = await request.json().catch(() => ({}));
  } else {
    const text = await request.text();
    body = text && text.trim() ? text : {};
  }

  const resolution = await resolveTenant(
    headers,
    body,
    request.nextUrl.searchParams,
  );

  if (resolution.tenantId === null) {
    // Common and benign in development: pushes still arriving for a mailbox
    // whose account row was removed, or a stale ngrok tunnel.
    console.warn(`[webhook] unresolved tenant — ${resolution.reason}`);
    return NextResponse.json(
      { success: false, reason: resolution.reason },
      { status: 202 },
    );
  }

  try {
    const result = await processWebhook(corsair, headers, body, {
      tenantId: resolution.tenantId,
    });

    if (!result.plugin) {
      // Matchers require Google-ish headers (from: noreply@google.com, or a
      // user-agent containing APIs-Google). A proxy that rewrites them lands here.
      console.warn("[webhook] no plugin matched this request");
      return NextResponse.json({ success: false, matched: false }, { status: 202 });
    }

    console.info(
      `[webhook] ${result.plugin}.${result.action} for tenant ${resolution.tenantId}`,
    );

    const responseHeaders = new Headers();
    for (const [key, value] of Object.entries(result.responseHeaders ?? {})) {
      responseHeaders.set(key, value);
    }

    // Some providers need a handshake value echoed back; Google does not, and
    // the success payload here is only ever `{ success: true }` at runtime.
    return NextResponse.json(result.response ?? { success: true }, {
      headers: responseHeaders,
    });
  } catch (error) {
    console.error("[webhook] processing failed:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : String(error) },
      { status: 202 },
    );
  }
}

export async function GET() {
  return NextResponse.json({
    status: "ok",
    message: "Webhook endpoint is active",
    timestamp: new Date().toISOString(),
  });
}
