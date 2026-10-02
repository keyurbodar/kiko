import { dayStartOf } from "./grouping";

/** A pause longer than this earns a time divider. ASSUMPTION: 1 hour, as in iMessage. */
export const TIME_DIVIDER_GAP_MS = 3_600_000;

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
    .replace(/[  ]/g, " ")
    .toLowerCase();

/** The label for a divider placed before the message sent at `at`, by its age at `now`. */
export function dividerLabel(at: number, now: number, opts: TimeLabelOptions = {}): string {
  const time = fmt(at, { hour: "numeric", minute: "2-digit", hour12: true }, opts);
  const day = dayStartOf(at);
  const today = dayStartOf(now);
  const t = new Date(today);
  const daysAgo = (n: number) => new Date(t.getFullYear(), t.getMonth(), t.getDate() - n).getTime();

  if (day === today) return `today ${time}`;
  if (day === daysAgo(1)) return `yesterday ${time}`;
  for (let n = 2; n <= 6; n += 1) {
    if (day === daysAgo(n)) return `${fmt(at, { weekday: "long" }, opts)} ${time}`;
  }
  const sameYear = new Date(at).getFullYear() === t.getFullYear();
  if (sameYear) return `${fmt(at, { month: "short", day: "numeric" }, opts)}, ${time}`;
  return `${fmt(at, { month: "short", day: "numeric", year: "numeric" }, opts).replace(/,/g, "")}, ${time}`;
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
