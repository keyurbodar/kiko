import { dayStartOf } from "./grouping";

/** A pause longer than this earns a time divider. ASSUMPTION: 20 minutes, so a same-day pause shows its time the way Instagram does. */
export const TIME_DIVIDER_GAP_MS = 20 * 60_000;

/** True when `at` opens a new calendar day or comes more than the gap after `prev`. */
export function startsTimeBreak(prev: number, at: number): boolean {
  return dayStartOf(prev) !== dayStartOf(at) || at - prev > TIME_DIVIDER_GAP_MS;
}

export interface TimeLabelOptions {
  /** Defaults to the user's locale. */
  locale?: string;
  /** Defaults to the user's time zone. */
  timeZone?: string;
}

const fmt = (at: number, o: Intl.DateTimeFormatOptions, opts: TimeLabelOptions) =>
  new Intl.DateTimeFormat(opts.locale, { ...o, timeZone: opts.timeZone })
    .format(at)
    .replace(/[  ]/g, " ");

/**
 * A divider's day and time, apart, so the day can be the stronger of the two as monocode sets
 * it (AgentTranscript.tsx `DaySeparator`). A date older than a week keeps its comma.
 */
export function dividerParts(at: number, now: number, opts: TimeLabelOptions = {}): { day: string; time: string; dated: boolean } {
  const time = fmt(at, { hour: "numeric", minute: "2-digit", hour12: true }, opts);
  const day = dayStartOf(at);
  const today = dayStartOf(now);
  const t = new Date(today);
  const daysAgo = (n: number) => new Date(t.getFullYear(), t.getMonth(), t.getDate() - n).getTime();

  if (day === today) return { day: "Today", time, dated: false };
  if (day === daysAgo(1)) return { day: "Yesterday", time, dated: false };
  for (let n = 2; n <= 6; n += 1) {
    if (day === daysAgo(n)) return { day: fmt(at, { weekday: "long" }, opts), time, dated: false };
  }
  const sameYear = new Date(at).getFullYear() === t.getFullYear();
  if (sameYear) return { day: fmt(at, { month: "short", day: "numeric" }, opts), time, dated: true };
  return { day: fmt(at, { month: "short", day: "numeric", year: "numeric" }, opts).replace(/,/g, ""), time, dated: true };
}

/** The label for a divider placed before the message sent at `at`, by its age at `now`. */
export function dividerLabel(at: number, now: number, opts: TimeLabelOptions = {}): string {
  const { day, time, dated } = dividerParts(at, now, opts);
  return dated ? `${day}, ${time}` : `${day} ${time}`;
}

/** The whole rule: a label when a divider belongs between `prev` and `at`, else nothing. */
export function timeLabel(
  prev: number,
  at: number,
  now: number,
  opts: TimeLabelOptions = {},
): string | undefined {
  return startsTimeBreak(prev, at) ? dividerLabel(at, now, opts) : undefined;
}
