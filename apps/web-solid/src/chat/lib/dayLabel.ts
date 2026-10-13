import { dayStartOf } from "./grouping";

const MONTH_DAY = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
const MONTH_DAY_YEAR = new Intl.DateTimeFormat(undefined, { month: "long", day: "numeric", year: "numeric" });
const MONTH_DAY_YEAR_SHORT = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" });

/**
 * Label for the floating date chip: `Today`, `Yesterday`, or a short date.
 *
 * Every comparison is on a local-midnight boundary, so a DST day being 23 or 25
 * hours long cannot push yesterday's label onto the wrong day.
 */
export function dayChipLabel(dayStart: number, now: number): string {
  const target = dayStartOf(dayStart);
  const today = dayStartOf(now);
  if (target === today) return "Today";

  const d = new Date(today);
  const yesterday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1).getTime();
  if (target === yesterday) return "Yesterday";

  const day = new Date(target);
  return (day.getFullYear() === d.getFullYear() ? MONTH_DAY : MONTH_DAY_YEAR_SHORT).format(day);
}

/** 12-hour clock with no leading zero, e.g. `9:41 AM`. */
export function formatTimeOfDay(sentAt: number): string {
  const d = new Date(sentAt);
  const h24 = d.getHours();
  const hours = h24 % 12 === 0 ? 12 : h24 % 12;
  const minutes = String(d.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes} ${h24 < 12 ? "AM" : "PM"}`;
}

/** Long-form stamp for the message tooltip. */
export function formatFullTimestamp(sentAt: number): string {
  const d = new Date(sentAt);
  const date = MONTH_DAY_YEAR.format(d);
  return `${date} at ${formatTimeOfDay(sentAt)}`;
}