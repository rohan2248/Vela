import type { UIMessage } from "ai";

import { prisma } from "@/lib/db";
import { errorResponse, requireTenant } from "@/lib/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Part types the chat UI knows how to render.
 *
 * Rows written before persistence was switched to the SDK's originalMessages
 * mode stored assistant turns as ModelMessage `content`, which carries
 * `tool-call` / `tool-result` entries that are not valid UIMessage parts and
 * would throw on render. Anything unrecognised is dropped rather than shown.
 */
function isRenderablePart(part: unknown): boolean {
  if (!part || typeof part !== "object") return false;
  const type = (part as { type?: unknown }).type;
  if (typeof type !== "string") return false;

  return (
    type === "text" ||
    type === "reasoning" ||
    type === "step-start" ||
    type === "file" ||
    type === "dynamic-tool" ||
    type.startsWith("tool-") ||
    type.startsWith("data-") ||
    type.startsWith("source-")
  );
}

/** Messages for one thread, as UIMessages ready to seed useChat. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { userId } = await requireTenant();
    const { id } = await params;

    // Ownership is checked on the thread, not the messages — chat_messages has
    // no userId of its own.
    const thread = await prisma.chatThread.findFirst({
      where: { id, userId },
      select: { id: true, title: true, updatedAt: true },
    });
    if (!thread) {
      return Response.json({ error: "Thread not found" }, { status: 404 });
    }

    const rows = await prisma.chatMessage.findMany({
      where: { threadId: id },
      orderBy: { createdAt: "asc" },
      select: { id: true, role: true, parts: true },
    });

    const messages = rows.map((row) => {
      const parts = Array.isArray(row.parts) ? row.parts : [];
      return {
        id: row.id,
        role: row.role as UIMessage["role"],
        parts: parts.filter(isRenderablePart),
      } as UIMessage;
    });

    return Response.json({
      thread: {
        id: thread.id,
        title: thread.title,
        updatedAt: thread.updatedAt.toISOString(),
      },
      messages,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { userId } = await requireTenant();
    const { id } = await params;

    // deleteMany takes the compound filter, so another user's id simply
    // matches nothing instead of throwing. Messages cascade.
    const { count } = await prisma.chatThread.deleteMany({
      where: { id, userId },
    });
    if (count === 0) {
      return Response.json({ error: "Thread not found" }, { status: 404 });
    }

    return Response.json({ deleted: true });
  } catch (error) {
    return errorResponse(error);
  }
}
