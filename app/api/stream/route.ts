import { pool } from "@/lib/db";
import { ensureListener, subscribe, type RealtimeEvent } from "@/lib/realtime";
import { errorResponse, requireTenant } from "@/lib/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const HEARTBEAT_MS = 30_000;
const TAIL_INTERVAL_MS = 5_000;

/** Maps a corsair_events.event_type onto the client-facing event kind. */
function kindFor(eventType: string): RealtimeEvent["kind"] | null {
  switch (eventType) {
    case "gmail.webhook.messageReceived":
      return "email.received";
    case "gmail.webhook.messageDeleted":
      return "email.deleted";
    case "gmail.webhook.messageLabelChanged":
      return "email.labels";
    case "googlecalendar.webhook.eventCreated":
    case "googlecalendar.webhook.eventUpdated":
      return "calendar.upserted";
    case "googlecalendar.webhook.eventDeleted":
      return "calendar.deleted";
    default:
      return null;
  }
}

/**
 * Server-sent events for one tenant's mailbox and calendar activity.
 *
 * Two sources feed the same stream:
 *   - the in-process emitter, for sub-second delivery
 *   - a tail of corsair_events, which catches anything the emitter missed
 *     because the webhook was handled by a different process
 *
 * Events are de-duplicated by id, so a client sees each one exactly once
 * regardless of which path delivered it first.
 */
export async function GET(request: Request) {
  let tenantId: string;
  try {
    ({ userId: tenantId } = await requireTenant());
  } catch (error) {
    return errorResponse(error);
  }

  await ensureListener();

  const encoder = new TextEncoder();
  const seen = new Set<string>();

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;

      const send = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
          );
        } catch {
          closed = true;
        }
      };

      const emit = (event: RealtimeEvent, dedupeKey?: string) => {
        const key = dedupeKey ?? `${event.kind}:${event.entityId ?? ""}:${event.at}`;
        if (seen.has(key)) return;
        seen.add(key);
        // Bound the memory a very long-lived connection can accumulate.
        if (seen.size > 2000) {
          for (const old of Array.from(seen).slice(0, 1000)) seen.delete(old);
        }
        send("corsair", event);
      };

      send("ready", { tenantId, at: new Date().toISOString() });

      const unsubscribe = subscribe(tenantId, (event) => emit(event));

      // Only surface activity from this point forward; history belongs to the
      // search endpoints, not the live stream.
      let cursor = new Date();

      const tail = async () => {
        if (closed) return;
        try {
          const { rows } = await pool.query<{
            id: string;
            event_type: string;
            created_at: Date;
            payload: Record<string, unknown>;
          }>(
            `SELECT e.id, e.event_type, e.created_at, e.payload
               FROM corsair_events e
               JOIN corsair_accounts a ON a.id = e.account_id
              WHERE a.tenant_id = $1
                AND e.created_at > $2
                AND e.event_type LIKE '%.webhook.%'
              ORDER BY e.created_at ASC
              LIMIT 50`,
            [tenantId, cursor],
          );

          for (const row of rows) {
            cursor = row.created_at > cursor ? row.created_at : cursor;
            const kind = kindFor(row.event_type);
            if (!kind) continue;
            emit(
              {
                tenantId,
                kind,
                at: row.created_at.toISOString(),
                data: { eventType: row.event_type },
              },
              `db:${row.id}`,
            );
          }
        } catch (error) {
          console.warn("[stream] tail query failed:", error);
        }
      };

      const tailTimer = setInterval(tail, TAIL_INTERVAL_MS);
      // Comment-only frames keep proxies from closing an idle connection.
      const heartbeatTimer = setInterval(() => {
        if (!closed) {
          try {
            controller.enqueue(encoder.encode(`: ping\n\n`));
          } catch {
            closed = true;
          }
        }
      }, HEARTBEAT_MS);

      const cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(tailTimer);
        clearInterval(heartbeatTimer);
        unsubscribe();
        try {
          controller.close();
        } catch {
          // Already closed by the client disconnecting.
        }
      };

      request.signal.addEventListener("abort", cleanup);
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      // Tells nginx-style proxies not to buffer the stream.
      "x-accel-buffering": "no",
    },
  });
}
