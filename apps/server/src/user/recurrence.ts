import { RRule } from "rrule";

/**
 * Next occurrence of a recurrence rule strictly after `afterUtc`, as a UTC Date.
 *
 * Rules are evaluated on local wall-clock time in `tz`, so "every day at 09:00"
 * stays 09:00 across daylight-saving changes. `rrule` has no zone math of its
 * own, so we run it on "floating" dates (wall time stored in UTC fields) and
 * convert each result back to a real instant here.
 *
 * `rrule` is an RFC 5545 string, with or without `RRULE:`. A `DTSTART:` line is
 * read as local wall time. Without one, the rule starts at `afterUtc`.
 * Returns null when the rule has no further occurrence.
 */
export function nextOccurrence(rrule: string, tz: string, afterUtc: Date | number): Date | null {
  const unsafe = ruleProblem(rrule);
  if (unsafe) throw new Error(unsafe);
  const after = new Date(afterUtc);
  const afterWall = toWall(after, tz);
  const options = RRule.parseString(rrule.trim());
  options.dtstart ??= afterWall;
  options.tzid = undefined;
  const rule = new RRule(options);

  // A gap or overlap can map a result to an instant at or before `after`,
  // so step forward until the instant is strictly later.
  let cursor = afterWall;
  for (let i = 0; i < 4; i++) {
    const wall = rule.after(cursor, false);
    if (!wall) return null;
    const utc = fromWall(wall, tz);
    if (utc.getTime() > after.getTime()) return utc;
    cursor = wall;
  }
  return null;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    });
    formatters.set(tz, f);
  }
  return f;
}

/** The wall clock in `tz` at instant `utc`, written into the UTC fields of a Date. */
function toWall(utc: Date, tz: string): Date {
  const p: Record<string, number> = {};
  for (const part of formatter(tz).formatToParts(utc)) {
    if (part.type !== "literal") p[part.type] = Number(part.value);
  }
  return new Date(Date.UTC(p.year!, p.month! - 1, p.day!, p.hour!, p.minute!, p.second!));
}

/** Offset of `tz` from UTC at epoch ms `t`, in ms. */
function offsetAt(t: number, tz: string): number {
  return toWall(new Date(t), tz).getTime() - Math.floor(t / 1000) * 1000;
}

/**
 * The instant at which the wall clock in `tz` reads `wall` (UTC fields).
 * In a fall-back overlap the earlier instant wins. In a spring-forward gap the
 * time moves later by the gap, as calendars do (02:30 becomes 03:30).
 */
function fromWall(wall: Date, tz: string): Date {
  const w = wall.getTime();
  const before = offsetAt(w - 86_400_000, tz);
  const after = offsetAt(w + 86_400_000, tz);
  const valid = [before, after].map((o) => w - o).filter((t) => offsetAt(t, tz) === w - t);
  return new Date(valid.length ? Math.min(...valid) : w - before);
}

// `rrule` checks a rule's end only on a date that passes every filter, so a rule no date can pass
// ("FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=30", or "FREQ=HOURLY;INTERVAL=2;BYHOUR=9,11" stepping from an even
// hour) walks to the year 9999 one step at a time: minutes of CPU, which on Workers is a request
// that never finishes. Agents write rules, so every rule passes this check before `rrule` sees it.
// It accepts the shapes that always reach a date in a bounded number of steps.

const PARTS = new Set(["FREQ", "INTERVAL", "COUNT", "UNTIL", "WKST", "BYDAY", "BYHOUR", "BYMINUTE", "BYSECOND", "BYMONTHDAY", "BYMONTH"])
const FREQS = ["MINUTELY", "HOURLY", "DAILY", "WEEKLY", "MONTHLY", "YEARLY"] as const
const DAYS = new Set(["MO", "TU", "WE", "TH", "FR", "SA", "SU"])
/** With an interval past 1, the parts a frequency may carry: those that add times within a step, never those that filter steps out. */
const EXPANDS: Record<(typeof FREQS)[number], readonly string[]> = {
  MINUTELY: ["BYSECOND"],
  HOURLY: ["BYMINUTE", "BYSECOND"],
  DAILY: ["BYHOUR", "BYMINUTE", "BYSECOND"],
  WEEKLY: ["BYDAY", "BYHOUR", "BYMINUTE", "BYSECOND"],
  MONTHLY: ["BYDAY", "BYMONTHDAY", "BYHOUR", "BYMINUTE", "BYSECOND"],
  YEARLY: ["BYMONTH", "BYDAY", "BYMONTHDAY", "BYHOUR", "BYMINUTE", "BYSECOND"],
};
/** The most days each month can have, February in a leap year. */
const MONTH_DAYS = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

const ints = (v: string, min: number, max: number) =>
  v.split(",").every((x) => /^-?\d+$/.test(x) && Number(x) >= min && Number(x) <= max && Number(x) !== 0) || null;

/** Why `rrule` could loop on this rule for minutes, or null when it is safe to evaluate. Pure. */
export function ruleProblem(rrule: string): string | null {
  const parts = new Map<string, string>();
  // A DTSTART line may come first, read as local wall time (see `nextOccurrence`); the rule is the rest.
  const lines = rrule.trim().split(/\r?\n/).filter((l) => !/^DTSTART[:;]/i.test(l.trim()));
  if (lines.length !== 1) return "rrule must be one RRULE line, optionally after a DTSTART line";
  for (const line of lines[0]!.trim().replace(/^RRULE:/i, "").split(";")) {
    const [k, v] = line.split("=");
    if (!k || v === undefined || !v) return `rrule part "${line}" does not parse`;
    parts.set(k.toUpperCase(), v.toUpperCase());
  }
  for (const k of parts.keys()) if (!PARTS.has(k)) return `rrule part ${k} is not supported`;
  const freq = parts.get("FREQ") as (typeof FREQS)[number] | undefined;
  if (!freq || !FREQS.includes(freq)) return "rrule needs FREQ: MINUTELY, HOURLY, DAILY, WEEKLY, MONTHLY, or YEARLY";
  const interval = Number(parts.get("INTERVAL") ?? 1);
  if (!Number.isInteger(interval) || interval < 1 || interval > 1000) return "rrule INTERVAL must be 1 to 1000";
  if (parts.has("COUNT") && !ints(parts.get("COUNT")!, 1, 10_000)) return "rrule COUNT must be 1 to 10000";
  if (parts.has("BYHOUR") && !ints(parts.get("BYHOUR")!.replaceAll(/\b0\b/g, "24"), 1, 24)) return "rrule BYHOUR must be 0 to 23";
  if (parts.has("BYMINUTE") && !ints(parts.get("BYMINUTE")!.replaceAll(/\b0\b/g, "60"), 1, 60)) return "rrule BYMINUTE must be 0 to 59";
  if (parts.has("BYSECOND") && !ints(parts.get("BYSECOND")!.replaceAll(/\b0\b/g, "60"), 1, 60)) return "rrule BYSECOND must be 0 to 59";
  if (parts.has("BYMONTH") && !ints(parts.get("BYMONTH")!, 1, 12)) return "rrule BYMONTH must be 1 to 12";
  if (parts.has("BYMONTHDAY") && !ints(parts.get("BYMONTHDAY")!, -31, 31)) return "rrule BYMONTHDAY must be 1 to 31, or -1 to -31";
  if (parts.has("BYDAY") && !parts.get("BYDAY")!.split(",").every((d) => DAYS.has(d.replace(/^[+-]?[1-5]/, "")))) return "rrule BYDAY must be days like MO,TU or 1MO, -1FR";
  if (interval > 1) {
    for (const k of parts.keys()) {
      if (k.startsWith("BY") && !EXPANDS[freq].includes(k)) return `rrule ${k} with INTERVAL=${interval} can skip every match. use a smaller FREQ with INTERVAL=1, or drop ${k}`;
    }
  }
  // A month day no chosen month has never happens.
  const days = parts.get("BYMONTHDAY")?.split(",").map(Number).filter((d) => d > 0) ?? [];
  const months = parts.get("BYMONTH")?.split(",").map(Number) ?? Array.from({ length: 12 }, (_, i) => i + 1);
  if (days.length && !days.some((d) => months.some((m) => d <= MONTH_DAYS[m - 1]!))) return "rrule BYMONTHDAY never falls in the chosen months";
  return null;
}
