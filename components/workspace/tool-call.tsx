"use client";

import { useState } from "react";
import {
  AlertTriangle,
  Calendar,
  CalendarPlus,
  Check,
  ChevronDown,
  Clock,
  Loader2,
  Search,
  Send,
  Sparkles,
  Terminal,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Renders one tool invocation.
 *
 * A tool part is a single object that moves through states rather than a
 * call/result pair:
 *   input-streaming → input-available
 *     → (approval-requested → approval-responded)
 *     → output-available | output-error | output-denied
 *
 * send_email, create_calendar_event and run_script always stop at
 * approval-requested, because the chat route never sets autoApprove. If nothing
 * answers that request the turn hangs forever, so the approval card below is
 * load-bearing, not decoration.
 */

type ToolPartLike = {
  type: string;
  toolCallId?: string;
  toolName?: string;
  state?: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
  approval?: { id: string; approved?: boolean; reason?: string };
};

const TOOL_META: Record<
  string,
  { label: string; icon: React.ComponentType<{ className?: string }> }
> = {
  resolve_datetime: { label: "Working out the time", icon: Clock },
  search_email: { label: "Searching your mail", icon: Search },
  semantic_search_email: { label: "Recalling from your mail", icon: Sparkles },
  list_calendar_events: { label: "Checking your calendar", icon: Calendar },
  find_free_time: { label: "Finding a free slot", icon: Clock },
  send_email: { label: "Send an email", icon: Send },
  create_calendar_event: { label: "Create a calendar event", icon: CalendarPlus },
  list_operations: { label: "Listing operations", icon: Terminal },
  get_schema: { label: "Reading an API schema", icon: Terminal },
  run_script: { label: "Run a script", icon: Terminal },
};

function metaFor(name: string) {
  return TOOL_META[name] ?? { label: name, icon: Terminal };
}

/** Human summary of a finished call, so the common case needs no expanding. */
function summarize(name: string, output: unknown): string | null {
  if (typeof output === "string") {
    return output.length > 140 ? `${output.slice(0, 140)}…` : output;
  }
  if (!output || typeof output !== "object") return null;
  const o = output as Record<string, unknown>;

  switch (name) {
    case "search_email":
    case "semantic_search_email": {
      const count = typeof o.count === "number" ? o.count : 0;
      return count === 1 ? "1 message" : `${count} messages`;
    }
    case "list_calendar_events": {
      const count = typeof o.count === "number" ? o.count : 0;
      return count === 1 ? "1 event" : `${count} events`;
    }
    case "find_free_time": {
      const free = Array.isArray(o.free) ? o.free.length : 0;
      return free === 1 ? "1 open slot" : `${free} open slots`;
    }
    case "resolve_datetime":
      return typeof o.humanReadable === "string" ? o.humanReadable : null;
    case "send_email":
      return typeof o.subject === "string" ? `Sent — "${o.subject}"` : "Sent";
    case "create_calendar_event": {
      const note = o.invitesSent === false ? " (invites not delivered)" : "";
      return typeof o.start === "string"
        ? `Created for ${new Date(o.start).toLocaleString()}${note}`
        : `Created${note}`;
    }
    default:
      return null;
  }
}

/** The details a person needs to judge an action before it happens. */
function ApprovalDetails({ name, input }: { name: string; input: unknown }) {
  if (!input || typeof input !== "object") return null;
  const i = input as Record<string, unknown>;
  const rows: [string, string][] = [];

  if (name === "send_email") {
    if (Array.isArray(i.to)) rows.push(["To", i.to.join(", ")]);
    if (Array.isArray(i.cc) && i.cc.length) rows.push(["Cc", i.cc.join(", ")]);
    if (Array.isArray(i.bcc) && i.bcc.length)
      rows.push(["Bcc", i.bcc.join(", ")]);
    if (typeof i.subject === "string") rows.push(["Subject", i.subject]);
    if (typeof i.body === "string") rows.push(["Body", i.body]);
  } else if (name === "create_calendar_event") {
    if (typeof i.summary === "string") rows.push(["Title", i.summary]);
    if (typeof i.startISO === "string")
      rows.push(["Starts", new Date(i.startISO).toLocaleString()]);
    if (typeof i.endISO === "string")
      rows.push(["Ends", new Date(i.endISO).toLocaleString()]);
    if (Array.isArray(i.attendees) && i.attendees.length)
      rows.push(["Attendees", i.attendees.join(", ")]);
    if (typeof i.location === "string") rows.push(["Location", i.location]);
  } else if (name === "run_script" && typeof i.code === "string") {
    rows.push(["Code", i.code]);
  }

  if (!rows.length) {
    return (
      <pre className="mt-3 overflow-x-auto rounded-md bg-black/40 p-3 text-[11px] text-gray-400">
        {JSON.stringify(input, null, 2)}
      </pre>
    );
  }

  return (
    <dl className="mt-3 space-y-2 text-xs">
      {rows.map(([label, value]) => (
        <div key={label} className="grid grid-cols-[64px_1fr] gap-2">
          <dt className="text-gray-500">{label}</dt>
          <dd className="whitespace-pre-wrap break-words text-gray-300">
            {value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function ToolCall({
  part,
  onApprove,
}: {
  part: ToolPartLike;
  /** useChat's addToolApprovalResponse. Absent while a turn is streaming. */
  onApprove?: (args: {
    id: string;
    approved: boolean;
    reason?: string;
  }) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  // Static tool parts are typed `tool-<name>`; MCP tools arrive as dynamic-tool
  // with the real name on the part itself.
  const name =
    part.type === "dynamic-tool"
      ? (part.toolName ?? "unknown")
      : part.type.replace(/^tool-/, "");

  const { label, icon: Icon } = metaFor(name);
  const state = part.state ?? "input-streaming";

  if (state === "approval-requested" && part.approval?.id) {
    const approvalId = part.approval.id;
    return (
      <div className="my-2 rounded-xl border border-cream/25 bg-[#161616] p-4">
        <div className="flex items-center gap-2">
          <AlertTriangle className="size-4 shrink-0 text-cream" />
          <p className="text-sm font-medium text-cream">{label}?</p>
        </div>
        <p className="mt-1 text-xs text-gray-500">
          Vela needs your approval — this leaves your account.
        </p>

        <ApprovalDetails name={name} input={part.input} />

        <div className="mt-4 flex items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            className="h-8 gap-1.5 rounded-full bg-cream px-4 text-black hover:bg-cream/90"
            onClick={() => onApprove?.({ id: approvalId, approved: true })}
            disabled={!onApprove}
          >
            <Check className="size-3.5" />
            Approve
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-8 gap-1.5 rounded-full px-4 text-gray-400 hover:text-cream"
            onClick={() =>
              onApprove?.({
                id: approvalId,
                approved: false,
                reason: "Declined by the user",
              })
            }
            disabled={!onApprove}
          >
            <X className="size-3.5" />
            Decline
          </Button>
        </div>
      </div>
    );
  }

  const running =
    state === "input-streaming" ||
    state === "input-available" ||
    state === "approval-responded";
  const failed = state === "output-error";
  const denied = state === "output-denied";
  const summary = state === "output-available" ? summarize(name, part.output) : null;

  return (
    <div className="my-1.5">
      <button
        type="button"
        onClick={() => setExpanded((open) => !open)}
        className="group flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-white/5"
      >
        {running ? (
          <Loader2 className="size-3.5 shrink-0 animate-spin text-gray-500" />
        ) : failed || denied ? (
          <X className="size-3.5 shrink-0 text-red-400" />
        ) : (
          <Icon className="size-3.5 shrink-0 text-cream/70" />
        )}

        <span className="text-xs text-gray-400">{label}</span>

        {summary && (
          <span className="truncate text-xs text-gray-600">— {summary}</span>
        )}
        {denied && <span className="text-xs text-gray-600">— declined</span>}
        {failed && (
          <span className="truncate text-xs text-red-400/80">
            — {part.errorText ?? "failed"}
          </span>
        )}

        <ChevronDown
          className={cn(
            "ml-auto size-3 shrink-0 text-gray-700 transition-transform",
            expanded && "rotate-180",
          )}
        />
      </button>

      {expanded && (
        <div className="mt-1 space-y-2 rounded-lg bg-black/40 p-3">
          <div>
            <p className="mb-1 text-[10px] uppercase tracking-wider text-gray-600">
              Input
            </p>
            <pre className="overflow-x-auto text-[11px] text-gray-400">
              {JSON.stringify(part.input ?? {}, null, 2)}
            </pre>
          </div>
          {part.output !== undefined && (
            <div>
              <p className="mb-1 text-[10px] uppercase tracking-wider text-gray-600">
                Output
              </p>
              <pre className="max-h-64 overflow-auto text-[11px] text-gray-400">
                {typeof part.output === "string"
                  ? part.output
                  : JSON.stringify(part.output, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
