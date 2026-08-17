import { prisma } from "@/lib/db";
import { indexTenant } from "@/lib/indexer";
import { publish } from "@/lib/realtime";
import { tenantFor } from "@/lib/tenant";

/**
 * Pulls a mailbox into the Corsair cache and then into the vector index.
 *
 * The list-then-get shape is mandatory, not an optimisation: `messages.list`
 * returns only `{id, threadId}` and caches exactly that, so a backfill built on
 * `list` alone would fill the cache with unindexable stubs. `messages.get` is
 * what produces the derived subject/from/to/body the indexer reads.
 */

const PAGE_SIZE = 100;
const HYDRATE_CONCURRENCY = 5;

export type BackfillOptions = {
  /** Gmail query bounding the backfill, e.g. "newer_than:1y -in:spam". */
  query?: string;
  /** Upper bound on messages fetched, to keep a first run predictable. */
  maxMessages?: number;
};

export type BackfillResult = {
  fetched: number;
  indexed: number;
  skipped: number;
  tookMs: number;
};

async function setState(
  tenantId: string,
  data: {
    status?: string;
    cursor?: string | null;
    processed?: number;
    total?: number | null;
    error?: string | null;
    startedAt?: Date;
  },
) {
  await prisma.syncState.upsert({
    where: { tenantId_kind: { tenantId, kind: "gmail_backfill" } },
    create: { tenantId, kind: "gmail_backfill", ...data },
    update: data,
  });
}

export async function runGmailBackfill(
  tenantId: string,
  options: BackfillOptions = {},
): Promise<BackfillResult> {
  const started = Date.now();
  const query = options.query ?? "newer_than:1y -in:spam -in:trash";
  const maxMessages = options.maxMessages ?? 500;

  const t = tenantFor(tenantId);
  await setState(tenantId, {
    status: "running",
    processed: 0,
    error: null,
    startedAt: new Date(),
  });

  let fetched = 0;
  let pageToken: string | undefined;

  try {
    while (fetched < maxMessages) {
      const list = await t.gmail.api.messages.list({
        q: query,
        maxResults: Math.min(PAGE_SIZE, maxMessages - fetched),
        pageToken,
      });

      const ids = (list.messages ?? [])
        .map((m) => m.id)
        .filter(Boolean) as string[];
      if (ids.length === 0) break;

      // Each get both hydrates the Corsair cache row and counts against
      // Gmail's per-user rate limit, so keep the fan-out bounded.
      for (let i = 0; i < ids.length; i += HYDRATE_CONCURRENCY) {
        const batch = ids.slice(i, i + HYDRATE_CONCURRENCY);
        await Promise.all(
          batch.map((id) =>
            t.gmail.api.messages
              .get({ id, format: "full" })
              .catch((error: unknown) => {
                console.warn(`[backfill] messages.get failed for ${id}:`, error);
              }),
          ),
        );
        fetched += batch.length;

        await setState(tenantId, { processed: fetched, cursor: pageToken ?? null });
        void publish({
          tenantId,
          kind: "sync.progress",
          at: new Date().toISOString(),
          data: { phase: "fetch", processed: fetched },
        });
      }

      pageToken = list.nextPageToken;
      if (!pageToken) break;
    }

    // Embedding is the slow part; do it once the cache is warm rather than
    // interleaved, so a rate-limit stall doesn't idle the ONNX runtime.
    const { indexed, skipped } = await indexTenant(tenantId, {
      limit: maxMessages,
      onProgress: (done) => {
        void publish({
          tenantId,
          kind: "sync.progress",
          at: new Date().toISOString(),
          data: { phase: "index", processed: done },
        });
      },
    });

    await setState(tenantId, {
      status: "done",
      processed: fetched,
      total: fetched,
      cursor: null,
    });

    return { fetched, indexed, skipped, tookMs: Date.now() - started };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await setState(tenantId, { status: "error", error: message });
    throw error;
  }
}
