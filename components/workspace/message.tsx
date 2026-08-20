"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import type { UIMessage } from "ai";

import { ToolCall } from "@/components/workspace/tool-call";
import { cn } from "@/lib/utils";

/**
 * Renders one UIMessage.
 *
 * Messages carry `parts`, not `content`, and a tool call is a single part that
 * changes state rather than a call/result pair — so parts are walked in order
 * and dispatched on `type`.
 */

type AnyPart = {
  type: string;
  text?: string;
  state?: string;
  [key: string]: unknown;
};

function isToolPart(part: AnyPart) {
  return part.type === "dynamic-tool" || part.type.startsWith("tool-");
}

/** Anthropic thinking is on with display:"summarized", so these do arrive. */
function Reasoning({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  if (!text.trim()) return null;

  return (
    <div className="my-1.5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] text-gray-600 transition-colors hover:text-gray-400"
      >
        <ChevronDown
          className={cn("size-3 transition-transform", open && "rotate-180")}
        />
        Thought for a moment
      </button>
      {open && (
        <p className="mt-1 whitespace-pre-wrap rounded-lg bg-black/40 p-3 text-xs leading-relaxed text-gray-500">
          {text}
        </p>
      )}
    </div>
  );
}

export function Message({
  message,
  onApprove,
}: {
  message: UIMessage;
  onApprove?: (args: {
    id: string;
    approved: boolean;
    reason?: string;
  }) => void;
}) {
  const parts = (message.parts ?? []) as AnyPart[];
  const isUser = message.role === "user";

  if (isUser) {
    const text = parts
      .filter((part) => part.type === "text")
      .map((part) => part.text ?? "")
      .join("");

    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-[#212121] px-4 py-2.5">
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-cream">
            {text}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-[92%] space-y-1">
      {parts.map((part, index) => {
        const key = `${message.id}-${index}`;

        if (part.type === "text") {
          if (!part.text?.trim()) return null;
          return (
            <p
              key={key}
              className="whitespace-pre-wrap text-sm leading-relaxed text-cream/90"
            >
              {part.text}
            </p>
          );
        }

        if (part.type === "reasoning") {
          return <Reasoning key={key} text={part.text ?? ""} />;
        }

        if (isToolPart(part)) {
          return <ToolCall key={key} part={part} onApprove={onApprove} />;
        }

        // step-start, data-*, source-* — nothing to show inline.
        return null;
      })}
    </div>
  );
}
