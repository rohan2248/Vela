/**
 * Timezone-correct resolution of natural-language dates and times.
 *
 * This exists so phrases like "9 AM next Thursday" are computed rather than
 * guessed. Date arithmetic is exactly the kind of thing a language model gets
 * subtly wrong — off-by-one weeks, DST, "next Friday" on a Friday — and a
 * calendar invite at the wrong hour is a visible, embarrassing failure.
 *
 * No dependencies: zone handling uses Intl, which ships with Node.
 */

const WEEKDAYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;

export type WallClock = {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
};

/** Decomposes an instant into wall-clock fields as seen in `timeZone`. */
export function toWallClock(date: Date, timeZone: string): WallClock & { weekday: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    weekday: "short",
    hour12: false,
  }).formatToParts(date);

  const get = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? "0";

  const weekdayName = (parts.find((p) => p.type === "weekday")?.value ?? "Sun")
    .slice(0, 3)
    .toLowerCase();
  const weekday = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"].indexOf(
    weekdayName,
  );

  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    // Intl renders midnight as "24" in some locales under hour12:false.
    hour: Number(get("hour")) % 24,
    minute: Number(get("minute")),
    weekday,
  };
}

/**
 * Inverse of `toWallClock`: finds the instant whose local time in `timeZone`
 * matches the given wall clock.
 *
 * Done by iteration rather than a lookup table because a zone's offset depends
 * on the instant, which is what we're solving for. Two passes converge for
 * every real zone, including across a DST transition.
 */
export function fromWallClock(wall: WallClock, timeZone: string): Date {
  const asUtc = Date.UTC(
    wall.year,
    wall.month - 1,
    wall.day,
    wall.hour,
    wall.minute,
  );

  let instant = asUtc;
  for (let pass = 0; pass < 2; pass++) {
    const local = toWallClock(new Date(instant), timeZone);
    const localAsUtc = Date.UTC(
      local.year,
      local.month - 1,
      local.day,
      local.hour,
      local.minute,
    );
    instant += asUtc - localAsUtc;
  }

  return new Date(instant);
}

type ParsedTime = { hour: number; minute: number };

function parseTime(input: string): ParsedTime | null {
  const text = input.toLowerCase();

  if (/\bnoon\b|\bmidday\b/.test(text)) return { hour: 12, minute: 0 };
  if (/\bmidnight\b/.test(text)) return { hour: 0, minute: 0 };

  // "9am", "9 am", "9:30 pm", "14:30", "at 9"
  const match =
    /(?:\bat\s+)?\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/.exec(text);
  if (!match) return null;

  let hour = Number(match[1]);
  const minute = Number(match[2] ?? 0);
  const meridiem = match[3];

  if (hour > 23 || minute > 59) return null;

  if (meridiem === "pm" && hour < 12) hour += 12;
  if (meridiem === "am" && hour === 12) hour = 0;

  // A bare number with no am/pm and no colon is only a time if it was
  // introduced by "at" — otherwise "in 3 days" would read 3 as an hour.
  if (!meridiem && !match[2] && !/\bat\s+\d/.test(text)) return null;

  return { hour, minute };
}

export type ResolvedDateTime = {
  iso: string;
  timeZone: string;
  /** Wall-clock rendering, useful for confirming back to the user. */
  local: string;
  weekday: string;
};

function describe(date: Date, timeZone: string): ResolvedDateTime {
  return {
    iso: date.toISOString(),
    timeZone,
    local: new Intl.DateTimeFormat("en-US", {
      timeZone,
      dateStyle: "full",
      timeStyle: "short",
    }).format(date),
    weekday: new Intl.DateTimeFormat("en-US", {
      timeZone,
      weekday: "long",
    }).format(date),
  };
}

/**
 * Resolves an expression against `now` in `timeZone`.
 *
 * Handles: ISO strings, today/tomorrow/yesterday, weekday names with optional
 * this/next/last, "in N days|weeks|hours|minutes", and a time of day in any of
 * those. Returns null when nothing matches, so the caller can ask rather than
 * invent a date.
 */
export function resolveDateTime(
  expression: string,
  timeZone: string,
  now: Date = new Date(),
): ResolvedDateTime | null {
  const text = expression.trim().toLowerCase();
  if (!text) return null;

  // An explicit timestamp wins over any parsing.
  if (/^\d{4}-\d{2}-\d{2}([t ]\d{2}:\d{2})?/.test(text)) {
    const parsed = new Date(
      /[t ]\d{2}:\d{2}/.test(text) ? expression.trim() : `${text}T00:00:00`,
    );
    if (!Number.isNaN(parsed.getTime())) return describe(parsed, timeZone);
  }

  const current = toWallClock(now, timeZone);
  const time = parseTime(text);

  // Relative offsets: "in 3 days", "in 2 hours".
  const relative = /\bin\s+(\d+)\s*(minute|hour|day|week|month)s?\b/.exec(text);
  if (relative) {
    const amount = Number(relative[1]);
    const unit = relative[2];
    const result = new Date(now);

    if (unit === "minute") result.setUTCMinutes(result.getUTCMinutes() + amount);
    else if (unit === "hour") result.setUTCHours(result.getUTCHours() + amount);
    else {
      const days = unit === "day" ? amount : unit === "week" ? amount * 7 : amount * 30;
      const shifted = { ...current, day: current.day + days };
      if (time) {
        shifted.hour = time.hour;
        shifted.minute = time.minute;
      }
      return describe(fromWallClock(shifted, timeZone), timeZone);
    }
    return describe(result, timeZone);
  }

  let target: WallClock = {
    year: current.year,
    month: current.month,
    day: current.day,
    hour: time?.hour ?? current.hour,
    minute: time?.minute ?? current.minute,
  };

  let matched = false;

  if (/\btoday\b|\btonight\b/.test(text)) {
    matched = true;
    if (/\btonight\b/.test(text) && !time) target.hour = 19;
  } else if (/\btomorrow\b/.test(text)) {
    target.day += 1;
    matched = true;
  } else if (/\byesterday\b/.test(text)) {
    target.day -= 1;
    matched = true;
  } else {
    const weekdayIndex = WEEKDAYS.findIndex((day) =>
      new RegExp(`\\b${day}\\b|\\b${day.slice(0, 3)}\\b`).test(text),
    );

    if (weekdayIndex >= 0) {
      matched = true;
      const isNext = /\bnext\b/.test(text);
      const isLast = /\blast\b/.test(text);

      let delta = (weekdayIndex - current.weekday + 7) % 7;

      if (isLast) {
        delta = delta === 0 ? -7 : delta - 7;
      } else if (isNext) {
        // "next Thursday" is read as the Thursday of the *following* calendar
        // week, never one that is still in this week. The alternative reading
        // ("the next Thursday to occur") makes the phrase mean tomorrow when
        // said on a Wednesday, and silently scheduling a meeting seven days
        // from the intended date is the worst failure this function can have.
        // Callers are expected to echo the resolved date back for confirmation.
        const daysToNextWeek = 7 - current.weekday;
        delta = daysToNextWeek + weekdayIndex;
      } else if (delta === 0 && time) {
        // Plain "Thursday at 9am" said on Thursday morning means today;
        // said after 9am it means next week.
        const alreadyPassed =
          time.hour < current.hour ||
          (time.hour === current.hour && time.minute <= current.minute);
        if (alreadyPassed) delta = 7;
      }

      target.day += delta;
    }
  }

  if (!matched && !time) return null;

  // Time given with no date ("at 4pm") means today, or tomorrow if it's past.
  if (!matched && time) {
    const passed =
      time.hour < current.hour ||
      (time.hour === current.hour && time.minute <= current.minute);
    if (passed) target.day += 1;
  }

  return describe(fromWallClock(target, timeZone), timeZone);
}

/** Adds minutes to an ISO instant. */
export function addMinutes(iso: string, minutes: number): string {
  return new Date(new Date(iso).getTime() + minutes * 60_000).toISOString();
}
