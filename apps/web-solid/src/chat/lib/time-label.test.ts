import { describe, expect, test } from "bun:test";
import { TIME_DIVIDER_GAP_MS, timeLabel } from "./time-label";

const L = { locale: "en-US" };
const d = (y: number, m: number, day: number, h = 12, min = 0) => new Date(y, m - 1, day, h, min).getTime();
const NOW = d(2026, 10, 2, 15, 0); // friday

const cases: Array<[string, number, number, string | undefined]> = [
  ["ten minutes apart", d(2026, 10, 2, 12, 2), d(2026, 10, 2, 12, 12), undefined],
  ["exactly one hour apart", d(2026, 10, 2, 12, 0), d(2026, 10, 2, 13, 0), undefined],
  ["one hour and a minute apart", d(2026, 10, 2, 12, 0), d(2026, 10, 2, 13, 1), "today 1:01 pm"],
  ["two hours apart today", d(2026, 10, 2, 12, 2), d(2026, 10, 2, 14, 22), "today 2:22 pm"],
  ["new day inside the hour", d(2026, 10, 1, 23, 50), d(2026, 10, 2, 0, 10), "today 12:10 am"],
  ["yesterday", d(2026, 9, 30, 20, 0), d(2026, 10, 1, 9, 10), "yesterday 9:10 am"],
  ["weekday", d(2026, 9, 28, 9, 0), d(2026, 9, 28, 16, 5), "monday 4:05 pm"],
  ["six days ago is a weekday", d(2026, 9, 25, 9, 0), d(2026, 9, 26, 9, 0), "saturday 9:00 am"],
  ["seven days ago is a date", d(2026, 9, 24, 9, 0), d(2026, 9, 25, 9, 0), "sep 25, 9:00 am"],
  ["this year", d(2026, 9, 13, 9, 0), d(2026, 9, 14, 9, 0), "sep 14, 9:00 am"],
  ["last year", d(2025, 9, 13, 9, 0), d(2025, 9, 14, 9, 0), "sep 14 2025, 9:00 am"],
];

describe("timeLabel", () => {
  for (const [name, prev, at, want] of cases) {
    test(name, () => expect(timeLabel(prev, at, NOW, L)).toBe(want));
  }

  test("the gap is one hour", () => expect(TIME_DIVIDER_GAP_MS).toBe(3_600_000));
});
