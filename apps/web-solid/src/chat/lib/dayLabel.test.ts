import { describe, expect, test } from "bun:test";
import { dayChipLabel, formatFullTimestamp, formatTimeOfDay } from "./dayLabel";

const HERE = import.meta.dir;

type DayFacts = {
  /** Milliseconds from the first local midnight to the next. */
  span: number;
  /** Whether subtracting 24 hours from the next midnight lands on the first. */
  naiveHit: boolean;
  sameDay: string;
  nextDay: string;
};

/**
 * Bun freezes the process timezone after the first change to it, so a DST day
 * is measured in a child process started with TZ pinned. Both the span and the
 * labels come back from that child, so the assertion still runs against the
 * real implementation rather than a restatement of it.
 */
function dayFacts(tz: string, from: [number, number, number], to: [number, number, number]): DayFacts {
  const script = `
    import { dayChipLabel } from ${JSON.stringify(`${HERE}/dayLabel.ts`)};
    import { dayStartOf } from ${JSON.stringify(`${HERE}/grouping.ts`)};
    const first = ${JSON.stringify(from)};
    const next = ${JSON.stringify(to)};
    const startOf = ([y, m, d]) => dayStartOf(new Date(y, m, d, 12).getTime());
    const a = startOf(first);
    const b = startOf(next);
    console.log(JSON.stringify({
      span: b - a,
      naiveHit: b - 86_400_000 === a,
      sameDay: dayChipLabel(a, new Date(first[0], first[1], first[2], 12).getTime()),
      nextDay: dayChipLabel(a, new Date(next[0], next[1], next[2], 12).getTime()),
    }));
  `;
  const probe = Bun.spawnSync(["bun", "-e", script], { env: { ...process.env, TZ: tz } });
  if (probe.exitCode !== 0) throw new Error(probe.stderr.toString());
  return JSON.parse(probe.stdout.toString()) as DayFacts;
}

describe("dayChipLabel", () => {
  test("names the current day today, even minutes after midnight", () => {
    const now = new Date(2024, 4, 15, 0, 4, 0);
    expect(dayChipLabel(new Date(2024, 4, 15, 0, 0, 0).getTime(), now.getTime())).toBe("today");
  });

  test("names the previous calendar day yesterday, even minutes before midnight", () => {
    const now = new Date(2024, 4, 15, 23, 56, 0);
    expect(dayChipLabel(new Date(2024, 4, 14, 0, 0, 0).getTime(), now.getTime())).toBe("yesterday");
  });

  test("falls through to a lowercase weekday once today and yesterday are out of range", () => {
    // 2024-05-13 is a Monday.
    const now = new Date(2024, 4, 15, 12, 0, 0);
    expect(dayChipLabel(new Date(2024, 4, 13, 0, 0, 0).getTime(), now.getTime())).toBe("monday");
  });

  test("labels are lowercase whatever the weekday", () => {
    const now = new Date(2024, 4, 15, 12, 0, 0);
    for (let back = 3; back < 9; back += 1) {
      const day = new Date(2024, 4, 15 - back, 0, 0, 0).getTime();
      const label = dayChipLabel(day, now.getTime());
      expect(label).toBe(label.toLowerCase());
      expect(label).not.toBe("");
    }
  });

  test("ignores the time of day a day start was handed to it", () => {
    const now = new Date(2024, 4, 15, 12, 0, 0);
    const notMidnight = new Date(2024, 4, 15, 19, 45, 0).getTime();
    expect(dayChipLabel(notMidnight, now.getTime())).toBe("today");
  });

  test("reads yesterday across a 23-hour spring-forward day, where 24h arithmetic misses", () => {
    // Cuba springs forward at midnight, so 2024-03-10 lasts 23 hours.
    const facts = dayFacts("America/Havana", [2024, 2, 10], [2024, 2, 11]);

    expect(facts.span).toBe(23 * 3_600_000);
    expect(facts.naiveHit).toBe(false);
    expect(facts.sameDay).toBe("today");
    expect(facts.nextDay).toBe("yesterday");
  });

  test("reads yesterday across a 25-hour fall-back day, where 24h arithmetic misses", () => {
    // Chile falls back at midnight, so 2024-04-06 lasts 25 hours.
    const facts = dayFacts("America/Santiago", [2024, 3, 6], [2024, 3, 7]);

    expect(facts.span).toBe(25 * 3_600_000);
    expect(facts.naiveHit).toBe(false);
    expect(facts.sameDay).toBe("today");
    expect(facts.nextDay).toBe("yesterday");
  });
});

describe("formatTimeOfDay", () => {
  const at = (h: number, m: number) => formatTimeOfDay(new Date(2024, 4, 15, h, m, 0).getTime());

  test("drops the leading zero and lowercases the meridiem", () => {
    expect(at(9, 41)).toBe("9:41 am");
    expect(at(1, 7)).toBe("1:07 am");
  });

  test("renders midnight and noon as 12", () => {
    expect(at(0, 5)).toBe("12:05 am");
    expect(at(12, 0)).toBe("12:00 pm");
    expect(at(23, 59)).toBe("11:59 pm");
    expect(at(13, 30)).toBe("1:30 pm");
  });

  test("always pads minutes to two digits", () => {
    expect(at(6, 0)).toBe("6:00 am");
  });
});

describe("formatFullTimestamp", () => {
  test("carries the date and the time of day", () => {
    const stamp = formatFullTimestamp(new Date(2024, 4, 15, 14, 3, 0).getTime());

    expect(stamp).toContain("may");
    expect(stamp).toContain("15");
    expect(stamp).toContain("2024");
    expect(stamp).toContain("2:03 pm");
    expect(stamp).toBe(stamp.toLowerCase());
  });

  test("agrees with formatTimeOfDay on the clock it prints", () => {
    const sentAt = new Date(2024, 4, 15, 21, 45, 0).getTime();

    expect(formatFullTimestamp(sentAt)).toContain(formatTimeOfDay(sentAt));
  });
});