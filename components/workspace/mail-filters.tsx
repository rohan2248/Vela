"use client";

import { Check, X } from "lucide-react";

import { buildGmailQuery, type SearchFilters } from "@/lib/gmail-query";
import { cn } from "@/lib/utils";

/**
 * Structured editor for Gmail advanced search.
 *
 * Edits `SearchFilters` rather than a query string, and lets the server derive
 * `q` from it — `lib/gmail-query.ts` is pure and dependency-free, so the exact
 * same builder runs here for the live preview and on the server for the actual
 * search. No second grammar to keep in sync.
 */

const IN_OPTIONS = ["inbox", "sent", "anywhere"] as const;

const WINDOWS: { label: string; value: string }[] = [
  { label: "24h", value: "1d" },
  { label: "7d", value: "7d" },
  { label: "30d", value: "30d" },
  { label: "1y", value: "1y" },
];

type ToggleKey = "hasAttachment" | "isUnread" | "isStarred" | "isImportant";

const TOGGLES: { key: ToggleKey; label: string }[] = [
  { key: "isUnread", label: "Unread" },
  { key: "hasAttachment", label: "Attachment" },
  { key: "isStarred", label: "Starred" },
  { key: "isImportant", label: "Important" },
];

/** Every active filter as a removable chip, plus how to clear it. */
export function activeChips(
  filters: SearchFilters,
): { label: string; clear: (f: SearchFilters) => SearchFilters }[] {
  const chips: { label: string; clear: (f: SearchFilters) => SearchFilters }[] =
    [];

  for (const key of ["from", "to", "subject"] as const) {
    for (const value of filters[key] ?? []) {
      chips.push({
        label: `${key}:${value}`,
        clear: (f) => ({
          ...f,
          [key]: (f[key] ?? []).filter((v) => v !== value),
        }),
      });
    }
  }

  for (const { key, label } of TOGGLES) {
    if (filters[key]) {
      chips.push({ label, clear: (f) => ({ ...f, [key]: undefined }) });
    }
  }

  if (filters.newerThan) {
    chips.push({
      label: `newer than ${filters.newerThan}`,
      clear: (f) => ({ ...f, newerThan: undefined }),
    });
  }

  if (filters.in && filters.in !== "inbox") {
    chips.push({
      label: `in:${filters.in}`,
      clear: (f) => ({ ...f, in: "inbox" }),
    });
  }

  return chips;
}

export function hasActiveFilters(filters: SearchFilters): boolean {
  return activeChips(filters).length > 0;
}

function FieldRow({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <label className="flex items-center gap-2">
      <span className="w-12 shrink-0 text-[10px] text-gray-600">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="min-w-0 flex-1 rounded border border-white/10 bg-black/40 px-2 py-1 text-[11px] text-cream placeholder:text-gray-700 focus:border-cream/30 focus:outline-none"
      />
    </label>
  );
}

export function MailFilters({
  filters,
  onChange,
}: {
  filters: SearchFilters;
  onChange: (filters: SearchFilters) => void;
}) {
  const set = (patch: Partial<SearchFilters>) =>
    onChange({ ...filters, ...patch });

  // A single address per field keeps the control simple; the underlying schema
  // accepts arrays, so this is a UI narrowing rather than a data limitation.
  const single = (key: "from" | "to" | "subject") => filters[key]?.[0] ?? "";
  const setSingle = (key: "from" | "to" | "subject", value: string) =>
    set({ [key]: value.trim() ? [value.trim()] : undefined });

  const preview = buildGmailQuery(filters);

  return (
    <div className="space-y-2.5 rounded-lg border border-white/10 bg-black/30 p-2.5">
      <FieldRow
        label="From"
        value={single("from")}
        onChange={(value) => setSingle("from", value)}
        placeholder="name@company.com"
      />
      <FieldRow
        label="To"
        value={single("to")}
        onChange={(value) => setSingle("to", value)}
        placeholder="name@company.com"
      />
      <FieldRow
        label="Subject"
        value={single("subject")}
        onChange={(value) => setSingle("subject", value)}
        placeholder="contains…"
      />

      <div className="flex flex-wrap gap-1">
        {TOGGLES.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            onClick={() => set({ [key]: filters[key] ? undefined : true })}
            className={cn(
              "flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] transition-colors",
              filters[key]
                ? "bg-cream text-black"
                : "bg-white/5 text-gray-400 hover:bg-white/10",
            )}
          >
            {filters[key] && <Check className="size-2.5" />}
            {label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-1">
        <span className="w-12 shrink-0 text-[10px] text-gray-600">Within</span>
        {WINDOWS.map(({ label, value }) => (
          <button
            key={value}
            type="button"
            onClick={() =>
              set({ newerThan: filters.newerThan === value ? undefined : value })
            }
            className={cn(
              "rounded-full px-2 py-0.5 text-[10px] transition-colors",
              filters.newerThan === value
                ? "bg-cream text-black"
                : "bg-white/5 text-gray-400 hover:bg-white/10",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-1">
        <span className="w-12 shrink-0 text-[10px] text-gray-600">In</span>
        {IN_OPTIONS.map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => set({ in: option })}
            className={cn(
              "rounded-full px-2 py-0.5 text-[10px] capitalize transition-colors",
              (filters.in ?? "inbox") === option
                ? "bg-cream text-black"
                : "bg-white/5 text-gray-400 hover:bg-white/10",
            )}
          >
            {option}
          </button>
        ))}
      </div>

      {/* The generated query, so the syntax is learnable rather than hidden. */}
      {preview && (
        <p className="truncate border-t border-white/10 pt-2 font-mono text-[10px] text-gray-600">
          {preview}
        </p>
      )}
    </div>
  );
}

export function FilterChips({
  filters,
  onChange,
}: {
  filters: SearchFilters;
  onChange: (filters: SearchFilters) => void;
}) {
  const chips = activeChips(filters);
  if (!chips.length) return null;

  return (
    <div className="flex flex-wrap gap-1 pt-2">
      {chips.map((chip) => (
        <button
          key={chip.label}
          type="button"
          onClick={() => onChange(chip.clear(filters))}
          className="flex items-center gap-1 rounded-full bg-cream/10 px-2 py-0.5 text-[10px] text-cream transition-colors hover:bg-cream/20"
        >
          {chip.label}
          <X className="size-2.5" />
        </button>
      ))}
    </div>
  );
}
