import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { corsair } from "@/server/corsair";
import { errorResponse, requireTenant } from "@/lib/tenant";

export const dynamic = "force-dynamic";

/** Per-user connection + push-subscription state, for the connect UI. */
export async function GET() {
  try {
    const { userId, email } = await requireTenant();

    const [connectionStatus, accounts] = await Promise.all([
      corsair.manage.connectionStatus.get({ tenantId: userId }),
      prisma.connectedAccount.findMany({ where: { userId } }),
    ]);

    const byProvider = new Map(accounts.map((a) => [a.provider, a]));

    const describe = (plugin: "gmail" | "googlecalendar") => {
      const account = byProvider.get(plugin);
      const expiresAt =
        plugin === "gmail"
          ? account?.gmailWatchExpiresAt
          : account?.calendarWatchExpiresAt;

      return {
        plugin,
        // 'connected' | 'missing_credentials' | 'not_connected'
        status: connectionStatus?.[plugin] ?? "not_connected",
        connectedEmail: account?.providerEmail ?? null,
        realtime: {
          active: Boolean(expiresAt && expiresAt > new Date()),
          expiresAt: expiresAt ?? null,
        },
        connectUrl: `/api/corsair/connect/${plugin}`,
      };
    };

    return NextResponse.json({
      user: { id: userId, email },
      integrations: [describe("gmail"), describe("googlecalendar")],
    });
  } catch (error) {
    return errorResponse(error);
  }
}
