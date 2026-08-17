import { pool } from "@/lib/db";
import { getEmbeddingProvider, toVectorLiteral } from "@/lib/embeddings";
import { buildGmailQuery, type SearchFilters } from "@/lib/gmail-query";
import type { TenantClient } from "@/lib/tenant";

/**
 * Three retrieval paths over the same mailbox, with different tradeoffs:
 *
 *   live     — Gmail's own advanced search. Authoritative and always current,
 *              but costs API round-trips and is rate limited.
 *   cached   — SQL over the messages Corsair already cached. No API calls, but
 *              only substring matching.
 *   semantic — pgvector + full-text over email_index, fused with RRF. Handles
 *              paraphrase, runs in milliseconds, needs the backfill to have run.
 */

export type EmailHit = {
  messageId: string;
  threadId: string | null;
  subject: string | null;
  from: string | null;
  to: string | null;
  snippet: string | null;
  sentAt: string | null;
  labelIds: string[];
  score?: number;
  source: "live" | "cached" | "semantic";
};

/**
 * Candidate pool per retrieval arm before fusion.
 *
 * Sized well above the result count on purpose. pgvector runs an HNSW scan with
 * `ef = max(hnsw.ef_search, LIMIT)`, and the `tenant_id` filter is applied to
 * whatever that scan returns — so a small LIMIT on a multi-tenant index can come
 * back with fewer rows than asked for. Raising the pool raises `ef` with it,
 * which is the recall lever available in a single statement.
 *
 * The alternative is `SET LOCAL hnsw.iterative_scan = relaxed_order`, which is
 * exact but requires a transaction: BEGIN, SET, query, COMMIT is four network
 * round-trips instead of one. Against a remote database that costs far more
 * than the scan itself, so it is not worth it at this scale.
 */
const CANDIDATES = 200;

/** RRF damping constant; 60 is the value from the original paper. */
const RRF_K = 60;

function firstHeader(
  payload: { headers?: { name?: string; value?: string }[] } | undefined,
  name: string,
): string | null {
  const header = payload?.headers?.find(
    (h) => h.name?.toLowerCase() === name.toLowerCase(),
  );
  return header?.value ?? null;
}

// ---------------------------------------------------------------------------
// Live
// ---------------------------------------------------------------------------

/**
 * Gmail advanced search against the API.
 *
 * `messages.list` returns only `{id, threadId}`, so every result needs a
 * follow-up `messages.get`. That is also what populates the Corsair cache, so
 * running a live search warms the other two paths.
 */
export async function searchLive(
  t: TenantClient,
  query: string,
  options: { maxResults?: number; pageToken?: string } = {},
): Promise<{ hits: EmailHit[]; nextPageToken?: string }> {
  const list = await t.gmail.api.messages.list({
    q: query || undefined,
    maxResults: options.maxResults ?? 25,
    pageToken: options.pageToken,
  });

  const ids = (list.messages ?? []).map((m) => m.id).filter(Boolean) as string[];

  // Bounded concurrency: Gmail's per-user rate limit is easy to trip with an
  // unthrottled Promise.all over a full page of results.
  const hits: EmailHit[] = [];
  const CONCURRENCY = 5;

  for (let i = 0; i < ids.length; i += CONCURRENCY) {
    const batch = ids.slice(i, i + CONCURRENCY);
    const messages = await Promise.all(
      batch.map((id) =>
        t.gmail.api.messages
          .get({ id, format: "metadata" })
          .catch((error: unknown) => {
            console.warn(`[search] messages.get failed for ${id}:`, error);
            return null;
          }),
      ),
    );

    for (const message of messages) {
      if (!message?.id) continue;
      const payload = message.payload as
        | { headers?: { name?: string; value?: string }[] }
        | undefined;

      hits.push({
        messageId: message.id,
        threadId: message.threadId ?? null,
        subject: firstHeader(payload, "Subject"),
        from: firstHeader(payload, "From"),
        to: firstHeader(payload, "To"),
        snippet: message.snippet ?? null,
        sentAt: message.internalDate
          ? new Date(Number(message.internalDate)).toISOString()
          : null,
        labelIds: message.labelIds ?? [],
        source: "live",
      });
    }
  }

  return { hits, nextPageToken: list.nextPageToken };
}

// ---------------------------------------------------------------------------
// Cached
// ---------------------------------------------------------------------------

/**
 * Substring search over Corsair's cache.
 *
 * Deliberately raw SQL rather than `t.gmail.db.messages.search()`: that helper
 * deserialises the whole `data` blob, which for webhook-written rows includes
 * the full base64 message and inlined attachments.
 */
export async function searchCached(
  tenantId: string,
  filters: SearchFilters,
  limit = 25,
): Promise<EmailHit[]> {
  const conditions: string[] = ["a.tenant_id = $1", "e.entity_type = 'messages'"];
  const params: unknown[] = [tenantId];

  const add = (sql: string, value: unknown) => {
    params.push(value);
    conditions.push(sql.replace("$$", `$${params.length}`));
  };

  for (const from of filters.from ?? []) {
    add("e.data ->> 'from' ILIKE $$", `%${from}%`);
  }
  for (const to of filters.to ?? []) {
    add("e.data ->> 'to' ILIKE $$", `%${to}%`);
  }
  for (const subject of filters.subject ?? []) {
    add("e.data ->> 'subject' ILIKE $$", `%${subject}%`);
  }
  for (const term of filters.includes ?? []) {
    params.push(`%${term}%`);
    conditions.push(
      `(e.data ->> 'subject' ILIKE $${params.length} OR e.data ->> 'body' ILIKE $${params.length})`,
    );
  }
  for (const term of filters.excludes ?? []) {
    params.push(`%${term}%`);
    conditions.push(
      `NOT (COALESCE(e.data ->> 'subject','') ILIKE $${params.length} OR COALESCE(e.data ->> 'body','') ILIKE $${params.length})`,
    );
  }
  if (filters.isUnread) {
    conditions.push(`e.data -> 'labelIds' ? 'UNREAD'`);
  }
  if (filters.isStarred) {
    conditions.push(`e.data -> 'labelIds' ? 'STARRED'`);
  }

  params.push(limit);

  const { rows } = await pool.query(
    `SELECT e.entity_id                                      AS message_id,
            e.data ->> 'threadId'                            AS thread_id,
            e.data ->> 'subject'                             AS subject,
            e.data ->> 'from'                                AS from_addr,
            e.data ->> 'to'                                  AS to_addr,
            e.data ->> 'snippet'                             AS snippet,
            (e.data ->> 'internalDate')::bigint              AS internal_date,
            ARRAY(SELECT jsonb_array_elements_text(
                    COALESCE(e.data -> 'labelIds', '[]'::jsonb))) AS label_ids
       FROM corsair_entities e
       JOIN corsair_accounts a ON a.id = e.account_id
      WHERE ${conditions.join("\n        AND ")}
      ORDER BY (e.data ->> 'internalDate')::bigint DESC NULLS LAST
      LIMIT $${params.length}`,
    params,
  );

  return rows.map((row) => ({
    messageId: row.message_id,
    threadId: row.thread_id,
    subject: row.subject,
    from: row.from_addr,
    to: row.to_addr,
    snippet: row.snippet,
    sentAt: row.internal_date ? new Date(Number(row.internal_date)).toISOString() : null,
    labelIds: row.label_ids ?? [],
    source: "cached" as const,
  }));
}

// ---------------------------------------------------------------------------
// Semantic (hybrid)
// ---------------------------------------------------------------------------

/**
 * Vector recall fused with lexical recall via Reciprocal Rank Fusion.
 *
 * Neither side is sufficient alone: embeddings miss exact tokens (an invoice
 * number, a surname), and full-text misses paraphrase ("that thread about the
 * price increase"). RRF combines them on rank rather than score, which avoids
 * having to normalise a cosine distance against a ts_rank.
 */
export async function searchSemantic(
  tenantId: string,
  query: string,
  limit = 25,
): Promise<EmailHit[]> {
  const provider = getEmbeddingProvider();
  const [embedding] = await provider.embed([query]);
  const vector = toVectorLiteral(embedding);

  // Deliberately one statement and one round-trip — see CANDIDATES above for
  // why this doesn't wrap itself in a transaction to set hnsw.iterative_scan.
  const { rows } = await pool.query(
    `WITH vec AS (
         SELECT entity_row_id,
                ROW_NUMBER() OVER (ORDER BY embedding <=> $2::vector) AS rank
           FROM email_index
          WHERE tenant_id = $1 AND embedding IS NOT NULL
          ORDER BY embedding <=> $2::vector
          LIMIT ${CANDIDATES}
       ),
       lex AS (
         SELECT entity_row_id,
                ROW_NUMBER() OVER (
                  ORDER BY ts_rank_cd(fts, websearch_to_tsquery('english', $3)) DESC
                ) AS rank
           FROM email_index
          WHERE tenant_id = $1
            AND fts @@ websearch_to_tsquery('english', $3)
          LIMIT ${CANDIDATES}
       )
       SELECT i.message_id, i.thread_id, i.subject, i.from_addr, i.to_addr,
              i.snippet, i.sent_at, i.label_ids,
              COALESCE(1.0 / (${RRF_K} + vec.rank), 0)
            + COALESCE(1.0 / (${RRF_K} + lex.rank), 0) AS score
         FROM email_index i
         LEFT JOIN vec ON vec.entity_row_id = i.entity_row_id
         LEFT JOIN lex ON lex.entity_row_id = i.entity_row_id
        WHERE vec.entity_row_id IS NOT NULL OR lex.entity_row_id IS NOT NULL
        ORDER BY score DESC, i.sent_at DESC NULLS LAST
        LIMIT $4`,
    [tenantId, vector, query, limit],
  );

  return rows.map((row) => ({
    messageId: row.message_id,
    threadId: row.thread_id,
    subject: row.subject,
    from: row.from_addr,
    to: row.to_addr,
    snippet: row.snippet,
    sentAt: row.sent_at ? new Date(row.sent_at).toISOString() : null,
    labelIds: row.label_ids ?? [],
    score: Number(row.score),
    source: "semantic" as const,
  }));
}

// ---------------------------------------------------------------------------
// Calendar
// ---------------------------------------------------------------------------

export type EventHit = {
  eventId: string;
  summary: string | null;
  description: string | null;
  location: string | null;
  start: string | null;
  end: string | null;
  attendees: { email?: string; responseStatus?: string }[];
  htmlLink: string | null;
  hangoutLink: string | null;
};

export async function searchCalendar(
  t: TenantClient,
  options: {
    query?: string;
    timeMin?: string;
    timeMax?: string;
    maxResults?: number;
  } = {},
): Promise<EventHit[]> {
  const response = await t.googlecalendar.api.events.getMany({
    q: options.query || undefined,
    timeMin: options.timeMin,
    timeMax: options.timeMax,
    maxResults: options.maxResults ?? 25,
    // Expands recurring events into instances, which is what a search for
    // "the standup next Tuesday" actually needs.
    singleEvents: true,
    orderBy: "startTime",
  });

  return (response.items ?? []).map((event) => ({
    eventId: event.id ?? "",
    summary: event.summary ?? null,
    description: event.description ?? null,
    location: event.location ?? null,
    start: event.start?.dateTime ?? event.start?.date ?? null,
    end: event.end?.dateTime ?? event.end?.date ?? null,
    attendees: (event.attendees ?? []).map((a) => ({
      email: a.email,
      responseStatus: a.responseStatus,
    })),
    htmlLink: event.htmlLink ?? null,
    hangoutLink: event.hangoutLink ?? null,
  }));
}

/** Convenience for callers that hold filters rather than a query string. */
export function filtersToQuery(filters: SearchFilters): string {
  return buildGmailQuery(filters);
}
