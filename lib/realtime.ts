import { EventEmitter } from "node:events";
import { Client } from "pg";
import { env } from "@/lib/env";

/**
 * Fan-out of Corsair webhook activity to connected browsers.
 *
 * Delivery has two tiers, because the deployment target decides what is even
 * possible:
 *
 *   1. An in-process EventEmitter. Instant, and sufficient whenever the webhook
 *      route and the SSE route run in the same Node process (`next dev`, a
 *      single long-lived server).
 *   2. Postgres LISTEN/NOTIFY, for when they don't. This is opt-in via
 *      DATABASE_DIRECT_URL rather than automatic, because this project runs on
 *      Neon and its default `-pooler` connection string is PgBouncer in
 *      transaction mode, where LISTEN is accepted and then silently never
 *      delivers. Pointing it at the non-pooled endpoint is the only way it works.
 *
 * The SSE route additionally tails corsair_events from a cursor, so a dropped
 * notification degrades to a few seconds of latency rather than a lost event.
 */

export const REALTIME_CHANNEL = "corsair_events";

export type RealtimeEvent = {
  tenantId: string;
  kind:
    | "email.received"
    | "email.deleted"
    | "email.labels"
    | "calendar.upserted"
    | "calendar.deleted"
    | "sync.progress";
  /** Provider-side id: Gmail message id or Calendar event id. */
  entityId?: string;
  /** corsair_entities.id, for joining to email_index. */
  entityRowId?: string;
  at: string;
  /** Kept small on purpose — pg_notify payloads are capped at 8000 bytes. */
  data?: Record<string, unknown>;
};

type GlobalRealtime = {
  emitter?: EventEmitter;
  listener?: Client;
  listenerStarting?: Promise<void>;
};

const globalForRealtime = globalThis as unknown as {
  __superAgentRealtime?: GlobalRealtime;
};

const state: GlobalRealtime = (globalForRealtime.__superAgentRealtime ??= {});

function emitter(): EventEmitter {
  if (!state.emitter) {
    state.emitter = new EventEmitter();
    // One listener per open SSE connection; the default cap of 10 would start
    // printing warnings with a handful of tabs open.
    state.emitter.setMaxListeners(0);
  }
  return state.emitter;
}

/** Publishes locally, and to other processes when a direct connection exists. */
export async function publish(event: RealtimeEvent): Promise<void> {
  emitter().emit(REALTIME_CHANNEL, event);

  const directUrl = env.databaseDirectUrl;
  if (!directUrl) return;

  try {
    const client = new Client({ connectionString: directUrl });
    await client.connect();
    try {
      await client.query("SELECT pg_notify($1, $2)", [
        REALTIME_CHANNEL,
        JSON.stringify(event),
      ]);
    } finally {
      await client.end();
    }
  } catch (error) {
    // Realtime is an enhancement; never let it break webhook processing.
    console.warn("[realtime] pg_notify failed:", error);
  }
}

/**
 * Starts the shared LISTEN connection, re-emitting remote events locally.
 * No-op when DATABASE_DIRECT_URL is unset.
 */
export async function ensureListener(): Promise<void> {
  const directUrl = env.databaseDirectUrl;
  if (!directUrl || state.listener) return;
  if (state.listenerStarting) return state.listenerStarting;

  state.listenerStarting = (async () => {
    try {
      const client = new Client({ connectionString: directUrl });

      client.on("notification", (message) => {
        if (message.channel !== REALTIME_CHANNEL || !message.payload) return;
        try {
          emitter().emit(REALTIME_CHANNEL, JSON.parse(message.payload));
        } catch {
          // Ignore anything that isn't one of our payloads.
        }
      });

      client.on("error", (error) => {
        console.warn("[realtime] listener error, will reconnect:", error);
        state.listener = undefined;
        state.listenerStarting = undefined;
      });

      await client.connect();
      await client.query(`LISTEN ${REALTIME_CHANNEL}`);
      state.listener = client;
    } catch (error) {
      console.warn("[realtime] could not start listener:", error);
      state.listenerStarting = undefined;
    }
  })();

  return state.listenerStarting;
}

/** Subscribes to one tenant's events. Returns an unsubscribe function. */
export function subscribe(
  tenantId: string,
  handler: (event: RealtimeEvent) => void,
): () => void {
  const onEvent = (event: RealtimeEvent) => {
    if (event.tenantId === tenantId) handler(event);
  };

  emitter().on(REALTIME_CHANNEL, onEvent);
  return () => emitter().off(REALTIME_CHANNEL, onEvent);
}
