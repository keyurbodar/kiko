import { RRule } from "rrule";

export const MIN_REPEAT_MS = 30 * 60_000;

export function nextOccurrence(rrule: string, tz: string, afterUtc: Date | number): Date | null {
  const unsafe = ruleProblem(rrule);
  if (unsafe) throw new Error(unsafe);
  const after = new Date(afterUtc);
  const afterWall = toWall(after, tz);
  const options = RRule.parseString(rrule.trim());
  options.dtstart ??= afterWall;
  options.tzid = undefined;
  const rule = new RRule(options);

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

function toWall(utc: Date, tz: string): Date {
  const p: Partial<Record<string, number>> = {};
  for (const part of formatter(tz).formatToParts(utc)) {
    if (part.type !== "literal") p[part.type] = Number(part.value);
  }
  const { year, month, day, hour, minute, second } = p;
  if (year === undefined || month === undefined || day === undefined || hour === undefined || minute === undefined || second === undefined) {
    throw new Error(`Intl formatter omitted date parts for ${tz}`);
  }
  return new Date(Date.UTC(year, month - 1, day, hour, minute, second));
}

function offsetAt(t: number, tz: string): number {
  return toWall(new Date(t), tz).getTime() - Math.floor(t / 1000) * 1000;
}

function fromWall(wall: Date, tz: string): Date {
  const w = wall.getTime();
  const before = offsetAt(w - 86_400_000, tz);
  const after = offsetAt(w + 86_400_000, tz);
  const valid = [before, after].map((o) => w - o).filter((t) => offsetAt(t, tz) === w - t);
  return new Date(valid.length ? Math.min(...valid) : w - before);
}

export function validZone(tz: string): boolean {
  if (!tz || tz.length > 64) return false
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz })
    return true
  } catch {
    return false
  }
}

const PARTS = new Set(["FREQ", "INTERVAL", "COUNT", "UNTIL", "WKST", "BYDAY", "BYHOUR", "BYMINUTE", "BYSECOND", "BYMONTHDAY", "BYMONTH"])
const FREQS = ["MINUTELY", "HOURLY", "DAILY", "WEEKLY", "MONTHLY", "YEARLY"] as const
const DAYS = new Set(["MO", "TU", "WE", "TH", "FR", "SA", "SU"])
const EXPANDS: Record<(typeof FREQS)[number], readonly string[]> = {
  MINUTELY: ["BYSECOND"],
  HOURLY: ["BYMINUTE", "BYSECOND"],
  DAILY: ["BYHOUR", "BYMINUTE", "BYSECOND"],
  WEEKLY: ["BYDAY", "BYHOUR", "BYMINUTE", "BYSECOND"],
  MONTHLY: ["BYDAY", "BYMONTHDAY", "BYHOUR", "BYMINUTE", "BYSECOND"],
  YEARLY: ["BYMONTH", "BYDAY", "BYMONTHDAY", "BYHOUR", "BYMINUTE", "BYSECOND"],
};
const MONTH_DAYS = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

const ints = (v: string, min: number, max: number) =>
  v.split(",").every((x) => /^-?\d+$/.test(x) && Number(x) >= min && Number(x) <= max && Number(x) !== 0) || null;

export function ruleProblem(rrule: string): string | null {
  const parts = new Map<string, string>();
  const lines = rrule.trim().split(/\r?\n/).filter((l) => !/^DTSTART[:;]/i.test(l.trim()));
  if (lines.length !== 1) return "rrule must be one RRULE line, optionally after a DTSTART line";
  const [single] = lines;
  if (single === undefined) return "rrule must be one RRULE line, optionally after a DTSTART line";
  for (const line of single.trim().replace(/^RRULE:/i, "").split(";")) {
    const [k, v] = line.split("=");
    if (!k || v === undefined || !v) return `rrule part "${line}" does not parse`;
    parts.set(k.toUpperCase(), v.toUpperCase());
  }
  for (const k of parts.keys()) if (!PARTS.has(k)) return `rrule part ${k} is not supported`;
  const freq = parts.get("FREQ") as (typeof FREQS)[number] | undefined;
  if (!freq || !FREQS.includes(freq)) return "rrule needs FREQ: MINUTELY, HOURLY, DAILY, WEEKLY, MONTHLY, or YEARLY";
  const interval = Number(parts.get("INTERVAL") ?? 1);
  if (!Number.isInteger(interval) || interval < 1 || interval > 1000) return "rrule INTERVAL must be 1 to 1000";
  const count = parts.get("COUNT");
  if (count !== undefined && !ints(count, 1, 10_000)) return "rrule COUNT must be 1 to 10000";
  const byHour = parts.get("BYHOUR");
  if (byHour !== undefined && !ints(byHour.replaceAll(/\b0\b/g, "24"), 1, 24)) return "rrule BYHOUR must be 0 to 23";
  const byMinute = parts.get("BYMINUTE");
  if (byMinute !== undefined && !ints(byMinute.replaceAll(/\b0\b/g, "60"), 1, 60)) return "rrule BYMINUTE must be 0 to 59";
  const bySecond = parts.get("BYSECOND");
  if (bySecond !== undefined && !ints(bySecond.replaceAll(/\b0\b/g, "60"), 1, 60)) return "rrule BYSECOND must be 0 to 59";
  const byMonth = parts.get("BYMONTH");
  if (byMonth !== undefined && !ints(byMonth, 1, 12)) return "rrule BYMONTH must be 1 to 12";
  const byMonthDay = parts.get("BYMONTHDAY");
  if (byMonthDay !== undefined && !ints(byMonthDay, -31, 31)) return "rrule BYMONTHDAY must be 1 to 31, or -1 to -31";
  const byDay = parts.get("BYDAY");
  if (byDay !== undefined && !byDay.split(",").every((d) => DAYS.has(d.replace(/^[+-]?[1-5]/, "")))) return "rrule BYDAY must be days like MO,TU or 1MO, -1FR";
  if (interval > 1) {
    for (const k of parts.keys()) {
      if (k.startsWith("BY") && !EXPANDS[freq].includes(k)) return `rrule ${k} with INTERVAL=${interval} can skip every match. use a smaller FREQ with INTERVAL=1, or drop ${k}`;
    }
  }
  const days = parts.get("BYMONTHDAY")?.split(",").map(Number) ?? [];
  const months = parts.get("BYMONTH")?.split(",").map(Number) ?? Array.from({ length: 12 }, (_, i) => i + 1);
  if (days.length && !days.some((d) => months.some((m) => Math.abs(d) <= (MONTH_DAYS[m - 1] ?? -Infinity)))) return "rrule BYMONTHDAY never falls in the chosen months";
  return null;
}

export function repeatProblem(rrule: string, tz: string, from: number): string | null {
  const problem = ruleProblem(rrule)
  if (problem) return problem
  let first: Date | null
  try {
    first = nextOccurrence(rrule, tz, from - 1000)
  } catch {
    return "rrule does not parse"
  }
  const second = first ? nextOccurrence(rrule, tz, first) : null
  if (first && second && second.getTime() - first.getTime() < MIN_REPEAT_MS) return "a schedule repeats at most every 30 minutes. to notice changes on a page, use a watch trigger instead: it checks every 15 minutes without a model run."
  return null
}
