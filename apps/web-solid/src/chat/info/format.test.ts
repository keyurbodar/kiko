import { describe, expect, test } from "bun:test"
import { formatBytes, shortDate } from "./format"

describe("format", () => {
  test("a date reads as month, day and year", () => {
    expect(shortDate(new Date(2026, 9, 2, 12).getTime())).toBe("Oct 2, 2026")
  })

  test("sizes", () => {
    expect([formatBytes(12), formatBytes(3482), formatBytes(2_500_000)]).toEqual(["12 B", "3.4 KB", "2.4 MB"])
  })
})
