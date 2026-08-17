import { createHmac, randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import {
  getGmailProfile,
  startCalendarWatch,
  startGmailWatch,
  stopCalendarWatch,
} from "@/lib/google";

/**
 * Registration and renewal of Google push subscriptions, plus the
 * ConnectedAccount bookkeeping that lets inbound webhooks find their tenant.
 *
 * Both Gmail and Calendar subscriptions expire after 7 days, so
 * `renewExpiringWatches` must run on a schedule or realtime silently stops.
 */

/** Signs a Calendar channel so a spoofed X-Goog-Channel-Id can't select a tenant. */
export function channelToken(userId: string): string {
  return createHmac("sha256", env.webhookTenantSecret)
    .update(userId)
    .digest("hex");
}

export function verifyChannelToken(userId: string, token: string): boolean {
  const expected = channelToken(userId);
  // Lengths are fixed hex digests here, so a plain compare is safe enough;
  // timingSafeEqual would need equal-length buffers anyway.
  return expected === token;
}

export async function connectGmail(userId: string) {
  const profile = await getGmailProfile(userId);

  let historyId = profile.historyId;
  let expiresAt: Date | null = null;

  // A missing Pub/Sub topic shouldn't block connecting the account — search and
  // chat work fine without push; only realtime is degraded.
  if (env.gmailPubsubTopic) {
    try {
      const watch = await startGmailWatch(userId);
      historyId = watch.historyId;
      expiresAt = new Date(Number(watch.expiration));
    } catch (error) {
      console.error("[watch] gmail watch registration failed:", error);
    }
  } else {
    console.warn("[watch] GMAIL_PUBSUB_TOPIC unset — skipping Gmail push setup");
  }

  return prisma.connectedAccount.upsert({
    where: { userId_provider: { userId, provider: "gmail" } },
    create: {
      userId,
      provider: "gmail",
      tenantId: userId,
      providerEmail: profile.emailAddress,
      gmailHistoryId: historyId,
      gmailWatchExpiresAt: expiresAt,
    },
    update: {
      providerEmail: profile.emailAddress,
      gmailHistoryId: historyId,
      gmailWatchExpiresAt: expiresAt,
    },
  });
}

export async function connectCalendar(userId: string) {
  const existing = await prisma.connectedAccount.findUnique({
    where: { userId_provider: { userId, provider: "googlecalendar" } },
  });

  // Google keeps delivering to an old channel until it expires, which would
  // double-deliver every event, so retire it before opening a new one.
  if (existing?.calendarChannelId && existing.calendarResourceId) {
    try {
      await stopCalendarWatch(
        userId,
        existing.calendarChannelId,
        existing.calendarResourceId,
      );
    } catch (error) {
      console.warn("[watch] could not stop previous calendar channel:", error);
    }
  }

  const channelId = randomUUID();
  let resourceId: string | null = null;
  let expiresAt: Date | null = null;

  try {
    const watch = await startCalendarWatch(
      userId,
      channelId,
      channelToken(userId),
    );
    resourceId = watch.resourceId;
    expiresAt = watch.expiration ? new Date(Number(watch.expiration)) : null;
  } catch (error) {
    console.error("[watch] calendar watch registration failed:", error);
  }

  return prisma.connectedAccount.upsert({
    where: { userId_provider: { userId, provider: "googlecalendar" } },
    create: {
      userId,
      provider: "googlecalendar",
      tenantId: userId,
      calendarChannelId: resourceId ? channelId : null,
      calendarResourceId: resourceId,
      calendarWatchExpiresAt: expiresAt,
    },
    update: {
      calendarChannelId: resourceId ? channelId : null,
      calendarResourceId: resourceId,
      calendarWatchExpiresAt: expiresAt,
    },
  });
}

export type RenewalReport = {
  renewed: { userId: string; provider: string }[];
  failed: { userId: string; provider: string; error: string }[];
};

/**
 * Re-registers any subscription expiring within `withinHours`. Watches also get
 * renewed when they have no recorded expiry, which covers accounts connected
 * while the Pub/Sub topic was unset.
 */
export async function renewExpiringWatches(withinHours = 24): Promise<RenewalReport> {
  const threshold = new Date(Date.now() + withinHours * 60 * 60 * 1000);
  const report: RenewalReport = { renewed: [], failed: [] };

  const gmailAccounts = await prisma.connectedAccount.findMany({
    where: {
      provider: "gmail",
      OR: [
        { gmailWatchExpiresAt: null },
        { gmailWatchExpiresAt: { lte: threshold } },
      ],
    },
  });

  for (const account of gmailAccounts) {
    try {
      await connectGmail(account.userId);
      report.renewed.push({ userId: account.userId, provider: "gmail" });
    } catch (error) {
      report.failed.push({
        userId: account.userId,
        provider: "gmail",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const calendarAccounts = await prisma.connectedAccount.findMany({
    where: {
      provider: "googlecalendar",
      OR: [
        { calendarWatchExpiresAt: null },
        { calendarWatchExpiresAt: { lte: threshold } },
      ],
    },
  });

  for (const account of calendarAccounts) {
    try {
      await connectCalendar(account.userId);
      report.renewed.push({ userId: account.userId, provider: "googlecalendar" });
    } catch (error) {
      report.failed.push({
        userId: account.userId,
        provider: "googlecalendar",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return report;
}
