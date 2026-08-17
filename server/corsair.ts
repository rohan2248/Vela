import "dotenv/config";
import { createCorsair } from "corsair";
import { gmail } from "@corsair-dev/gmail";
import { googlecalendar } from "@corsair-dev/googlecalendar";
import { pool } from "@/lib/db";
import { publish, type RealtimeEvent } from "@/lib/realtime";

/**
 * Fires and forgets a realtime notification plus a re-index of the entity the
 * webhook just wrote.
 *
 * The indexer is imported lazily because it pulls in the embedding runtime,
 * which is far too heavy to load into every module that imports this file.
 */
function dispatch(event: RealtimeEvent, indexEntityRowId?: string) {
  void publish(event).catch((error) =>
    console.warn("[corsair] realtime publish failed:", error),
  );

  if (!indexEntityRowId) return;

  void import("@/lib/indexer")
    .then(({ indexEntity }) => indexEntity(indexEntityRowId))
    .catch((error) => console.warn("[corsair] indexing failed:", error));
}

export const corsair = createCorsair({
  plugins: [
    gmail({
      webhookHooks: {
        // The plugin exposes exactly one Gmail webhook. `messageReceived` /
        // `messageDeleted` / `messageLabelChanged` are discriminants on
        // response.data.type, not separate hooks.
        messageChanged: {
          after: async (ctx, response) => {
            // An throw here propagates out of processWebhook and 500s the
            // route, which makes Google retry a delivery we already handled.
            try {
              if (!response.success || !response.data) return;
              const tenantId = ctx.tenantId;
              if (!tenantId) return;

              const payload = response.data;
              const message = (payload as { message?: Record<string, unknown> })
                .message;

              const kind =
                payload.type === "messageDeleted"
                  ? "email.deleted"
                  : payload.type === "messageLabelChanged"
                    ? "email.labels"
                    : "email.received";

              dispatch(
                {
                  tenantId,
                  kind,
                  entityId: message?.id as string | undefined,
                  entityRowId: response.corsairEntityId,
                  at: new Date().toISOString(),
                  data: {
                    // Deliberately minimal: the cached row holds the full
                    // message, and pg_notify payloads are capped at 8000 bytes.
                    threadId: message?.threadId,
                    snippet:
                      typeof message?.snippet === "string"
                        ? message.snippet.slice(0, 200)
                        : undefined,
                  },
                },
                // Deleted messages have no row left to index.
                payload.type === "messageDeleted"
                  ? undefined
                  : response.corsairEntityId,
              );
            } catch (error) {
              console.error("[corsair] gmail webhook hook failed:", error);
            }
          },
        },
      },
    }),

    googlecalendar({
      webhookHooks: {
        onEventChanged: {
          after: async (ctx, response) => {
            try {
              if (!response.success || !response.data) return;
              const tenantId = ctx.tenantId;
              if (!tenantId) return;

              const payload = response.data as {
                type: string;
                calendarId?: string;
                eventId?: string;
                event?: Record<string, unknown>;
              };

              // eventCreated vs eventUpdated is decided by a 5-second
              // `updated - created` heuristic inside the plugin, so it is not
              // reliable enough to branch on. Both are upserts.
              const deleted = payload.type === "eventDeleted";

              dispatch({
                tenantId,
                kind: deleted ? "calendar.deleted" : "calendar.upserted",
                entityId: (payload.event?.id as string) ?? payload.eventId,
                entityRowId: response.corsairEntityId,
                at: new Date().toISOString(),
                data: {
                  calendarId: payload.calendarId,
                  summary: payload.event?.summary,
                  start: payload.event?.start,
                  end: payload.event?.end,
                },
              });
            } catch (error) {
              console.error("[corsair] calendar webhook hook failed:", error);
            }
          },
        },
      },
    }),
  ],
  database: pool,
  kek: process.env.CORSAIR_KEK!,
  multiTenancy: true,
});
