/**
 * Response shapes for the routes that declare theirs inline.
 *
 * These mirror what the handlers actually return — they are not validated at
 * runtime, so if a handler changes, change these with it.
 */

import type { EmailHit, EventHit } from "@/lib/search";
import type { SearchFilters } from "@/lib/gmail-query";

/** Corsair's connection state for one plugin. */
export type PluginStatus =
  | "connected"
  | "missing_credentials"
  | "not_connected";

export type Integration = {
  plugin: "gmail" | "googlecalendar";
  status: PluginStatus;
  connectedEmail: string | null;
  realtime: { active: boolean; expiresAt: string | null };
  connectUrl: string;
};

/** GET /api/corsair/status — integrations is always [gmail, googlecalendar]. */
export type CorsairStatus = {
  user: { id: string; email: string };
  integrations: Integration[];
};

export type SearchMode = "live" | "cached" | "semantic";

export type EmailSearchResponse = {
  target: "email";
  mode: SearchMode;
  query: string;
  filters: SearchFilters;
  tookMs: number;
  nextPageToken?: string;
  results: EmailHit[];
};

export type CalendarSearchResponse = {
  target: "calendar";
  mode: "live";
  query: string;
  filters: SearchFilters;
  tookMs: number;
  results: EventHit[];
};

/** GET /api/mail/[id] — the only route that returns an email body. */
export type MailMessage = {
  messageId: string;
  threadId: string | null;
  subject: string | null;
  from: string | null;
  to: string | null;
  cc: string | null;
  sentAt: string | null;
  labelIds: string[];
  snippet: string | null;
  body: string;
  attachments: { filename: string; mimeType: string; size: number }[];
};

/**
 * Only 409s carry a `code`; 401 and 500 bodies are `{ error }` alone.
 * `not_connected` means "offer a connect button", `reauth_required` means the
 * stored token expired and the account must be reconnected.
 */
export type ApiError = {
  error: string;
  code?: "not_connected" | "reauth_required";
  plugin?: string;
};

export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: ApiError["code"],
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

/** fetch + JSON + the shared error contract, so callers can branch on `code`. */
export async function apiFetch<T>(
  input: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(input, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });

  if (!response.ok) {
    let body: ApiError = { error: response.statusText };
    try {
      body = (await response.json()) as ApiError;
    } catch {
      // Non-JSON error body; the status line is all we have.
    }
    throw new ApiRequestError(body.error, response.status, body.code);
  }

  return (await response.json()) as T;
}
