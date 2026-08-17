import { tool, type ToolSet } from "ai";
import { z } from "zod";
import { buildCorsairToolDefs, type CorsairToolDef } from "@corsair-dev/mcp";
import { addMinutes, resolveDateTime } from "@/lib/datetime";
import { composeRawEmail } from "@/lib/mime";
import { searchCalendar, searchLive, searchSemantic } from "@/lib/search";
import { tenantFor } from "@/lib/tenant";

/**
 * The agent's capability surface.
 *
 * Three layers, deliberately:
 *
 *   - Introspection from the Corsair MCP package (`list_operations`,
 *     `get_schema`), so the agent can discover any endpoint across every
 *     installed plugin without us hand-wrapping it.
 *   - Typed action tools for the things that are easy to get wrong, so each
 *     sharp edge in the SDK is handled once here rather than re-derived by the
 *     model on every call.
 *   - `run_script`, the MCP escape hatch, gated behind explicit approval
 *     because it is `new Function(...)` with no sandbox.
 *
 * Everything is bound to one tenant at construction time. No tool takes a
 * tenant or user argument, so the model cannot address another user's mailbox.
 */

export type AgentContext = {
  userId: string;
  userEmail: string;
  timeZone: string;
  /**
   * Skips the approval gate on outward-facing actions. Off by default: sending
   * mail and inviting people are visible to third parties and can't be undone,
   * so a human should see them first.
   */
  autoApprove?: boolean;
};

/** MCP hands back a CallToolResult; the model wants text. */
function resultToText(result: {
  content?: unknown[];
  isError?: boolean;
}): string {
  const text = (result.content ?? [])
    .filter(
      (part): part is { type: "text"; text: string } =>
        typeof part === "object" &&
        part !== null &&
        (part as { type?: string }).type === "text",
    )
    .map((part) => part.text)
    .join("\n");

  return result.isError ? `Error: ${text || "unknown tool error"}` : text;
}

function mcpTools(
  defs: CorsairToolDef[],
  names: string[],
  options: { needsApproval?: boolean } = {},
): ToolSet {
  const tools: ToolSet = {};

  for (const name of names) {
    const def = defs.find((candidate) => candidate.name === name);
    if (!def) {
      console.warn(`[agent] MCP tool "${name}" not found; skipping`);
      continue;
    }

    tools[def.name] = tool({
      description: def.description,
      inputSchema: z.object(def.shape),
      needsApproval: options.needsApproval,
      execute: async (args) =>
        resultToText(await def.handler(args as Record<string, unknown>)),
    });
  }

  return tools;
}

export function buildTools(ctx: AgentContext): ToolSet {
  const t = tenantFor(ctx.userId);
  const requireApproval = !ctx.autoApprove;

  // BaseMcpOptions types `corsair` as an index-signature bag, which a class or
  // interface type does not structurally satisfy — hence the cast.
  const corsairDefs = buildCorsairToolDefs({
    corsair: t as unknown as Record<string, unknown>,
  });

  return {
    // ---------------------------------------------------------------------
    // Time
    // ---------------------------------------------------------------------
    resolve_datetime: tool({
      description:
        "Convert a natural-language date/time expression (e.g. '9 AM next Thursday', " +
        "'tomorrow at 2pm', 'in 3 days') into an exact ISO 8601 timestamp in the " +
        "user's timezone. ALWAYS use this before scheduling anything — never compute " +
        "dates yourself. Note that 'next <weekday>' resolves to the following " +
        "calendar week; state the resolved date back to the user so they can correct it.",
      inputSchema: z.object({
        expression: z
          .string()
          .describe("The phrase to resolve, e.g. '9 AM next Thursday'"),
        durationMinutes: z
          .number()
          .optional()
          .describe("If given, also returns an end time this many minutes later"),
      }),
      execute: async ({ expression, durationMinutes }) => {
        const resolved = resolveDateTime(expression, ctx.timeZone);
        if (!resolved) {
          return {
            ok: false,
            error: `Could not interpret "${expression}". Ask the user for an explicit date and time.`,
          };
        }
        return {
          ok: true,
          start: resolved.iso,
          end: durationMinutes ? addMinutes(resolved.iso, durationMinutes) : undefined,
          timeZone: resolved.timeZone,
          humanReadable: resolved.local,
          weekday: resolved.weekday,
        };
      },
    }),

    // ---------------------------------------------------------------------
    // Reading
    // ---------------------------------------------------------------------
    search_email: tool({
      description:
        "Search the user's Gmail with Gmail advanced-search syntax (from:, to:, " +
        "subject:, has:attachment, is:unread, after:, newer_than:, ...). Use this " +
        "when the user names a specific sender, label, or date range. For vague or " +
        "descriptive recall ('the thread about the price increase'), prefer " +
        "semantic_search_email.",
      inputSchema: z.object({
        query: z.string().describe("Gmail query, e.g. 'from:jane is:unread newer_than:7d'"),
        limit: z.number().min(1).max(50).default(10),
      }),
      execute: async ({ query, limit }) => {
        const { hits } = await searchLive(t, query, { maxResults: limit });
        return { count: hits.length, results: hits };
      },
    }),

    semantic_search_email: tool({
      description:
        "Meaning-based search over the user's cached mail, combining vector and " +
        "full-text ranking. Use for descriptive or fuzzy recall where the exact " +
        "words are unknown. Runs locally against the cache, so it is fast but only " +
        "covers mail that has been synced.",
      inputSchema: z.object({
        query: z.string().describe("Natural-language description of the email"),
        limit: z.number().min(1).max(50).default(10),
      }),
      execute: async ({ query, limit }) => {
        const results = await searchSemantic(ctx.userId, query, limit);
        if (results.length === 0) {
          return {
            count: 0,
            results,
            note: "Nothing matched. The mailbox may not be indexed yet — a backfill may be needed.",
          };
        }
        return { count: results.length, results };
      },
    }),

    list_calendar_events: tool({
      description:
        "List or search the user's calendar events in a time range. Use this to " +
        "check what is already scheduled before proposing a new time.",
      inputSchema: z.object({
        timeMin: z.string().describe("ISO 8601 start of range"),
        timeMax: z.string().describe("ISO 8601 end of range"),
        query: z.string().optional().describe("Optional free-text filter"),
        limit: z.number().min(1).max(50).default(20),
      }),
      execute: async ({ timeMin, timeMax, query, limit }) => {
        const events = await searchCalendar(t, {
          timeMin,
          timeMax,
          query,
          maxResults: limit,
        });
        return { count: events.length, events };
      },
    }),

    find_free_time: tool({
      description:
        "Find open slots on the user's primary calendar within a range. Use before " +
        "proposing a meeting time so you don't double-book them.",
      inputSchema: z.object({
        timeMin: z.string().describe("ISO 8601 start of the search window"),
        timeMax: z.string().describe("ISO 8601 end of the search window"),
        durationMinutes: z.number().min(5).default(30),
      }),
      execute: async ({ timeMin, timeMax, durationMinutes }) => {
        const availability = await t.googlecalendar.api.calendar.getAvailability({
          timeMin,
          timeMax,
          // Without `items` the API returns an empty calendars map.
          items: [{ id: "primary" }],
        });

        const busy = (availability.calendars?.primary?.busy ?? [])
          .map((slot) => ({
            start: new Date(slot.start ?? timeMin).getTime(),
            end: new Date(slot.end ?? timeMin).getTime(),
          }))
          .sort((a, b) => a.start - b.start);

        const windowStart = new Date(timeMin).getTime();
        const windowEnd = new Date(timeMax).getTime();
        const needed = durationMinutes * 60_000;

        const free: { start: string; end: string }[] = [];
        let cursor = windowStart;

        for (const slot of busy) {
          if (slot.start - cursor >= needed) {
            free.push({
              start: new Date(cursor).toISOString(),
              end: new Date(slot.start).toISOString(),
            });
          }
          cursor = Math.max(cursor, slot.end);
        }
        if (windowEnd - cursor >= needed) {
          free.push({
            start: new Date(cursor).toISOString(),
            end: new Date(windowEnd).toISOString(),
          });
        }

        return { busy: availability.calendars?.primary?.busy ?? [], free };
      },
    }),

    // ---------------------------------------------------------------------
    // Outward-facing actions
    // ---------------------------------------------------------------------
    send_email: tool({
      description:
        "Send an email from the user's Gmail account. Confirm the recipient, " +
        "subject, and body with the user before calling this — it delivers " +
        "immediately and cannot be recalled.",
      inputSchema: z.object({
        to: z.array(z.string()).min(1).describe("Recipient email addresses"),
        subject: z.string(),
        body: z.string().describe("Plain-text body"),
        cc: z.array(z.string()).optional(),
        bcc: z.array(z.string()).optional(),
        html: z.string().optional().describe("Optional HTML alternative"),
        threadId: z
          .string()
          .optional()
          .describe("Gmail thread id, to reply within an existing thread"),
        inReplyTo: z
          .string()
          .optional()
          .describe("Message-Id being replied to, for correct threading"),
      }),
      needsApproval: requireApproval,
      execute: async ({ to, subject, body, cc, bcc, html, threadId, inReplyTo }) => {
        // messages.send accepts only a base64url RFC 2822 blob — there are no
        // to/subject/body parameters on the endpoint.
        const raw = composeRawEmail({
          to,
          cc,
          bcc,
          subject,
          text: body,
          html,
          from: ctx.userEmail,
          inReplyTo,
        });

        const sent = await t.gmail.api.messages.send({ raw, threadId });
        return {
          ok: true,
          messageId: sent.id,
          threadId: sent.threadId,
          to,
          subject,
        };
      },
    }),

    create_calendar_event: tool({
      description:
        "Create a calendar event and email invitations to the attendees. Resolve " +
        "times with resolve_datetime first, and confirm the details with the user " +
        "before calling — attendees are notified immediately.",
      inputSchema: z.object({
        summary: z.string().describe("Event title"),
        startISO: z.string().describe("ISO 8601 start time"),
        endISO: z.string().describe("ISO 8601 end time"),
        attendees: z.array(z.string()).default([]).describe("Attendee email addresses"),
        description: z.string().optional(),
        location: z.string().optional(),
        timeZone: z.string().optional().describe("IANA zone; defaults to the user's"),
      }),
      needsApproval: requireApproval,
      execute: async ({
        summary,
        startISO,
        endISO,
        attendees,
        description,
        location,
        timeZone,
      }) => {
        const zone = timeZone ?? ctx.timeZone;
        const body = {
          summary,
          description,
          location,
          start: { dateTime: startISO, timeZone: zone },
          end: { dateTime: endISO, timeZone: zone },
          attendees: attendees.map((email) => ({ email })),
        };

        const created = await t.googlecalendar.api.events.create({
          event: body,
          sendUpdates: "all",
        });

        // The plugin's create handler builds its request with no query string,
        // so the sendUpdates above is validated and then dropped — attendees
        // would never receive an invitation. update() does forward it, so a
        // follow-up PUT with the same body is what actually sends the mail.
        let invitesSent = false;
        if (created.id && attendees.length > 0) {
          try {
            await t.googlecalendar.api.events.update({
              id: created.id,
              event: body,
              sendUpdates: "all",
            });
            invitesSent = true;
          } catch (error) {
            console.error("[agent] invite dispatch failed:", error);
          }
        }

        return {
          ok: true,
          eventId: created.id,
          htmlLink: created.htmlLink,
          hangoutLink: created.hangoutLink,
          start: startISO,
          end: endISO,
          timeZone: zone,
          attendees,
          invitesSent,
          note:
            attendees.length > 0 && !invitesSent
              ? "Event created, but the invitation emails could not be sent."
              : undefined,
        };
      },
    }),

    // ---------------------------------------------------------------------
    // Corsair MCP
    // ---------------------------------------------------------------------
    ...mcpTools(corsairDefs, ["list_operations", "get_schema"]),

    // Arbitrary JS against the tenant-scoped client. Powerful enough to reach
    // any endpoint the typed tools don't cover, and unsandboxed, so it never
    // runs without a human saying yes.
    ...mcpTools(corsairDefs, ["run_script"], { needsApproval: true }),
  };
}

export function buildSystemPrompt(ctx: AgentContext): string {
  const now = new Date();
  const localNow = new Intl.DateTimeFormat("en-US", {
    timeZone: ctx.timeZone,
    dateStyle: "full",
    timeStyle: "short",
  }).format(now);

  return `You are the user's email and calendar assistant, acting on their behalf through their connected Google account.

Current context:
- Right now it is ${localNow} (${ctx.timeZone}).
- Current UTC instant: ${now.toISOString()}
- The user's email address is ${ctx.userEmail}.

Working rules:
- Never do date arithmetic yourself. Call resolve_datetime for anything relative
  ("next Thursday", "tomorrow morning") and use the ISO value it returns.
- When you schedule or send something, state the resolved date and time in words
  in your reply, so the user can catch a misunderstanding.
- Prefer semantic_search_email for descriptive recall and search_email when the
  user gives concrete operators like a sender or a date range.
- Check the calendar with list_calendar_events or find_free_time before
  proposing a meeting time.
- Sending email and inviting attendees are visible to other people and cannot be
  undone. Get the details right, and say plainly what you are about to do.
- If an account isn't connected, say so and point the user at the connect flow
  rather than retrying.
- If a request needs an endpoint you have no dedicated tool for, use
  list_operations and get_schema to find it before reaching for run_script.

Answer briefly and concretely. Lead with what happened or what you found.`;
}
