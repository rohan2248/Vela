"use client";

import { useEffect, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import {
  DefaultChatTransport,
  lastAssistantMessageIsCompleteWithApprovalResponses,
  type UIMessage,
} from "ai";
import { ArrowUp, Square } from "lucide-react";

import { Message } from "@/components/workspace/message";
import { Button } from "@/components/ui/button";

const SUGGESTIONS = [
  "What came in this morning?",
  "When am I free on Thursday?",
  "Find the thread about the invoice",
  "Draft a reply to the last email from my manager",
];

export function ChatPanel({
  threadId,
  initialMessages,
  onThreadCreated,
}: {
  threadId: string | null;
  initialMessages: UIMessage[];
  /** Fires once a brand-new thread gets its server-assigned id. */
  onThreadCreated?: (id: string) => void;
}) {
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  // The transport owns its own session state.
  //
  // It has to stay identity-stable — rebuilding it would drop an in-flight
  // stream — yet its callbacks need the *current* thread id, which changes once
  // when a brand-new conversation is assigned one. Rather than bridge that with
  // a ref, the mutable bits live in this factory's closure: plain locals the
  // transport reads at request time, entirely outside React's ownership.
  const [session] = useState(() => {
    let currentThreadId = threadId;
    let notifyCreated: ((id: string) => void) | undefined;

    const transport = new DefaultChatTransport<UIMessage>({
      api: "/api/chat",

      // The route reads `threadId`, but the default transport sends `id`.
      // Without this every turn would land in the create branch and spawn a
      // brand-new thread. The returned body REPLACES the default one, so
      // `messages` has to be passed through explicitly.
      prepareSendMessagesRequest: ({ messages }) => ({
        body: {
          messages,
          threadId: currentThreadId ?? undefined,
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        },
      }),

      // A new thread's id comes back only as a response header — not as a
      // stream part and not in any JSON body — and useChat gives no access to
      // the response, so it gets intercepted here.
      fetch: async (url, init) => {
        const response = await fetch(url, init);
        const assigned = response.headers.get("x-thread-id");
        if (assigned && assigned !== currentThreadId) {
          currentThreadId = assigned;
          notifyCreated?.(assigned);
        }
        return response;
      },
    });

    return {
      transport,
      onCreated(handler: ((id: string) => void) | undefined) {
        notifyCreated = handler;
      },
    };
  });

  useEffect(() => {
    session.onCreated(onThreadCreated);
  }, [session, onThreadCreated]);

  const { messages, sendMessage, status, error, stop, addToolApprovalResponse } =
    useChat({
      id: threadId ?? "draft",
      messages: initialMessages,
      transport: session.transport,

      // Approving a tool only mutates local message state. Without this the
      // approved call is never sent back and the turn stalls silently.
      sendAutomaticallyWhen:
        lastAssistantMessageIsCompleteWithApprovalResponses,
    });

  const busy = status === "submitted" || status === "streaming";

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  const submit = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    setInput("");
    void sendMessage({ text: trimmed });
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-6 py-8">
          {messages.length === 0 ? (
            <div className="flex flex-col items-center pt-[12vh] text-center">
              <h2 className="text-3xl text-cream sm:text-4xl">
                What needs doing?
              </h2>
              <p className="mt-3 max-w-md text-sm text-gray-500">
                Vela can read your mail, hold your calendar, and draft on your
                behalf. Nothing leaves your account without your approval.
              </p>
              <div className="mt-8 flex w-full max-w-lg flex-col gap-2">
                {SUGGESTIONS.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    onClick={() => submit(suggestion)}
                    className="rounded-xl border border-white/10 bg-[#101010] px-4 py-2.5 text-left text-sm text-gray-400 transition-colors hover:border-cream/30 hover:text-cream"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              {messages.map((message) => (
                <Message
                  key={message.id}
                  message={message}
                  onApprove={addToolApprovalResponse}
                />
              ))}
            </div>
          )}

          {error && (
            <div className="mt-6 rounded-xl border border-red-500/25 bg-red-500/5 px-4 py-3">
              <p className="text-xs text-red-400">{error.message}</p>
            </div>
          )}
        </div>
      </div>

      <div className="shrink-0 px-6 pb-6">
        <div className="mx-auto w-full max-w-3xl">
          <div className="flex items-end gap-2 rounded-2xl border border-white/10 bg-[#101010] p-2 focus-within:border-cream/30">
            <textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  submit(input);
                }
              }}
              rows={1}
              placeholder="Ask Vela…"
              className="max-h-40 flex-1 resize-none bg-transparent px-3 py-2 text-sm text-cream placeholder:text-gray-600 focus:outline-none"
            />
            {busy ? (
              <Button
                size="icon"
                variant="ghost"
                onClick={() => void stop()}
                className="size-9 shrink-0 rounded-full bg-white/10 text-cream hover:bg-white/20"
                aria-label="Stop generating"
              >
                <Square className="size-3.5 fill-current" />
              </Button>
            ) : (
              <Button
                size="icon"
                variant="ghost"
                onClick={() => submit(input)}
                disabled={!input.trim()}
                className="size-9 shrink-0 rounded-full bg-cream text-black hover:bg-cream/90 disabled:opacity-30"
                aria-label="Send message"
              >
                <ArrowUp className="size-4" />
              </Button>
            )}
          </div>
          <p className="mt-2 text-center text-[10px] text-gray-700">
            Vela asks before sending mail or inviting anyone.
          </p>
        </div>
      </div>
    </div>
  );
}
