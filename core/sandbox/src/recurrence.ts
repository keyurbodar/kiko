import { RRule } from "rrule";
import type { ExtensionBundle } from "./manifest";
import { MIN_REPEAT_MS, ruleProblem } from "./rule";

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

// A schedule may repeat no faster than MIN_REPEAT_MS. The walk samples the first GAP_SAMPLES
// occurrences from now, however far off they are. A rule's gaps repeat through its cycle, so this
// finds the fastest gap in practice. It is a sample, not a proof: a gap that first appears after the
// sample is not seen.
const GAP_SAMPLES = 500;

export function repeatProblem(rrule: string, tz: string, from: number): string | null {
  const problem = ruleProblem(rrule);
  if (problem) return problem;
  let gap = Infinity;
  let prev: Date | null = null;
  try {
    for (let i = 0; i < GAP_SAMPLES; i++) {
      const next = nextOccurrence(rrule, tz, prev ?? from - 1000);
      if (!next) break;
      if (prev) gap = Math.min(gap, next.getTime() - prev.getTime());
      prev = next;
    }
  } catch {
    return "rrule does not parse";
  }
  return gap < MIN_REPEAT_MS ? "a schedule repeats at most every 30 minutes. to notice changes on a page, use a watch trigger instead: it checks every 15 minutes without a model run." : null;
}

/** The trigger rate rule. It needs rrule, so it stays out of the wire schema in @kiko/protocol. */
export function triggerGapProblems(bundle: ExtensionBundle): string[] {
  return (bundle.manifest.triggers ?? []).flatMap((t) => {
    const problem = repeatProblem(t.rrule, "UTC", Date.now());
    return problem ? [`trigger ${t.id}: ${problem}`] : [];
  });
}
