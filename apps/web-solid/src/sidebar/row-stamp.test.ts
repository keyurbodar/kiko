import { describe, expect, it } from "vitest"
import { rowStamp } from "./row-stamp"

const now = new Date(2026, 9, 28, 22, 30).getTime()
const at = (...parts: [number, number, number, number, number]) => new Date(...parts).getTime()
const plain = (text: string) => text.replace(/[  ]/g, " ")

describe("rowStamp", () => {
  it("says now under a minute and minutes under an hour", () => {
    expect(rowStamp(now - 30_000, now)).toBe("now")
    expect(rowStamp(now - 12 * 60_000, now)).toBe("12m")
  })

  it("shows the clock time for earlier today in the locale's own clock", () => {
    const earlier = new Date(2026, 9, 28, 16, 10)
    expect(plain(rowStamp(earlier.getTime(), now))).toBe(
      plain(earlier.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })),
    )
  })

  it("shows the weekday within a week and the date after that", () => {
    expect(rowStamp(at(2026, 9, 26, 9, 0), now)).toBe(
      new Date(2026, 9, 26).toLocaleDateString(undefined, { weekday: "short" }),
    )
    expect(rowStamp(at(2026, 9, 20, 9, 0), now)).toBe(
      new Date(2026, 9, 20).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
    )
  })
})
