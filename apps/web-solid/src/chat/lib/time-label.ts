import { dayStartOf } from "./grouping";

export const TIME_DIVIDER_GAP_MS = 20 * 60_000;

export function startsTimeBreak(prev: number, at: number): boolean {
  return dayStartOf(prev) !== dayStartOf(at) || at - prev > TIME_DIVIDER_GAP_MS;
}

export interface TimeLabelOptions {
  locale?: string;
  timeZone?: string;
}

const fmt = (at: number, o: Intl.DateTimeFormatOptions, opts: TimeLabelOptions) =>
  new Intl.DateTimeFormat(opts.locale, { ...o, timeZone: opts.timeZone })
    .format(at)
    .replace(/[  ]/g, " ");

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

export function dividerLabel(at: number, now: number, opts: TimeLabelOptions = {}): string {
  const { day, time, dated } = dividerParts(at, now, opts);
  return dated ? `${day}, ${time}` : `${day} ${time}`;
}

export function timeLabel(
  prev: number,
  at: number,
  now: number,
  opts: TimeLabelOptions = {},
): string | undefined {
  return startsTimeBreak(prev, at) ? dividerLabel(at, now, opts) : undefined;
}
