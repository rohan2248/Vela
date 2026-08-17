import { corsair } from "@/server/corsair";
import { env } from "@/lib/env";
import { tenantFor } from "@/lib/tenant";

/**
 * Direct Google REST calls for the handful of things the Corsair plugins do not
 * expose, using the OAuth tokens Corsair already manages.
 *
 * Two gaps this fills:
 *   1. `users.getProfile` has schemas in @corsair-dev/gmail but is not wired
 *      into the callable endpoint tree, and it is the only in-scope way to learn
 *      which mailbox was just connected.
 *   2. Corsair registers no push subscriptions at all — `users.watch` and
 *      `events.watch` are entirely on us, including renewal.
 */

type Plugin = "gmail" | "googlecalendar";

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

/**
 * Returns a live access token, refreshing first if it is expired or about to be.
 *
 * The plugins refresh opportunistically inside their own request path, but a
 * raw fetch bypasses that, so the refresh is done explicitly here and persisted
 * back through Corsair's key manager (which keeps it encrypted under the KEK).
 */
async function getAccessToken(tenantId: string, plugin: Plugin): Promise<string> {
  const keys = tenantFor(tenantId)[plugin].keys;

  const [token, expiresAtRaw] = await Promise.all([
    keys.get_access_token(),
    keys.get_expires_at().catch(() => null),
  ]);

  const expiresAt = Number(expiresAtRaw ?? 0);
  const nowSeconds = Math.floor(Date.now() / 1000);
  const stillValid = token && expiresAt > nowSeconds + 60;
  if (stillValid) return token as string;

  const refreshToken = await keys.get_refresh_token();
  if (!refreshToken) {
    // No refresh token means offline access was never granted; only a fresh
    // consent round-trip can recover, so surface Corsair's own signal shape.
    throw new Error(`[auth-missing:${plugin}] no refresh token stored`);
  }

  const integrationKeys = corsair.keys[plugin];
  const [clientId, clientSecret] = await Promise.all([
    integrationKeys.get_client_id(),
    integrationKeys.get_client_secret(),
  ]);

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken as string,
      client_id: clientId as string,
      client_secret: clientSecret as string,
    }),
  });

  if (!response.ok) {
    throw new Error(
      `[auth-missing:${plugin}] token refresh failed (${response.status}): ${await response.text()}`,
    );
  }

  const data = (await response.json()) as {
    access_token: string;
    expires_in?: number;
  };

  await keys.set_access_token(data.access_token);
  if (data.expires_in) {
    await keys.set_expires_at(String(nowSeconds + data.expires_in));
  }

  return data.access_token;
}

async function googleFetch<T>(
  tenantId: string,
  plugin: Plugin,
  url: string,
  init: RequestInit = {},
): Promise<T> {
  const call = async (token: string) =>
    fetch(url, {
      ...init,
      headers: {
        ...init.headers,
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
    });

  let response = await call(await getAccessToken(tenantId, plugin));

  // A 401 here means the cached token died early (revoked, password change).
  // One forced refresh is worth attempting before giving up.
  if (response.status === 401) {
    const keys = tenantFor(tenantId)[plugin].keys;
    await keys.set_expires_at("0");
    response = await call(await getAccessToken(tenantId, plugin));
  }

  if (!response.ok) {
    throw new Error(
      `Google ${plugin} request failed (${response.status}): ${await response.text()}`,
    );
  }

  // events.watch/stop and some others return an empty body.
  const text = await response.text();
  return (text ? JSON.parse(text) : {}) as T;
}

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

export type GmailProfile = {
  emailAddress: string;
  messagesTotal: number;
  threadsTotal: number;
  historyId: string;
};

/**
 * The connected mailbox address — the only key Gmail push notifications carry,
 * so this is what webhook fan-in resolves tenants by.
 *
 * Deliberately not the OIDC userinfo endpoint: the plugin requests only
 * gmail.{modify,labels,send,compose}, so a userinfo call would 403.
 */
export function getGmailProfile(tenantId: string): Promise<GmailProfile> {
  return googleFetch<GmailProfile>(
    tenantId,
    "gmail",
    "https://gmail.googleapis.com/gmail/v1/users/me/profile",
  );
}

// ---------------------------------------------------------------------------
// Push subscriptions
// ---------------------------------------------------------------------------

export type GmailWatchResult = { historyId: string; expiration: string };

/**
 * Subscribes the mailbox to its Pub/Sub topic. All tenants share one push URL —
 * that is fine because the payload carries `emailAddress`, which identifies the
 * tenant on the way back in.
 *
 * Google caps the subscription at 7 days and recommends re-calling daily.
 */
export async function startGmailWatch(
  tenantId: string,
): Promise<GmailWatchResult> {
  const topicName = env.gmailPubsubTopic;
  if (!topicName) {
    throw new Error(
      "GMAIL_PUBSUB_TOPIC is not set; cannot subscribe to Gmail push notifications",
    );
  }

  return googleFetch<GmailWatchResult>(
    tenantId,
    "gmail",
    "https://gmail.googleapis.com/gmail/v1/users/me/watch",
    {
      method: "POST",
      body: JSON.stringify({ topicName, labelIds: ["INBOX"] }),
    },
  );
}

export async function stopGmailWatch(tenantId: string): Promise<void> {
  await googleFetch(
    tenantId,
    "gmail",
    "https://gmail.googleapis.com/gmail/v1/users/me/stop",
    { method: "POST" },
  );
}

export type CalendarWatchResult = {
  id: string;
  resourceId: string;
  expiration?: string;
};

/**
 * Opens a Calendar push channel. Unlike Gmail, the notification body is empty —
 * the channel id in the X-Goog-Channel-Id header is the only tenant key, and the
 * token is an HMAC we verify on the way back in.
 */
export async function startCalendarWatch(
  tenantId: string,
  channelId: string,
  channelToken: string,
): Promise<CalendarWatchResult> {
  return googleFetch<CalendarWatchResult>(
    tenantId,
    "googlecalendar",
    "https://www.googleapis.com/calendar/v3/calendars/primary/events/watch",
    {
      method: "POST",
      body: JSON.stringify({
        id: channelId,
        type: "web_hook",
        address: env.webhookUrl,
        token: channelToken,
      }),
    },
  );
}

export async function stopCalendarWatch(
  tenantId: string,
  channelId: string,
  resourceId: string,
): Promise<void> {
  await googleFetch(
    tenantId,
    "googlecalendar",
    "https://www.googleapis.com/calendar/v3/channels/stop",
    { method: "POST", body: JSON.stringify({ id: channelId, resourceId }) },
  );
}
