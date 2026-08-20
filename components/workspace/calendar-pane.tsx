"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, MapPin, Video } from "lucide-react";

import { apiFetch, type CalendarSearchResponse } from "@/lib/api-types";
import type { EventHit } from "@/lib/search";
import { useMounted } from "@/hooks/use-mounted";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];

/** Events are all-day when the API returned a bare date rather than a dateTime. */
function isAllDay(start: string | null): boolean {
  return !!start && !start.includes("T");
}

function timeLabel(start: string | null): string {
  if (!start) return "";
  if (isAllDay(start)) return "All day";
  return new Date(start).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Local YYYY-MM-DD. Using toISOString here would shift the day in any zone behind UTC. */
function dayKey(date: Date): string {
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/** An all-day event's `start` is already a local date string; a timed one needs converting. */
function eventDayKey(start: string): string {
  return start.includes("T") ? dayKey(new Date(start)) : start.slice(0, 10);
}

/**
 * The six-week block containing `month`, starting on the Sunday on or before
 * the 1st. Always 42 cells so the grid doesn't jump height between months.
 */
function buildGrid(month: Date): Date[] {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const start = new Date(first);
  start.setDate(first.getDate() - first.getDay());

  return Array.from({ length: 42 }, (_, i) => {
    const date = new Date(start);
    date.setDate(start.getDate() + i);
    return date;
  });
}

export function CalendarPane({ refreshKey }: { refreshKey?: number }) {
  // The grid is built from "today" and labelled with browser-locale dates,
  // neither of which the server can produce identically. Render the skeleton
  // until mounted rather than hydrate a mismatched tree.
  const mounted = useMounted();
  const today = useMemo(() => new Date(), []);
  const [month, setMonth] = useState(
    () => new Date(today.getFullYear(), today.getMonth(), 1),
  );
  const [selected, setSelected] = useState<string>(() => dayKey(today));

  const grid = useMemo(() => buildGrid(month), [month]);

  const query = useQuery({
    queryKey: ["calendar", month.getFullYear(), month.getMonth(), refreshKey],
    queryFn: () => {
      // Fetch the whole visible block, not just the month, so events in the
      // leading/trailing days of the grid still show a dot.
      const timeMin = new Date(grid[0]);
      const timeMax = new Date(grid[grid.length - 1]);
      timeMax.setHours(23, 59, 59, 999);

      // Must be POST — the GET form of /api/search silently drops timeMin and
      // timeMax, which would return an unbounded event list.
      return apiFetch<CalendarSearchResponse>("/api/search", {
        method: "POST",
        body: JSON.stringify({
          target: "calendar",
          timeMin: timeMin.toISOString(),
          timeMax: timeMax.toISOString(),
          limit: 250,
        }),
      });
    },
  });

  // Bucket by local day once, rather than filtering 42 times while rendering.
  const byDay = useMemo(() => {
    const map = new Map<string, EventHit[]>();
    for (const event of query.data?.results ?? []) {
      if (!event.start) continue;
      const key = eventDayKey(event.start);
      const bucket = map.get(key);
      if (bucket) bucket.push(event);
      else map.set(key, [event]);
    }
    return map;
  }, [query.data]);

  const selectedEvents = byDay.get(selected) ?? [];
  const todayKey = dayKey(today);

  const shiftMonth = (delta: number) =>
    setMonth((current) => {
      const next = new Date(current.getFullYear(), current.getMonth() + delta, 1);
      return next;
    });

  if (!mounted) {
    return (
      <div className="space-y-2 px-3">
        <Skeleton className="mx-auto h-4 w-32" />
        <Skeleton className="h-[190px] w-full" />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 px-3">
        <div className="flex items-center justify-between">
          <button
            type="button"
            aria-label="Previous month"
            onClick={() => shiftMonth(-1)}
            className="rounded p-1 text-gray-600 transition-colors hover:bg-white/10 hover:text-cream"
          >
            <ChevronLeft className="size-3.5" />
          </button>
          <p className="text-xs font-medium text-cream">
            {month.toLocaleDateString(undefined, {
              month: "long",
              year: "numeric",
            })}
          </p>
          <button
            type="button"
            aria-label="Next month"
            onClick={() => shiftMonth(1)}
            className="rounded p-1 text-gray-600 transition-colors hover:bg-white/10 hover:text-cream"
          >
            <ChevronRight className="size-3.5" />
          </button>
        </div>

        <div className="mt-2 grid grid-cols-7">
          {WEEKDAYS.map((label, index) => (
            <span
              key={`${label}-${index}`}
              className="py-1 text-center text-[9px] uppercase text-gray-700"
            >
              {label}
            </span>
          ))}
        </div>

        <div className="grid grid-cols-7 gap-y-0.5">
          {grid.map((date) => {
            const key = dayKey(date);
            const inMonth = date.getMonth() === month.getMonth();
            const count = byDay.get(key)?.length ?? 0;

            return (
              <button
                key={key}
                type="button"
                onClick={() => setSelected(key)}
                className={cn(
                  "relative flex h-7 flex-col items-center justify-center rounded-md text-[11px] transition-colors",
                  inMonth ? "text-gray-300" : "text-gray-700",
                  key === selected
                    ? "bg-cream text-black"
                    : "hover:bg-white/10",
                  key === todayKey &&
                    key !== selected &&
                    "font-bold text-cream ring-1 ring-inset ring-cream/40",
                )}
              >
                {date.getDate()}
                {count > 0 && (
                  <span
                    className={cn(
                      "absolute bottom-0.5 size-1 rounded-full",
                      key === selected ? "bg-black/60" : "bg-cream/70",
                    )}
                  />
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-3 min-h-0 flex-1 overflow-y-auto border-t border-white/10 px-3 pt-3">
        <p className="mb-2 text-[10px] uppercase tracking-wider text-gray-600">
          {new Date(`${selected}T00:00:00`).toLocaleDateString(undefined, {
            weekday: "long",
            month: "short",
            day: "numeric",
          })}
        </p>

        {query.isPending && (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-full" />
            ))}
          </div>
        )}

        {query.isError && (
          <p className="text-xs text-gray-500">{query.error.message}</p>
        )}

        {query.isSuccess && selectedEvents.length === 0 && (
          <p className="py-4 text-xs text-gray-600">Nothing scheduled.</p>
        )}

        {selectedEvents.map((event, index) => (
          <article
            key={event.eventId || `${selected}-${index}`}
            className="mb-1 rounded-lg border-l-2 border-cream/40 bg-white/[0.03] py-1.5 pl-2.5 pr-2"
          >
            <p className="text-[10px] text-gray-500">
              {timeLabel(event.start)}
            </p>
            <p className="mt-0.5 text-xs leading-snug text-cream/90">
              {event.summary ?? "(untitled)"}
            </p>
            {(event.location || event.hangoutLink) && (
              <p className="mt-1 flex items-center gap-1 truncate text-[10px] text-gray-600">
                {event.hangoutLink ? (
                  <Video className="size-2.5 shrink-0" />
                ) : (
                  <MapPin className="size-2.5 shrink-0" />
                )}
                {event.hangoutLink ? "Video call" : event.location}
              </p>
            )}
          </article>
        ))}
      </div>
    </div>
  );
}
