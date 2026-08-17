import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  buildGmailQuery,
  parseGmailQuery,
  type SearchFilters,
} from "@/lib/gmail-query";
import {
  searchCached,
  searchCalendar,
  searchLive,
  searchSemantic,
} from "@/lib/search";
import { errorResponse, requireTenant } from "@/lib/tenant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SearchBody = {
  /** Raw Gmail query. Mutually interchangeable with `filters`. */
  q?: string;
  filters?: SearchFilters;
  mode?: "live" | "cached" | "semantic";
  target?: "email" | "calendar";
  limit?: number;
  pageToken?: string;
  timeMin?: string;
  timeMax?: string;
};

/**
 * One endpoint behind the search UI.
 *
 * Accepts either a raw `q` or structured `filters` and always echoes both back,
 * so the client can render chips and a query box that stay in sync no matter
 * which one the user edited.
 */
export async function POST(request: NextRequest) {
  try {
    const { userId, t } = await requireTenant();
    const body = (await request.json().catch(() => ({}))) as SearchBody;

    const mode = body.mode ?? "live";
    const target = body.target ?? "email";
    const limit = Math.min(Math.max(body.limit ?? 25, 1), 100);

    // Whichever the caller supplied, derive the other.
    const filters = body.filters ?? parseGmailQuery(body.q ?? "");
    const query = body.q ?? buildGmailQuery(filters);

    const started = Date.now();

    if (target === "calendar") {
      const events = await searchCalendar(t, {
        query: query || undefined,
        timeMin: body.timeMin,
        timeMax: body.timeMax,
        maxResults: limit,
      });
      return NextResponse.json({
        target,
        mode: "live",
        query,
        filters,
        tookMs: Date.now() - started,
        results: events,
      });
    }

    switch (mode) {
      case "cached": {
        const hits = await searchCached(userId, filters, limit);
        return NextResponse.json({
          target,
          mode,
          query,
          filters,
          tookMs: Date.now() - started,
          results: hits,
        });
      }

      case "semantic": {
        // The vector side needs natural language, not Gmail operator syntax.
        const text =
          [...(filters.includes ?? []), ...(filters.subject ?? [])].join(" ") ||
          query;

        if (!text.trim()) {
          return NextResponse.json(
            { error: "semantic mode needs search text" },
            { status: 400 },
          );
        }

        const hits = await searchSemantic(userId, text, limit);
        return NextResponse.json({
          target,
          mode,
          query,
          filters,
          tookMs: Date.now() - started,
          results: hits,
        });
      }

      default: {
        const { hits, nextPageToken } = await searchLive(t, query, {
          maxResults: limit,
          pageToken: body.pageToken,
        });
        return NextResponse.json({
          target,
          mode: "live",
          query,
          filters,
          tookMs: Date.now() - started,
          nextPageToken,
          results: hits,
        });
      }
    }
  } catch (error) {
    return errorResponse(error);
  }
}

/** Query-string form, for links and quick manual checks. */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const proxied = new Request(request.url, {
    method: "POST",
    headers: request.headers,
    body: JSON.stringify({
      q: params.get("q") ?? undefined,
      mode: (params.get("mode") as SearchBody["mode"]) ?? undefined,
      target: (params.get("target") as SearchBody["target"]) ?? undefined,
      limit: params.get("limit") ? Number(params.get("limit")) : undefined,
    }),
  });
  return POST(proxied as NextRequest);
}
