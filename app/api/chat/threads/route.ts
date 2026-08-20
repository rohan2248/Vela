import { prisma } from "@/lib/db";
import { errorResponse, requireTenant } from "@/lib/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type ThreadSummary = {
  id: string;
  title: string | null;
  updatedAt: string;
};

/**
 * Thread history for the sidebar.
 *
 * Ordered by updatedAt so the thread you just spoke in floats to the top;
 * the [userId, updatedAt] index on chat_threads covers this exactly.
 */
export async function GET(request: Request) {
  try {
    const { userId } = await requireTenant();

    const limitParam = new URL(request.url).searchParams.get("limit");
    const limit = Math.min(Math.max(Number(limitParam) || 50, 1), 200);

    const threads = await prisma.chatThread.findMany({
      where: { userId },
      orderBy: { updatedAt: "desc" },
      take: limit,
      select: { id: true, title: true, updatedAt: true },
    });

    return Response.json({
      threads: threads.map(
        (thread): ThreadSummary => ({
          id: thread.id,
          title: thread.title,
          updatedAt: thread.updatedAt.toISOString(),
        }),
      ),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
