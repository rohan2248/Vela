"use client";

import { useCallback, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { UIMessage } from "ai";
import {
  Calendar,
  Inbox,
  LogOut,
  Menu,
  PenSquare,
  PanelRight,
  Wifi,
  WifiOff,
  X,
} from "lucide-react";

import { authClient } from "@/lib/auth-client";
import { apiFetch } from "@/lib/api-types";
import type { RealtimeEvent } from "@/lib/realtime";
import { useRealtime } from "@/hooks/use-realtime";
import { ChatPanel } from "@/components/workspace/chat-panel";
import { ThreadList } from "@/components/workspace/thread-list";
import { MailPane } from "@/components/workspace/mail-pane";
import { CalendarPane } from "@/components/workspace/calendar-pane";
import { ConnectionBanner } from "@/components/workspace/connection-banner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

/** Which slide-over is showing on small screens, where the rails are hidden. */
type MobilePanel = "none" | "threads" | "context";

function Wordmark() {
  return (
    <span className="text-lg tracking-[-0.04em] text-cream">
      Vela
      <span className="relative top-[-0.5em] text-[0.4em]">*</span>
    </span>
  );
}

export function WorkspaceShell({ userEmail }: { userEmail: string }) {
  const queryClient = useQueryClient();

  // Two ids, deliberately. `selectedThreadId` is what the user picked and is
  // what keys the ChatPanel; `liveThreadId` is whatever conversation is on
  // screen, including a draft that has just been assigned an id by the server.
  // Folding them together would change the key mid-stream and remount the
  // panel, throwing away the reply currently arriving.
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [liveThreadId, setLiveThreadId] = useState<string | null>(null);
  // Bumped to force a fresh ChatPanel when starting a new conversation, since
  // useChat only rebuilds its internal state when its id changes.
  const [draftNonce, setDraftNonce] = useState(0);
  const [mailVersion, setMailVersion] = useState(0);
  const [calendarVersion, setCalendarVersion] = useState(0);
  const [mobilePanel, setMobilePanel] = useState<MobilePanel>("none");

  // Google push, arriving over SSE from Corsair's webhook ingest. This is what
  // replaces polling: the panes only refetch when Google says something
  // actually changed, and each kind refreshes just its own pane.
  const { connected } = useRealtime(
    useCallback((event: RealtimeEvent) => {
      if (event.kind.startsWith("email.")) {
        setMailVersion((version) => version + 1);
      } else if (event.kind.startsWith("calendar.")) {
        setCalendarVersion((version) => version + 1);
      }
      // sync.progress is handled by the mail pane's own backfill poll.
    }, []),
  );

  const history = useQuery({
    queryKey: ["thread-messages", selectedThreadId],
    enabled: !!selectedThreadId,
    queryFn: () =>
      apiFetch<{ messages: UIMessage[] }>(
        `/api/chat/threads/${selectedThreadId}`,
      ),
  });

  // The OAuth callback lands back here with ?connect=… — refresh the
  // integration state and clear the params so a reload doesn't re-show it.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (!params.has("connect")) return;
    void queryClient.invalidateQueries({ queryKey: ["corsair-status"] });
    window.history.replaceState({}, "", window.location.pathname);
  }, [queryClient]);

  const selectThread = (id: string | null) => {
    setSelectedThreadId(id);
    setLiveThreadId(id);
    setMobilePanel("none");
  };

  const startNewChat = () => {
    setSelectedThreadId(null);
    setLiveThreadId(null);
    setDraftNonce((nonce) => nonce + 1);
    setMobilePanel("none");
  };

  const railButton =
    "flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs transition-colors";

  const historyBlock = (
    <>
      <p className="px-2.5 py-1.5 text-[10px] uppercase tracking-wider text-gray-700">
        History
      </p>
      <ThreadList activeThreadId={liveThreadId} onSelect={selectThread} />
    </>
  );

  const contextBlock = (
    <Tabs defaultValue="mail" className="flex min-h-0 flex-1 flex-col">
      <TabsList className="mx-4 mt-4 shrink-0">
        <TabsTrigger value="mail" className="gap-1.5 text-xs">
          <Inbox className="size-3" />
          Inbox
        </TabsTrigger>
        <TabsTrigger value="calendar" className="gap-1.5 text-xs">
          <Calendar className="size-3" />
          Calendar
        </TabsTrigger>
      </TabsList>

      <div className="mt-3 flex min-h-0 flex-1 flex-col">
        <ConnectionBanner />
        <TabsContent value="mail" className="mt-0 min-h-0 flex-1">
          <MailPane refreshKey={mailVersion} />
        </TabsContent>
        <TabsContent
          value="calendar"
          className="mt-0 flex min-h-0 flex-1 flex-col"
        >
          <CalendarPane refreshKey={calendarVersion} />
        </TabsContent>
      </div>
    </Tabs>
  );

  const signOutButton = (
    <button
      type="button"
      onClick={() =>
        void authClient.signOut().then(() => {
          window.location.href = "/";
        })
      }
      className={cn(
        railButton,
        "text-gray-500 hover:bg-white/5 hover:text-cream",
      )}
    >
      <LogOut className="size-3.5" />
      Sign out
    </button>
  );

  return (
    <div className="flex h-full flex-col lg:grid lg:grid-cols-[240px_1fr_320px]">
      {/* Mobile header. Without it the rails below are unreachable on a phone —
          including the connect button, which is the whole onboarding path. */}
      <header className="flex shrink-0 items-center justify-between border-b border-white/10 bg-[#0a0a0a] px-3 py-2.5 lg:hidden">
        <button
          type="button"
          aria-label="Conversations"
          onClick={() =>
            setMobilePanel((panel) =>
              panel === "threads" ? "none" : "threads",
            )
          }
          className="rounded-lg p-1.5 text-gray-400 hover:bg-white/10 hover:text-cream"
        >
          {mobilePanel === "threads" ? (
            <X className="size-4" />
          ) : (
            <Menu className="size-4" />
          )}
        </button>

        <Wordmark />

        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label="New conversation"
            onClick={startNewChat}
            className="rounded-lg p-1.5 text-gray-400 hover:bg-white/10 hover:text-cream"
          >
            <PenSquare className="size-4" />
          </button>
          <button
            type="button"
            aria-label="Mail and calendar"
            onClick={() =>
              setMobilePanel((panel) =>
                panel === "context" ? "none" : "context",
              )
            }
            className="rounded-lg p-1.5 text-gray-400 hover:bg-white/10 hover:text-cream"
          >
            {mobilePanel === "context" ? (
              <X className="size-4" />
            ) : (
              <PanelRight className="size-4" />
            )}
          </button>
        </div>
      </header>

      {/* Left rail — desktop only */}
      <aside className="hidden min-h-0 flex-col border-r border-white/10 bg-[#0a0a0a] lg:flex">
        <div className="flex items-center justify-between px-4 py-4">
          <Wordmark />
          <span
            title={connected ? "Live" : "Reconnecting"}
            className={cn(connected ? "text-cream/60" : "text-gray-700")}
          >
            {connected ? (
              <Wifi className="size-3" />
            ) : (
              <WifiOff className="size-3" />
            )}
          </span>
        </div>

        <div className="px-2">
          <button
            type="button"
            onClick={startNewChat}
            className={cn(railButton, "text-cream hover:bg-white/10")}
          >
            <PenSquare className="size-3.5" />
            New conversation
          </button>
        </div>

        <div className="mt-4 min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          {historyBlock}
        </div>

        <div className="border-t border-white/10 p-2">
          <p className="truncate px-2.5 py-1 text-[11px] text-gray-600">
            {userEmail}
          </p>
          {signOutButton}
        </div>
      </aside>

      {/* Chat */}
      <main className="relative min-h-0 min-w-0 flex-1">
        {selectedThreadId && history.isPending ? (
          <div className="flex h-full items-center justify-center">
            <p className="text-xs text-gray-600">Loading conversation…</p>
          </div>
        ) : (
          <ChatPanel
            key={selectedThreadId ?? `draft-${draftNonce}`}
            threadId={selectedThreadId}
            initialMessages={history.data?.messages ?? []}
            onThreadCreated={(id) => {
              // Deliberately does not touch selectedThreadId — that would
              // change this panel's key and remount it mid-reply.
              setLiveThreadId(id);
              void queryClient.invalidateQueries({ queryKey: ["threads"] });
            }}
          />
        )}

        {/* Mobile slide-overs, stacked above the chat rather than beside it. */}
        {mobilePanel !== "none" && (
          <div className="absolute inset-0 z-20 flex flex-col bg-[#0a0a0a] lg:hidden">
            {mobilePanel === "threads" ? (
              <>
                <div className="min-h-0 flex-1 overflow-y-auto px-2 pt-3">
                  {historyBlock}
                </div>
                <div className="border-t border-white/10 p-2">
                  <p className="truncate px-2.5 py-1 text-[11px] text-gray-600">
                    {userEmail}
                  </p>
                  {signOutButton}
                </div>
              </>
            ) : (
              contextBlock
            )}
          </div>
        )}
      </main>

      {/* Context rail — desktop only */}
      <aside className="hidden min-h-0 flex-col border-l border-white/10 bg-[#0a0a0a] lg:flex">
        {contextBlock}
      </aside>
    </div>
  );
}
