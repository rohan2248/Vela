"use client";

import { useSyncExternalStore } from "react";

/**
 * False during SSR and the first client render, true afterwards.
 *
 * Gate anything whose output depends on the browser rather than the server:
 * `toLocaleDateString(undefined, …)` resolves to the *server's* locale when
 * prerendered and the *browser's* locale on the client, and `Date.now()`
 * differs between the two. Either one produces a hydration mismatch, which
 * makes React throw away the tree and re-render it.
 *
 * Panes that render a loading skeleton until their query resolves lose nothing
 * by skipping SSR — the prerendered output was the skeleton anyway.
 */
/** Stable no-op: the value never changes, so there is nothing to subscribe to. */
const subscribe = () => () => {};

export function useMounted(): boolean {
  // useSyncExternalStore rather than useState + useEffect: it takes an explicit
  // server snapshot, so React knows the two renders differ by design instead of
  // treating it as a mismatch — and it avoids setting state from an effect.
  return useSyncExternalStore(
    subscribe,
    () => true, // client
    () => false, // server
  );
}
