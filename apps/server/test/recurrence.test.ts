import { describe, expect, test } from "vitest";
import { nextOccurrence, repeatProblem } from "@kiko/sandbox/recurrence";
import { ruleProblem } from "@kiko/sandbox/rule";

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

const cases = [
  { tz: "America/New_York", changes: [["2026-03-01T00:00:00Z", "2026-03-20T00:00:00Z"], ["2026-10-25T00:00:00Z", "2026-11-12T00:00:00Z"]] },
  { tz: "Europe/Berlin", changes: [["2026-03-20T00:00:00Z", "2026-04-08T00:00:00Z"], ["2026-10-15T00:00:00Z", "2026-11-05T00:00:00Z"]] },
] as const;

describe.each(cases)("$tz", ({ tz, changes }) => {
  test.each(changes)("every day at 09:00 stays 09:00 across %s", (s, e) => {
    const list = walk(DAILY, tz, s, e);
    expect(list.length).toBeGreaterThan(10);
    for (const d of list) expect(local(d, tz)).toMatch(/ 09:00$/);
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
    expect(nextOccurrence(DAILY, "America/New_York", new Date("2026-03-07T14:00:00Z"))!.toISOString()).toBe("2026-03-08T13:00:00.000Z");
  });
  test("new york daily, fall back", () => {
    expect(nextOccurrence(DAILY, "America/New_York", new Date("2026-10-31T13:00:00Z"))!.toISOString()).toBe("2026-11-01T14:00:00.000Z");
  });
  test("berlin monday, spring forward", () => {
    expect(nextOccurrence(MONDAY, "Europe/Berlin", new Date("2026-03-23T08:00:00Z"))!.toISOString()).toBe("2026-03-30T07:00:00.000Z");
  });
  test("berlin monday, fall back", () => {
    expect(nextOccurrence(MONDAY, "Europe/Berlin", new Date("2026-10-19T07:00:00Z"))!.toISOString()).toBe("2026-10-26T08:00:00.000Z");
  });
  test("result is strictly after the input", () => {
    const at = new Date("2026-03-08T13:00:00Z");
    expect(nextOccurrence(DAILY, "America/New_York", at)!.toISOString()).toBe("2026-03-09T13:00:00.000Z");
  });
  test("a time inside the spring gap moves later, never earlier", () => {
    const rule = "FREQ=DAILY;BYHOUR=2;BYMINUTE=30;BYSECOND=0";
    expect(nextOccurrence(rule, "America/New_York", new Date("2026-03-07T12:00:00Z"))!.toISOString()).toBe("2026-03-08T07:30:00.000Z");
  });
  test("a finished rule returns null", () => {
    expect(nextOccurrence("FREQ=DAILY;COUNT=1", "Europe/Berlin", new Date("2026-06-01T00:00:00Z"))).toBeNull();
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

describe("repeatProblem: a rule that repeats too fast is refused whichever gap comes first", () => {
  test("two minutes an hour apart, 10 and 50 minutes, is refused even when the first gap is the long one", () => {
    const from = Date.UTC(2026, 0, 1, 9, 55);
    expect(repeatProblem("FREQ=HOURLY;BYMINUTE=0,50", "UTC", from)).toContain("repeats at most every 30 minutes");
  });
  test("a rule with one gap of 30 minutes or more passes", () => {
    expect(repeatProblem("FREQ=HOURLY;BYMINUTE=0,30", "UTC", Date.UTC(2026, 0, 1, 9, 55))).toBeNull();
  });
});

describe("repeatProblem: the gap check sees the fastest gap however far off the first occurrence is", () => {
  test("two minutes on Christmas, first due in December, is refused", () => {
    const from = Date.UTC(2026, 0, 1, 9, 0);
    expect(repeatProblem("FREQ=YEARLY;BYMONTH=12;BYMONTHDAY=25;BYHOUR=9;BYMINUTE=0,1", "UTC", from)).toContain("repeats at most every 30 minutes");
  });
  test("a rule whose first time is weeks out is still judged by its gaps", () => {
    const from = Date.UTC(2026, 0, 1, 9, 0);
    expect(repeatProblem("FREQ=MONTHLY;BYMONTHDAY=20;BYHOUR=9;BYMINUTE=0,1", "UTC", from)).toContain("repeats at most every 30 minutes");
  });
});

describe("a trigger rule takes no DTSTART line, so the first time cannot hide a fast gap", () => {
  const hourly = "DTSTART:20261101T090000\nRRULE:FREQ=HOURLY;BYMINUTE=0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40,41,42,43,44,45,46,47,48,49,50,51,52,53,54,55,56,57,58,59";
  test("ruleProblem refuses a DTSTART line", () => {
    expect(ruleProblem("DTSTART:20261101T090000\nRRULE:FREQ=DAILY;BYHOUR=9;BYMINUTE=0")).toContain("DTSTART");
  });
  test("repeatProblem refuses the hourly rule that a DTSTART a month out used to hide", () => {
    expect(repeatProblem(hourly, "UTC", Date.UTC(2026, 9, 12, 9, 0))).not.toBeNull();
  });
  test("nextOccurrence refuses it too, so no caller can store it", () => {
    expect(() => nextOccurrence("DTSTART:20261101T090000\nRRULE:FREQ=DAILY;BYHOUR=9;BYMINUTE=0", "UTC", Date.now())).toThrow();
  });
});
