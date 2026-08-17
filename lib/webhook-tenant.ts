import { prisma } from "@/lib/db";
import { verifyChannelToken } from "@/lib/watch";

/**
 * Resolves which tenant an inbound Google push belongs to.
 *
 * Google notifications carry no tenant of their own, and `processWebhook`
 * defaults to the literal tenant `"default"` when not told otherwise — so
 * without this every user's mail would be written into one account. Each
 * provider leaks exactly one usable identifier:
 *
 *   Gmail    — `emailAddress` inside the base64 Pub/Sub payload.
 *   Calendar — the channel id header; the body is empty.
 */

export type TenantResolution =
  | { tenantId: string; source: "gmail-address" | "calendar-channel" | "query" }
  | { tenantId: null; reason: string };

function decodePubSubPayload(
  body: unknown,
): { emailAddress?: string; historyId?: string } | null {
  const data = (body as { message?: { data?: string } })?.message?.data;
  if (typeof data !== "string") return null;
  try {
    return JSON.parse(Buffer.from(data, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

export async function resolveTenant(
  headers: Record<string, string>,
  body: unknown,
  query: URLSearchParams,
): Promise<TenantResolution> {
  // --- Calendar: identified by the push channel we opened ------------------
  const channelId = headers["x-goog-channel-id"];
  if (channelId) {
    const account = await prisma.connectedAccount.findUnique({
      where: { calendarChannelId: channelId },
    });
    if (!account) {
      return { tenantId: null, reason: `unknown calendar channel ${channelId}` };
    }

    // The channel id travels in a plain header, so anyone who learns one could
    // otherwise steer writes at that tenant. The token is our HMAC of the user
    // id, handed to Google at watch time and echoed back on every delivery.
    const token = headers["x-goog-channel-token"];
    if (token && !verifyChannelToken(account.userId, token)) {
      return { tenantId: null, reason: "calendar channel token mismatch" };
    }

    return { tenantId: account.tenantId, source: "calendar-channel" };
  }

  // --- Gmail: identified by the mailbox address in the Pub/Sub payload -----
  const payload = decodePubSubPayload(body);
  if (payload?.emailAddress) {
    const account = await prisma.connectedAccount.findFirst({
      where: { provider: "gmail", providerEmail: payload.emailAddress },
    });
    if (!account) {
      return {
        tenantId: null,
        reason: `no connected account for ${payload.emailAddress}`,
      };
    }
    return { tenantId: account.tenantId, source: "gmail-address" };
  }

  // --- Explicit override, for providers that support a custom callback URL -
  const queryTenant = query.get("tenant") ?? query.get("tenantId");
  if (queryTenant) {
    const account = await prisma.connectedAccount.findFirst({
      where: { tenantId: queryTenant },
    });
    if (account) return { tenantId: account.tenantId, source: "query" };
    return { tenantId: null, reason: `unknown tenant ${queryTenant}` };
  }

  return { tenantId: null, reason: "no tenant identifier in request" };
}
