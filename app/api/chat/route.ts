import { anthropic } from "@ai-sdk/anthropic";
import type { AnthropicProviderOptions } from "@ai-sdk/anthropic";
import {
  convertToModelMessages,
  stepCountIs,
  streamText,
  type UIMessage,
} from "ai";
import { buildSystemPrompt, buildTools } from "@/lib/agent/tools";
import { prisma } from "@/lib/db";
import { CHAT_MODEL, env } from "@/lib/env";
import { errorResponse, requireTenant } from "@/lib/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type ChatBody = {
  messages: UIMessage[];
  threadId?: string;
  /** IANA zone from the browser; the agent's date handling depends on it. */
  timeZone?: string;
};

/** Raised when a threadId doesn't exist, or belongs to somebody else. */
class ThreadNotFoundError extends Error {
  constructor() {
    super("Thread not found");
    this.name = "ThreadNotFoundError";
  }
}

async function resolveThread(
  userId: string,
  threadId: string | undefined,
  messages: UIMessage[],
): Promise<string> {
  if (!threadId) {
    const thread = await prisma.chatThread.create({
      data: {
        userId,
        // First user message doubles as the thread title.
        title:
          messages
            .find((message) => message.role === "user")
            ?.parts?.find((part) => part.type === "text")
            ?.text?.slice(0, 80) ?? "New conversation",
      },
    });
    return thread.id;
  }

  // Scoped by userId, not just id. A bare `update({ where: { id } })` would let
  // any signed-in user append to somebody else's thread by guessing its id.
  // updateMany accepts the compound filter and reports 0 rows rather than
  // throwing an opaque P2025.
  const { count } = await prisma.chatThread.updateMany({
    where: { id: threadId, userId },
    data: { updatedAt: new Date() },
  });
  if (count === 0) throw new ThreadNotFoundError();

  return threadId;
}

export async function POST(request: Request) {
  try {
    const { userId, email } = await requireTenant();
    const body = (await request.json()) as ChatBody;

    const timeZone = body.timeZone || "UTC";
    const context = { userId, userEmail: email, timeZone };

    const incoming = body.messages ?? [];
    const threadId = await resolveThread(userId, body.threadId, incoming);

    const result = streamText({
      model: anthropic(CHAT_MODEL),
      system: buildSystemPrompt(context),
      messages: await convertToModelMessages(incoming),
      tools: buildTools(context),

      // send_email, create_calendar_event and run_script pause for approval.
      // Without a secret the approval request is unsigned, so a client could
      // POST back a fabricated approval for a tool call the model never made
      // and we would execute it. This binds each approval to its tool call.
      experimental_toolApprovalSecret: env.toolApprovalSecret,

      // Scheduling a meeting is a multi-step task: resolve the time, check the
      // calendar, create the event, then send a follow-up email. Without a stop
      // condition the loop would end after the first tool call.
      stopWhen: stepCountIs(16),

      providerOptions: {
        anthropic: {
          // Let the model decide how much to think per turn, and surface a
          // readable summary rather than the default empty thinking blocks.
          thinking: { type: "adaptive", display: "summarized" },
        } satisfies AnthropicProviderOptions,
      },

    });

    return result.toUIMessageStreamResponse({
      headers: { "x-thread-id": threadId },

      // Persistence mode. Passing the inbound history back means onFinish
      // receives the whole conversation as UIMessages with stable ids, so every
      // row lands in one schema. Persisting from streamText's own onFinish
      // instead wrote user rows as UIMessage `parts` but assistant rows as
      // ModelMessage `content` — two shapes in one column, unreplayable.
      originalMessages: incoming,

      onFinish: async ({ messages }) => {
        try {
          // The whole thread is rewritten each turn. An approval round-trip
          // re-sends earlier messages, so appending would duplicate them.
          await prisma.$transaction([
            prisma.chatMessage.deleteMany({ where: { threadId } }),
            prisma.chatMessage.createMany({
              data: messages.map((message) => ({
                threadId,
                role: message.role,
                parts: JSON.parse(JSON.stringify(message.parts ?? [])),
              })),
            }),
          ]);
        } catch (error) {
          // Losing the transcript should never break the response itself.
          console.error("[chat] failed to persist messages:", error);
        }
      },

      // Tool errors are worth showing: "Account not connected" is actionable,
      // and hiding it behind a generic failure just confuses the user.
      onError: (error) =>
        error instanceof Error ? error.message : String(error),
    });
  } catch (error) {
    if (error instanceof ThreadNotFoundError) {
      return Response.json({ error: error.message }, { status: 404 });
    }
    return errorResponse(error);
  }
}
