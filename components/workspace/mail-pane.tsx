"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Search, SlidersHorizontal, Sparkles, X } from "lucide-react";

import { apiFetch, type EmailSearchResponse } from "@/lib/api-types";
import type { SearchFilters } from "@/lib/gmail-query";
import {
  FilterChips,
  MailFilters,
  hasActiveFilters,
} from "@/components/workspace/mail-filters";
import { MailDetail } from "@/components/workspace/mail-detail";
import { Skeleton } from "@/components/ui/skeleton";
import { useMounted } from "@/hooks/use-mounted";
import { cn } from "@/lib/utils";

type SyncState = {
  status: "idle" | "running" | "done" | "error";
  processed: number;
  total: number | null;
  error: string | null;
} | null;

/**
 * Display name from a raw RFC 5322 From header.
 * EmailHit.from is the unparsed header value — 'Jane Doe <jane@x.com>' or a
 * bare address — so it needs unwrapping before it's readable.
 */
function senderName(from: string | null): string {
  if (!from) return "Unknown";
  const named = from.match(/^\s*"?([^"<]+?)"?\s*</);
  if (named?.[1]) return named[1].trim();
  const bare = from.match(/<?([^<>@\s]+)@/);
  return bare?.[1] ?? from;
}

function relativeTime(iso: string | null): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";

  const minutes = Math.round((Date.now() - then) / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 1440) return `${Math.round(minutes / 60)}h`;
  if (minutes < 10080) return `${Math.round(minutes / 1440)}d`;
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

export function MailPane({ refreshKey }: { refreshKey?: number }) {
  // relativeTime() reads Date.now() and formats in the browser's locale, so a
  // server-rendered timestamp would never match the client's.
  const mounted = useMounted();
  const queryClient = useQueryClient();
  const [term, setTerm] = useState("");
  const [submitted, setSubmitted] = useState("");
  const [semantic, setSemantic] = useState(false);
  const [openMessageId, setOpenMessageId] = useState<string | null>(null);
  const [filters, setFilters] = useState<SearchFilters>({});
  const [showFilters, setShowFilters] = useState(false);

  const mail = useQuery({
    queryKey: ["mail", submitted, semantic, filters, refreshKey],
    queryFn: () => {
      // Semantic recall matches on meaning, so it takes the raw phrase and
      // ignores the structured filters entirely.
      if (semantic && submitted) {
        return apiFetch<EmailSearchResponse>("/api/search", {
          method: "POST",
          body: JSON.stringify({
            q: submitted,
            mode: "semantic",
            target: "email",
            limit: 25,
          }),
        });
      }

      // Otherwise send structured filters and let the server build `q` with
      // the same pure builder the UI previews with. Free text becomes an
      // `includes` term so it composes with the chips instead of replacing them.
      const merged: SearchFilters = {
        ...filters,
        in: filters.in ?? "inbox",
        includes: submitted ? [submitted] : filters.includes,
      };

      // Live, not cached. The cache is only populated by a backfill, so
      // defaulting to it shows a permanently empty inbox on a fresh account.
      // Live is authoritative and warms the cache as it goes.
      return apiFetch<EmailSearchResponse>("/api/search", {
        method: "POST",
        body: JSON.stringify({
          filters: merged,
          mode: "live",
          target: "email",
          limit: 25,
        }),
      });
    },
  });

  // Semantic search reads the local index, which only exists after a backfill.
  const sync = useQuery({
    queryKey: ["sync-state"],
    queryFn: () => apiFetch<{ state: SyncState }>("/api/sync/backfill"),
    refetchInterval: (query) =>
      query.state.data?.state?.status === "running" ? 2000 : false,
  });

  const indexed = sync.data?.state?.processed ?? 0;
  const indexing = sync.data?.state?.status === "running";
  const hasIndex = indexed > 0;

  const buildIndex = useMutation({
    mutationFn: () =>
      apiFetch<{ started: boolean }>("/api/sync/backfill", {
        method: "POST",
        body: JSON.stringify({ background: true, maxMessages: 500 }),
      }),
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: ["sync-state"] }),
  });

  const clearSearch = () => {
    setTerm("");
    setSubmitted("");
  };

  if (!mounted) {
    return (
      <div className="space-y-2 px-4">
        <Skeleton className="h-7 w-full" />
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="space-y-1.5 py-2">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-3 w-full" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 px-4 pb-3">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            setSubmitted(term.trim());
          }}
          className="flex items-center gap-2 rounded-lg border border-white/10 bg-black/40 px-2.5 py-1.5 focus-within:border-cream/30"
        >
          <Search className="size-3.5 shrink-0 text-gray-600" />
          <input
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            placeholder={semantic ? "Describe the email…" : "Search mail…"}
            className="min-w-0 flex-1 bg-transparent text-xs text-cream placeholder:text-gray-600 focus:outline-none"
          />
          {submitted && (
            <button
              type="button"
              onClick={clearSearch}
              aria-label="Clear search"
              className="shrink-0 text-gray-600 hover:text-cream"
            >
              <X className="size-3" />
            </button>
          )}
          <button
            type="button"
            aria-label="Advanced filters"
            title="Advanced search"
            onClick={() => setShowFilters((open) => !open)}
            className={cn(
              "shrink-0 rounded p-0.5 transition-colors",
              showFilters || hasActiveFilters(filters)
                ? "text-cream"
                : "text-gray-600 hover:text-gray-400",
            )}
          >
            <SlidersHorizontal className="size-3" />
          </button>
          <button
            type="button"
            aria-label="Toggle smart search"
            title={
              hasIndex
                ? "Smart search — meaning, not keywords"
                : "Smart search needs an index"
            }
            onClick={() => setSemantic((on) => !on)}
            disabled={!hasIndex}
            className={cn(
              "shrink-0 rounded p-0.5 transition-colors disabled:opacity-30",
              semantic ? "text-cream" : "text-gray-600 hover:text-gray-400",
            )}
          >
            <Sparkles className="size-3" />
          </button>
        </form>

        {/* Structured filters don't apply to meaning-based recall. */}
        {showFilters && !semantic && (
          <div className="mt-2">
            <MailFilters filters={filters} onChange={setFilters} />
          </div>
        )}
        {!semantic && <FilterChips filters={filters} onChange={setFilters} />}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2">
        {mail.isPending && (
          <div className="space-y-2 px-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="space-y-1.5 py-2">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-3 w-full" />
              </div>
            ))}
          </div>
        )}

        {mail.isError && (
          <p className="px-2 py-4 text-xs text-gray-500">
            {mail.error.message}
          </p>
        )}

        {mail.data?.results.length === 0 && (
          <p className="px-2 py-8 text-center text-xs text-gray-600">
            {submitted ? "Nothing matched." : "Inbox is empty."}
          </p>
        )}

        {mail.data?.results.map((hit) => (
          <button
            key={hit.messageId}
            type="button"
            onClick={() => setOpenMessageId(hit.messageId)}
            className={cn(
              "block w-full rounded-lg px-2 py-2.5 text-left transition-colors hover:bg-white/5",
              hit.labelIds?.includes("UNREAD") && "bg-cream/[0.03]",
            )}
          >
            <div className="flex items-baseline justify-between gap-2">
              <p
                className={cn(
                  "truncate text-xs text-cream/90",
                  hit.labelIds?.includes("UNREAD") && "font-bold",
                )}
              >
                {senderName(hit.from)}
              </p>
              <time className="shrink-0 text-[10px] text-gray-600">
                {relativeTime(hit.sentAt)}
              </time>
            </div>
            <p className="mt-0.5 truncate text-xs text-gray-400">
              {hit.subject ?? "(no subject)"}
            </p>
            {hit.snippet && (
              <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-gray-600">
                {hit.snippet}
              </p>
            )}
          </button>
        ))}
      </div>

      {/* Index status. Semantic recall is unreachable until a backfill runs, and
          this is the only place in the app that can start one. */}
      <div className="shrink-0 border-t border-white/10 px-4 py-2">
        {indexing ? (
          <p className="flex items-center gap-1.5 text-[10px] text-gray-500">
            <Loader2 className="size-2.5 animate-spin" />
            Indexing for smart search… {indexed} messages
          </p>
        ) : hasIndex ? (
          <p className="text-[10px] text-gray-700">
            {indexed} messages indexed for smart search
          </p>
        ) : (
          <div className="flex items-center justify-between gap-2">
            <p className="text-[10px] text-gray-600">Smart search not built</p>
            <button
              type="button"
              onClick={() => buildIndex.mutate()}
              disabled={buildIndex.isPending}
              className="rounded-full bg-cream/10 px-2 py-0.5 text-[10px] text-cream transition-colors hover:bg-cream/20 disabled:opacity-40"
            >
              {buildIndex.isPending ? "Starting…" : "Build index"}
            </button>
          </div>
        )}
        {buildIndex.isError && (
          <p className="mt-1 text-[10px] text-red-400">
            {buildIndex.error.message}
          </p>
        )}
      </div>

      <MailDetail
        messageId={openMessageId}
        onClose={() => setOpenMessageId(null)}
      />
    </div>
  );
}
