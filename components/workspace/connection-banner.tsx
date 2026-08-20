"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plug, RadioTower, TriangleAlert } from "lucide-react";

import { apiFetch, type CorsairStatus } from "@/lib/api-types";
import type { WatchResult } from "@/app/api/corsair/watch/route";
import { cn } from "@/lib/utils";

const PLUGIN_LABEL: Record<string, string> = {
  gmail: "Gmail",
  googlecalendar: "Calendar",
};

/**
 * Connection and realtime state.
 *
 * Two distinct failure modes get their own treatment: an account that isn't
 * linked at all, and one that is linked but has no Google push registered. The
 * second is easy to miss — search and chat work fine, mail just silently stops
 * arriving on its own — so it says so rather than showing nothing.
 */
export function ConnectionBanner() {
  const queryClient = useQueryClient();

  const { data } = useQuery({
    queryKey: ["corsair-status"],
    queryFn: () => apiFetch<CorsairStatus>("/api/corsair/status"),
  });

  const enableRealtime = useMutation({
    mutationFn: () =>
      apiFetch<{ results: WatchResult[] }>("/api/corsair/watch", {
        method: "POST",
      }),
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: ["corsair-status"] }),
  });

  const integrations = data?.integrations ?? [];
  const disconnected = integrations.filter(
    (integration) => integration.status !== "connected",
  );
  const connected = integrations.filter(
    (integration) => integration.status === "connected",
  );
  const noPush = connected.filter((integration) => !integration.realtime.active);

  if (!integrations.length) return null;

  return (
    <div className="mx-4 mb-3 space-y-2">
      {disconnected.length > 0 && (
        <div className="rounded-xl border border-cream/20 bg-cream/[0.04] p-3">
          <div className="flex items-center gap-2">
            <TriangleAlert className="size-3.5 shrink-0 text-cream" />
            <p className="text-xs font-medium text-cream">Finish connecting</p>
          </div>
          <p className="mt-1 text-[11px] leading-snug text-gray-500">
            Vela can&apos;t read your mail or calendar until these are linked.
          </p>
          <div className="mt-2.5 flex flex-wrap gap-2">
            {disconnected.map((integration) => (
              // connectUrl is a 302 to Google's consent screen, so it has to be
              // navigated to — fetching would follow the redirect cross-origin.
              <a
                key={integration.plugin}
                href={integration.connectUrl}
                className="flex items-center gap-1.5 rounded-full bg-cream px-3 py-1 text-[11px] font-medium text-black transition-opacity hover:opacity-90"
              >
                <Plug className="size-3" />
                {PLUGIN_LABEL[integration.plugin] ?? integration.plugin}
              </a>
            ))}
          </div>
        </div>
      )}

      {noPush.length > 0 && (
        <div className="rounded-xl border border-white/10 bg-black/40 p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="flex items-center gap-1.5 text-[11px] text-gray-400">
              <RadioTower className="size-3 shrink-0 text-gray-600" />
              Live updates off
            </p>
            <button
              type="button"
              onClick={() => enableRealtime.mutate()}
              disabled={enableRealtime.isPending}
              className="shrink-0 rounded-full bg-cream/10 px-2 py-0.5 text-[10px] text-cream transition-colors hover:bg-cream/20 disabled:opacity-40"
            >
              {enableRealtime.isPending ? (
                <Loader2 className="size-2.5 animate-spin" />
              ) : (
                "Enable"
              )}
            </button>
          </div>
          <p className="mt-1 text-[10px] leading-snug text-gray-600">
            {PLUGIN_LABEL[noPush[0].plugin]}
            {noPush.length > 1 ? ` and ${PLUGIN_LABEL[noPush[1].plugin]}` : ""}{" "}
            won&apos;t push changes — new mail appears only when you refresh.
          </p>

          {/* The reason only exists server-side otherwise; watch registration
              failures are swallowed so they never block connecting. */}
          {enableRealtime.data?.results
            .filter((result) => result.blockedBy)
            .map((result) => (
              <p
                key={result.plugin}
                className="mt-1.5 text-[10px] leading-snug text-amber-400/80"
              >
                <span className="text-gray-500">
                  {PLUGIN_LABEL[result.plugin]}:{" "}
                </span>
                {result.blockedBy}
              </p>
            ))}

          {enableRealtime.isError && (
            <p className="mt-1.5 text-[10px] text-red-400">
              {enableRealtime.error.message}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/** Compact per-integration push indicator for the left rail. */
export function RealtimeDot({ active }: { active: boolean }) {
  return (
    <span
      className={cn(
        "size-1.5 rounded-full",
        active ? "bg-emerald-400" : "bg-gray-700",
      )}
    />
  );
}
