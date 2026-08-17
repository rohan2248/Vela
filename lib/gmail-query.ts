/**
 * Bidirectional translation between structured filters and Gmail's advanced
 * search syntax.
 *
 * Both directions matter for the UI: `build` turns filter chips into the `q`
 * that Gmail (and Corsair's `messages.list`) understands, and `parse` turns a
 * query someone typed or pasted back into chips. They are inverses, so a user
 * can switch between the two editors without losing anything.
 *
 * Pure and dependency-free — no Corsair, no database, no network.
 */

export type SearchFilters = {
  from?: string[];
  to?: string[];
  cc?: string[];
  bcc?: string[];
  subject?: string[];
  /** Bare words and quoted phrases that must appear. */
  includes?: string[];
  /** Terms prefixed with `-`. */
  excludes?: string[];
  label?: string[];
  /** inbox | sent | drafts | trash | spam | anywhere */
  in?: string;
  /** primary | social | promotions | updates | forums */
  category?: string;
  filename?: string[];
  list?: string[];
  hasAttachment?: boolean;
  isUnread?: boolean;
  isRead?: boolean;
  isStarred?: boolean;
  isImportant?: boolean;
  /** YYYY/MM/DD (Gmail's own format) — ISO dates are normalised on the way in. */
  after?: string;
  before?: string;
  /** Relative windows, e.g. "7d", "2m", "1y". */
  newerThan?: string;
  olderThan?: string;
  /** Size bounds, e.g. "10M", "500K". */
  largerThan?: string;
  smallerThan?: string;
  /**
   * Anything we don't model — OR groups, parenthesised expressions — preserved
   * verbatim so a hand-written query survives a round trip.
   */
  raw?: string[];
};

const FIELD_KEYS = [
  "from",
  "to",
  "cc",
  "bcc",
  "subject",
  "label",
  "filename",
  "list",
] as const;

type FieldKey = (typeof FIELD_KEYS)[number];

const needsQuoting = (value: string) => /[\s"()]/.test(value);

function quote(value: string): string {
  if (!needsQuoting(value)) return value;
  return `"${value.replace(/"/g, '\\"')}"`;
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).replace(/\\"/g, '"');
  }
  return trimmed;
}

/** Gmail wants YYYY/MM/DD; accept ISO and Date so callers don't have to care. */
function normaliseDate(value: string | Date | undefined): string | undefined {
  if (!value) return undefined;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return undefined;
    return `${value.getUTCFullYear()}/${String(value.getUTCMonth() + 1).padStart(2, "0")}/${String(value.getUTCDate()).padStart(2, "0")}`;
  }
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (iso) return `${iso[1]}/${iso[2]}/${iso[3]}`;
  return value;
}

// ---------------------------------------------------------------------------
// build
// ---------------------------------------------------------------------------

export function buildGmailQuery(filters: SearchFilters): string {
  const parts: string[] = [];

  const pushList = (key: FieldKey, values?: string[]) => {
    for (const value of values ?? []) {
      const trimmed = value.trim();
      if (trimmed) parts.push(`${key}:${quote(trimmed)}`);
    }
  };

  for (const key of FIELD_KEYS) pushList(key, filters[key]);

  for (const term of filters.includes ?? []) {
    const trimmed = term.trim();
    if (trimmed) parts.push(quote(trimmed));
  }
  for (const term of filters.excludes ?? []) {
    const trimmed = term.trim();
    if (trimmed) parts.push(`-${quote(trimmed)}`);
  }

  if (filters.in) parts.push(`in:${filters.in}`);
  if (filters.category) parts.push(`category:${filters.category}`);
  if (filters.hasAttachment) parts.push("has:attachment");
  if (filters.isUnread) parts.push("is:unread");
  if (filters.isRead) parts.push("is:read");
  if (filters.isStarred) parts.push("is:starred");
  if (filters.isImportant) parts.push("is:important");

  const after = normaliseDate(filters.after);
  const before = normaliseDate(filters.before);
  if (after) parts.push(`after:${after}`);
  if (before) parts.push(`before:${before}`);

  if (filters.newerThan) parts.push(`newer_than:${filters.newerThan}`);
  if (filters.olderThan) parts.push(`older_than:${filters.olderThan}`);
  if (filters.largerThan) parts.push(`larger:${filters.largerThan}`);
  if (filters.smallerThan) parts.push(`smaller:${filters.smallerThan}`);

  for (const extra of filters.raw ?? []) {
    const trimmed = extra.trim();
    if (trimmed) parts.push(trimmed);
  }

  return parts.join(" ");
}

// ---------------------------------------------------------------------------
// parse
// ---------------------------------------------------------------------------

/**
 * Splits on whitespace, but keeps quoted strings and parenthesised groups
 * together so `subject:"quarterly report"` and `(a OR b)` survive as one token.
 */
function tokenize(query: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let inQuotes = false;
  let depth = 0;

  for (let i = 0; i < query.length; i++) {
    const char = query[i];

    if (char === "\\" && i + 1 < query.length) {
      current += char + query[++i];
      continue;
    }
    if (char === '"') {
      inQuotes = !inQuotes;
      current += char;
      continue;
    }
    if (!inQuotes && (char === "(" || char === "{")) depth++;
    if (!inQuotes && (char === ")" || char === "}")) depth = Math.max(0, depth - 1);

    if (!inQuotes && depth === 0 && /\s/.test(char)) {
      if (current) tokens.push(current);
      current = "";
      continue;
    }
    current += char;
  }

  if (current) tokens.push(current);
  return tokens;
}

export function parseGmailQuery(query: string): SearchFilters {
  const filters: SearchFilters = {};
  if (!query?.trim()) return filters;

  const append = (key: keyof SearchFilters, value: string) => {
    const list = (filters[key] as string[] | undefined) ?? [];
    list.push(value);
    (filters[key] as string[]) = list;
  };

  for (const token of tokenize(query)) {
    let text = token;
    let negated = false;

    if (text.startsWith("-") && text.length > 1) {
      negated = true;
      text = text.slice(1);
    }

    // Groups and OR expressions aren't modelled as chips; keep them intact.
    if (/^[({]/.test(text) || text.toUpperCase() === "OR" || text.toUpperCase() === "AND") {
      append("raw", negated ? `-${text}` : text);
      continue;
    }

    const match = /^([A-Za-z_]+):([\s\S]*)$/.exec(text);
    if (!match) {
      append(negated ? "excludes" : "includes", unquote(text));
      continue;
    }

    const key = match[1].toLowerCase();
    const value = unquote(match[2]);

    if ((FIELD_KEYS as readonly string[]).includes(key)) {
      // A negated field (-from:x) has no chip representation; preserve it raw.
      if (negated) append("raw", `-${key}:${quote(value)}`);
      else append(key as FieldKey, value);
      continue;
    }

    switch (key) {
      case "in":
        filters.in = value;
        break;
      case "category":
        filters.category = value;
        break;
      case "has":
        if (value === "attachment") filters.hasAttachment = !negated;
        else append("raw", token);
        break;
      case "is":
        if (value === "unread") filters.isUnread = !negated;
        else if (value === "read") filters.isRead = !negated;
        else if (value === "starred") filters.isStarred = !negated;
        else if (value === "important") filters.isImportant = !negated;
        else append("raw", token);
        break;
      case "after":
      case "newer":
        filters.after = value;
        break;
      case "before":
      case "older":
        filters.before = value;
        break;
      case "newer_than":
        filters.newerThan = value;
        break;
      case "older_than":
        filters.olderThan = value;
        break;
      case "larger":
        filters.largerThan = value;
        break;
      case "smaller":
        filters.smallerThan = value;
        break;
      default:
        // Unknown operator — Gmail may still understand it, so pass it through.
        append("raw", token);
    }
  }

  return filters;
}

/** Convenience for callers that accept either shape. */
export function toQueryString(
  input: string | SearchFilters | undefined,
): string {
  if (!input) return "";
  return typeof input === "string" ? input : buildGmailQuery(input);
}
