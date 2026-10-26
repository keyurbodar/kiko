import { describe, expect, it } from "vitest"
import { agoText, editedText } from "./edited"

const NOW = Date.UTC(2026, 9, 25, 12)
const DAY = 86_400_000

describe("editedText", () => {
  it("says just now for a fresh or very recent file", () => {
    expect(editedText(Number.MAX_SAFE_INTEGER, NOW)).toBe("Just now")
    expect(editedText(NOW - 20_000, NOW)).toBe("Just now")
  })

  it("counts minutes, hours and days back", () => {
    expect(editedText(NOW - 5 * 60_000, NOW)).toBe("5 minutes ago")
    expect(editedText(NOW - 3 * 3_600_000, NOW)).toBe("3 hours ago")
    expect(editedText(NOW - 2 * DAY, NOW)).toBe("2 days ago")
    expect(editedText(NOW - DAY, NOW)).toBe("yesterday")
  })

  it("moves up to months and years", () => {
    expect(editedText(NOW - 65 * DAY, NOW)).toBe("2 months ago")
    expect(editedText(NOW - 800 * DAY, NOW)).toBe("2 years ago")
  })
})

describe("agoText", () => {
  it("says just now, then minutes and hours back", () => {
    expect(agoText(Number.MAX_SAFE_INTEGER, NOW)).toBe("Just now")
    expect(agoText(NOW - 30_000, NOW)).toBe("Just now")
    expect(agoText(NOW - 12 * 60_000, NOW)).toBe("12m ago")
    expect(agoText(NOW - 3_600_000, NOW)).toBe("1h ago")
    expect(agoText(NOW - 23 * 3_600_000, NOW)).toBe("23h ago")
  })

  it("names the day after a day, and adds the year when it differs", () => {
    const day = new Date(2026, 9, 23, 12).getTime()
    const lastYear = new Date(2025, 9, 23, 12).getTime()
    expect(agoText(day, NOW)).toBe(new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(day))
    expect(agoText(lastYear, NOW)).toContain("2025")
  })
})
