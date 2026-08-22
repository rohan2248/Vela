"use client";

import { useQuery } from "@tanstack/react-query";
import { Loader2, Paperclip } from "lucide-react";

import { apiFetch, type MailMessage } from "@/lib/api-types";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function MailDetail({
  messageId,
  onClose,
}: {
  messageId: string | null;
  onClose: () => void;
}) {
  const { data, isPending, isError, error } = useQuery({
    queryKey: ["mail-message", messageId],
    enabled: !!messageId,
    // Bodies don't change; no point refetching one you've already opened.
    staleTime: 5 * 60_000,
    queryFn: () => apiFetch<MailMessage>(`/api/mail/${messageId}`),
  });

  return (
    <Dialog open={!!messageId} onOpenChange={(open) => !open && onClose()}>
      {/* DialogContent is `grid` by default, where a `flex-1` child does not
          fill and the popup just grows past max-h. Forcing a flex column is
          what gives the body a bounded height to scroll inside.

          The popup is still `height: auto` clamped by max-h — an *indefinite*
          height — so a descendant sized with a percentage height resolves to
          `auto` and grows to fit its content instead. That rules out
          <ScrollArea>, whose viewport is `size-full`: it would size to the
          whole message and silently clip. Flex sizing has no such problem. */}
      <DialogContent className="flex max-h-[85vh] flex-col gap-0 overflow-hidden border-white/10 bg-[#101010] p-0 sm:max-w-2xl">
        <DialogHeader className="shrink-0 border-b border-white/10 px-6 py-4">
          <DialogTitle className="pr-6 text-base leading-snug text-cream">
            {data?.subject ?? (isPending ? "Loading…" : "(no subject)")}
          </DialogTitle>
          <DialogDescription className="sr-only">
            Email message contents
          </DialogDescription>

          {data && (
            <div className="mt-2 space-y-0.5 text-[11px] text-gray-500">
              <p className="break-words">
                <span className="text-gray-600">From </span>
                {data.from ?? "unknown"}
              </p>
              {data.to && (
                <p className="break-words">
                  <span className="text-gray-600">To </span>
                  {data.to}
                </p>
              )}
              {data.cc && (
                <p className="break-words">
                  <span className="text-gray-600">Cc </span>
                  {data.cc}
                </p>
              )}
              {data.sentAt && (
                <p className="text-gray-600">
                  {new Date(data.sentAt).toLocaleString()}
                </p>
              )}
            </div>
          )}
        </DialogHeader>

        {/* tabIndex keeps a scrollable region reachable by keyboard — without
            it PageDown/arrows have nothing to act on. color-scheme is what
            paints the native scrollbar dark; the popup sets its own dark
            colors rather than inheriting a dark theme, so nothing else would. */}
        <div
          tabIndex={0}
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-5 outline-none scheme-dark"
        >
          {isPending && (
            <p className="flex items-center gap-2 text-xs text-gray-600">
              <Loader2 className="size-3 animate-spin" />
              Fetching message…
            </p>
          )}

          {isError && (
            <p className="text-xs text-red-400">{(error as Error).message}</p>
          )}

          {data &&
            (data.body ? (
              // Plain text only. This is somebody else's markup and it is not
              // going into the DOM — the route strips HTML server-side.
              <p className="whitespace-pre-wrap break-words text-[13px] leading-relaxed text-cream/85">
                {data.body}
              </p>
            ) : (
              <p className="text-xs italic text-gray-600">
                {data.snippet ?? "This message has no readable text body."}
              </p>
            ))}

          {data && data.attachments.length > 0 && (
            <div className="mt-6 border-t border-white/10 pt-4">
              <p className="mb-2 text-[10px] uppercase tracking-wider text-gray-600">
                {data.attachments.length} attachment
                {data.attachments.length === 1 ? "" : "s"}
              </p>
              <ul className="space-y-1.5">
                {data.attachments.map((file, index) => (
                  <li
                    key={`${file.filename}-${index}`}
                    className="flex items-center gap-2 text-xs text-gray-400"
                  >
                    <Paperclip className="size-3 shrink-0 text-gray-600" />
                    <span className="truncate">{file.filename}</span>
                    <span className="ml-auto shrink-0 text-[10px] text-gray-600">
                      {formatBytes(file.size)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
