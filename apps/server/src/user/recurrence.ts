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
