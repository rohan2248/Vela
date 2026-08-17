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
import { CHAT_MODEL } from "@/lib/env";
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

async function persist(
  userId: string,
  threadId: string | undefined,
  messages: UIMessage[],
): Promise<string> {
  const thread = threadId
    ? await prisma.chatThread.update({
        where: { id: threadId },
        data: { updatedAt: new Date() },
      })
    : await prisma.chatThread.create({
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

export async function POST(request: Request) {
  try {
    const { userId, email } = await requireTenant();
    const body = (await request.json()) as ChatBody;

    const timeZone = body.timeZone || "UTC";
    const context = { userId, userEmail: email, timeZone };

    const threadId = await persist(userId, body.threadId, body.messages ?? []);

    const result = streamText({
      model: anthropic(CHAT_MODEL),
      system: buildSystemPrompt(context),
      messages: await convertToModelMessages(body.messages ?? []),
      tools: buildTools(context),

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

      onFinish: async ({ response }) => {
        try {
          await prisma.chatMessage.createMany({
            data: [
              ...(body.messages ?? []).slice(-1).map((message) => ({
                threadId,
                role: message.role,
                parts: JSON.parse(JSON.stringify(message.parts ?? [])),
              })),
              ...response.messages.map((message) => ({
                threadId,
                role: message.role,
                parts: JSON.parse(JSON.stringify(message.content)),
              })),
            ],
          });
        } catch (error) {
          // Losing the transcript should never break the response itself.
          console.error("[chat] failed to persist messages:", error);
        }
      },
    });

    return result.toUIMessageStreamResponse({
      headers: { "x-thread-id": threadId },
      // Tool errors are worth showing: "Account not connected" is actionable,
      // and hiding it behind a generic failure just confuses the user.
      onError: (error) =>
        error instanceof Error ? error.message : String(error),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
