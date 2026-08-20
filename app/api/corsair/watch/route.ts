import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { errorResponse, requireTenant } from "@/lib/tenant";
import { connectCalendar, connectGmail } from "@/lib/watch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export type WatchResult = {
  plugin: "gmail" | "googlecalendar";
  active: boolean;
  expiresAt: string | null;
  /** Plain-English reason when push could not be enabled. */
  blockedBy: string | null;
};

/**
 * Google will only deliver push to a publicly reachable HTTPS endpoint. In
 * local development WEBHOOK_PUBLIC_URL is unset, so this falls back to
 * localhost and every watch registration is rejected.
 */
function webhookBlocker(): string | null {
  const url = env.webhookUrl;
  if (!url.startsWith("https://")) {
    return "Webhook URL must be HTTPS — set WEBHOOK_PUBLIC_URL to a public tunnel (ngrok is already a dependency).";
  }
  if (/localhost|127\.0\.0\.1|\.local/i.test(url)) {
    return "Webhook URL points at localhost, which Google cannot reach. Set WEBHOOK_PUBLIC_URL to a public tunnel.";
  }
  return null;
}

/**
 * (Re)registers Google push for both plugins.
 *
 * connectGmail and connectCalendar deliberately swallow registration errors so
 * a failed watch never blocks connecting an account — which means the only
 * evidence of failure is a server log. This reads the result back and explains
 * it, so the UI can say why realtime is off instead of just showing a dash.
 */
export async function POST() {
  try {
    const { userId } = await requireTenant();

    await Promise.allSettled([connectGmail(userId), connectCalendar(userId)]);

    const accounts = await prisma.connectedAccount.findMany({
      where: { userId },
      select: {
        provider: true,
        gmailWatchExpiresAt: true,
        calendarWatchExpiresAt: true,
      },
    });

    const transport = webhookBlocker();

    const results: WatchResult[] = (
      ["gmail", "googlecalendar"] as const
    ).map((plugin) => {
      const row = accounts.find((account) => account.provider === plugin);
      const expiresAt =
        plugin === "gmail"
          ? row?.gmailWatchExpiresAt
          : row?.calendarWatchExpiresAt;
      const active = !!expiresAt && expiresAt > new Date();

      let blockedBy: string | null = null;
      if (!active) {
        if (!row) {
          blockedBy = "Account is not connected yet.";
        } else if (plugin === "gmail" && !env.gmailPubsubTopic) {
          blockedBy =
            "GMAIL_PUBSUB_TOPIC is not set. Gmail push publishes to a Pub/Sub topic, so one has to exist before a watch can be opened.";
        } else {
          blockedBy =
            transport ?? "Google rejected the watch — check the server log.";
        }
      }

      return {
        plugin,
        active,
        expiresAt: expiresAt?.toISOString() ?? null,
        blockedBy,
      };
    });

    return Response.json({ results });
  } catch (error) {
    return errorResponse(error);
  }
}
