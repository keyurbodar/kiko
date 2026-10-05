import { describe, expect, test } from "vitest";
import { nextOccurrence, ruleProblem } from "../src/user/recurrence";

const DAILY = "FREQ=DAILY;BYHOUR=9;BYMINUTE=0;BYSECOND=0";
const MONDAY = "FREQ=WEEKLY;BYDAY=MO;BYHOUR=9;BYMINUTE=0;BYSECOND=0";

function local(d: Date, tz: string) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", weekday: "short", hour: "numeric", minute: "numeric" })
      .formatToParts(d)
      .map((x) => [x.type, x.value]),
  );
  return `${p.weekday} ${p.hour}:${p.minute}`;
}

/** Walk occurrences from `start` to `end`, each found from the one before. */
function walk(rule: string, tz: string, start: string, end: string) {
  const out: Date[] = [];
  let at = new Date(start);
  for (;;) {
    const next = nextOccurrence(rule, tz, at);
    if (!next || next > new Date(end)) return out;
    out.push(next);
    at = next;
  }
}

// 2026 changes: US spring Mar 8, fall Nov 1. EU spring Mar 29, fall Oct 25.
const cases = [
  { tz: "America/New_York", changes: [["2026-03-01T00:00:00Z", "2026-03-20T00:00:00Z"], ["2026-10-25T00:00:00Z", "2026-11-12T00:00:00Z"]] },
  { tz: "Europe/Berlin", changes: [["2026-03-20T00:00:00Z", "2026-04-08T00:00:00Z"], ["2026-10-15T00:00:00Z", "2026-11-05T00:00:00Z"]] },
] as const;

describe.each(cases)("$tz", ({ tz, changes }) => {
  test.each(changes)("every day at 09:00 stays 09:00 across %s", (s, e) => {
    const list = walk(DAILY, tz, s, e);
    expect(list.length).toBeGreaterThan(10);
    for (const d of list) expect(local(d, tz)).toMatch(/ 09:00$/);
    // The change itself shows up as a 23 or 25 hour day, so the zone math ran.
    const hours = list.slice(1).map((d, i) => (d.getTime() - list[i]!.getTime()) / 3_600_000);
    expect(hours.some((h) => h === 23 || h === 25)).toBe(true);
  });

  test.each(changes)("every monday at 09:00 stays 09:00 across %s", (s, e) => {
    const list = walk(MONDAY, tz, s, e);
    expect(list.length).toBeGreaterThanOrEqual(2);
    for (const d of list) expect(local(d, tz)).toBe("Mon 09:00");
  });
});

describe("exact instants", () => {
  test("new york daily, spring forward", () => {
    // Sat 7 Mar 09:00 EST = 14:00Z. Sun 8 Mar 09:00 EDT = 13:00Z.
    expect(nextOccurrence(DAILY, "America/New_York", new Date("2026-03-07T14:00:00Z"))!.toISOString()).toBe("2026-03-08T13:00:00.000Z");
  });
  test("new york daily, fall back", () => {
    // Sat 31 Oct 09:00 EDT = 13:00Z. Sun 1 Nov 09:00 EST = 14:00Z.
    expect(nextOccurrence(DAILY, "America/New_York", new Date("2026-10-31T13:00:00Z"))!.toISOString()).toBe("2026-11-01T14:00:00.000Z");
  });
  test("berlin monday, spring forward", () => {
    // Mon 23 Mar 09:00 CET = 08:00Z. Mon 30 Mar 09:00 CEST = 07:00Z.
    expect(nextOccurrence(MONDAY, "Europe/Berlin", new Date("2026-03-23T08:00:00Z"))!.toISOString()).toBe("2026-03-30T07:00:00.000Z");
  });
  test("berlin monday, fall back", () => {
    // Mon 19 Oct 09:00 CEST = 07:00Z. Mon 26 Oct 09:00 CET = 08:00Z.
    expect(nextOccurrence(MONDAY, "Europe/Berlin", new Date("2026-10-19T07:00:00Z"))!.toISOString()).toBe("2026-10-26T08:00:00.000Z");
  });
  test("result is strictly after the input", () => {
    const at = new Date("2026-03-08T13:00:00Z");
    expect(nextOccurrence(DAILY, "America/New_York", at)!.toISOString()).toBe("2026-03-09T13:00:00.000Z");
  });
  test("a time inside the spring gap moves later, never earlier", () => {
    const rule = "FREQ=DAILY;BYHOUR=2;BYMINUTE=30;BYSECOND=0";
    // 02:30 on 8 Mar does not exist in New York. It runs at 03:30 EDT = 07:30Z.
    expect(nextOccurrence(rule, "America/New_York", new Date("2026-03-07T12:00:00Z"))!.toISOString()).toBe("2026-03-08T07:30:00.000Z");
  });
  test("a finished rule returns null", () => {
    expect(nextOccurrence("DTSTART:20260101T090000\nRRULE:FREQ=DAILY;COUNT=1", "Europe/Berlin", new Date("2026-06-01T00:00:00Z"))).toBeNull();
  });
});

describe("ruleProblem: rules rrule could loop on for minutes are refused (architecture section 25.2)", () => {
  test("rules that always reach a date pass", () => {
    for (const r of ["FREQ=DAILY", "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR", "FREQ=DAILY;BYHOUR=8;BYMINUTE=30;BYSECOND=0", "FREQ=MONTHLY;BYMONTHDAY=1", "FREQ=MONTHLY;BYDAY=-1FR", "FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=29", "FREQ=HOURLY;INTERVAL=2;BYMINUTE=0", "RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO", "FREQ=HOURLY;BYDAY=MO,TU,WE,TH,FR", "FREQ=MONTHLY;BYMONTHDAY=31"]) {
      expect([r, ruleProblem(r)]).toEqual([r, null])
    }
  })

  test("a day no chosen month has, or a filter an interval can step over, is refused before rrule runs", () => {
    for (const r of ["FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=30", "FREQ=MONTHLY;BYMONTH=4;BYMONTHDAY=31", "FREQ=HOURLY;INTERVAL=2;BYHOUR=9,11,13", "FREQ=DAILY;INTERVAL=7;BYDAY=MO", "FREQ=MINUTELY;INTERVAL=1440;BYHOUR=9", "FREQ=MONTHLY;INTERVAL=2;BYMONTH=3", "FREQ=DAILY;BYSETPOS=1", "FREQ=SECONDLY", "FREQ=DAILY;BYHOUR=25", "FREQ=DAILY;INTERVAL=0", "nonsense"]) {
      expect([r, ruleProblem(r) === null]).toEqual([r, false])
    }
  })

  test("a refused rule never reaches rrule, so it fails in microseconds", () => {
    const t0 = performance.now()
    expect(() => nextOccurrence("FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=30", "UTC", Date.now())).toThrow()
    expect(performance.now() - t0).toBeLessThan(50)
  })
})
