"use client";

import { useEffect, useRef, useState } from "react";

import type { RealtimeEvent } from "@/lib/realtime";

/**
 * Subscribes to the server's Google push feed.
 *
 * Two things about /api/stream that are easy to get wrong:
 *  - Its events are *named* (`ready`, `corsair`), so `onmessage` never fires.
 *    You have to addEventListener for each name.
 *  - Its heartbeat is a bare SSE comment (`: ping`), which is invisible to
 *    EventSource handlers — silence is not a dropped connection.
 *
 * The endpoint takes no query params and authenticates from the session cookie.
 */
export function useRealtime(onEvent?: (event: RealtimeEvent) => void) {
  const [connected, setConnected] = useState(false);
  const [lastEvent, setLastEvent] = useState<RealtimeEvent | null>(null);

  // Held in a ref so a caller passing an inline arrow doesn't tear down and
  // reopen the EventSource on every render. Assigned in an effect rather than
  // during render — writing a ref mid-render is what the refs lint rule bans.
  const handlerRef = useRef(onEvent);
  useEffect(() => {
    handlerRef.current = onEvent;
  }, [onEvent]);

  useEffect(() => {
    const source = new EventSource("/api/stream");

    const handleReady = () => setConnected(true);

    const handleCorsair = (event: MessageEvent<string>) => {
      try {
        const payload = JSON.parse(event.data) as RealtimeEvent;
        setLastEvent(payload);
        handlerRef.current?.(payload);
      } catch {
        // A malformed frame shouldn't kill the subscription.
      }
    };

    source.addEventListener("ready", handleReady);
    source.addEventListener("corsair", handleCorsair);
    // EventSource reconnects on its own; this only reflects the current state.
    source.onerror = () => setConnected(false);

    return () => {
      source.removeEventListener("ready", handleReady);
      source.removeEventListener("corsair", handleCorsair);
      source.close();
    };
  }, []);

  return { connected, lastEvent };
}
