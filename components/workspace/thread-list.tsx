"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";

import type { ThreadSummary } from "@/app/api/chat/threads/route";
import { apiFetch } from "@/lib/api-types";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export function ThreadList({
  activeThreadId,
  onSelect,
}: {
  activeThreadId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const queryClient = useQueryClient();

  const { data, isPending } = useQuery({
    queryKey: ["threads"],
    queryFn: () => apiFetch<{ threads: ThreadSummary[] }>("/api/chat/threads"),
  });

  const remove = useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ deleted: boolean }>(`/api/chat/threads/${id}`, {
        method: "DELETE",
      }),
    onSuccess: (_result, id) => {
      // Leaving a deleted thread selected would load a 404 into the chat panel.
      if (id === activeThreadId) onSelect(null);
      void queryClient.invalidateQueries({ queryKey: ["threads"] });
    },
  });

  if (isPending) {
    return (
      <div className="space-y-2 px-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-6 w-full" />
        ))}
      </div>
    );
  }

  if (!data?.threads.length) {
    return (
      <p className="px-3 py-2 text-[11px] text-gray-700">No conversations yet</p>
    );
  }

  return (
    <div className="space-y-0.5">
      {data.threads.map((thread) => (
        <div
          key={thread.id}
          className={cn(
            "group flex items-center gap-1 rounded-lg pr-1 transition-colors",
            thread.id === activeThreadId
              ? "bg-white/10"
              : "hover:bg-white/[0.06]",
          )}
        >
          <button
            type="button"
            onClick={() => onSelect(thread.id)}
            className="min-w-0 flex-1 truncate px-2.5 py-1.5 text-left text-xs text-gray-400 group-hover:text-cream"
          >
            {thread.title ?? "New conversation"}
          </button>
          <button
            type="button"
            aria-label="Delete conversation"
            onClick={() => remove.mutate(thread.id)}
            className="shrink-0 rounded p-1 text-gray-700 opacity-0 transition-opacity hover:text-red-400 focus:opacity-100 group-hover:opacity-100"
          >
            <Trash2 className="size-3" />
          </button>
        </div>
      ))}
    </div>
  );
}
